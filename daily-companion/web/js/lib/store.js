// =============================================================================
// Offline-first data store + sync engine.
// -----------------------------------------------------------------------------
// How it works:
//  1. Every table you use is kept in memory and in IndexedDB on the device,
//     so the app opens instantly and works with no connection.
//  2. When you change something, it's saved locally right away and an entry is
//     added to the "outbox".
//  3. The outbox is uploaded to Supabase in order as soon as you're online
//     (on change, when the app comes to the foreground, every minute, and when
//     the connection returns). Failed uploads stay queued — nothing is lost.
//  4. "Pull" downloads anything that changed on the server since the last sync
//     (e.g. coach messages, steps from the iOS Shortcut, another device).
// Deletes are "soft" (deleted = true) so they sync like any other change.
// =============================================================================

import * as idb from './idb.js';
import { supa } from './supa.js';
import { mergeSettings } from '../shared/defaults.js';
import { createStats } from '../shared/stats.js';
import { buildDayPlan, gymWeekInfo } from '../shared/plan.js';
import { addDays } from '../shared/time.js';

/**
 * Synced tables.
 *  key      – columns that identify a row locally
 *  conflict – the unique columns Supabase uses to decide insert vs update
 *  readonly – columns the app must never send (the server owns them)
 */
export const TABLES = {
  profiles:          { key: ['user_id'], conflict: 'user_id', readonly: ['steps_token'] },
  quests:            { key: ['id'] },
  quest_log:         { key: ['quest_id', 'date'], conflict: 'user_id,quest_id,date' },
  steps:             { key: ['date'], conflict: 'user_id,date' },
  foods:             { key: ['id'] },
  food_favorites:    { key: ['id'] },
  weights:           { key: ['date'], conflict: 'user_id,date' },
  workout_templates: { key: ['id'] },
  workouts:          { key: ['id'] },
  workout_sets:      { key: ['id'] },
  study_sessions:    { key: ['id'] },
  events:            { key: ['id'] },
  day_plans:         { key: ['date'], conflict: 'user_id,date' },
  sleep_logs:        { key: ['date'], conflict: 'user_id,date' },
  checkins:          { key: ['date'], conflict: 'user_id,date' },
  coach_messages:    { key: ['id'] },
};
const TABLE_NAMES = Object.keys(TABLES);

// Re-download rows changed up to 2 minutes before the last cursor. Covers the
// small window where a slow server transaction commits with an older timestamp.
const PULL_OVERLAP_MS = 2 * 60 * 1000;
const PAGE = 1000;

const keyOf = (t, row) => TABLES[t].key.map((c) => row[c]).join('|');

// ---- state ------------------------------------------------------------------
const mem = Object.fromEntries(TABLE_NAMES.map((t) => [t, new Map()]));
const pendingKeys = new Set();            // "table|key" with unsent local changes
let cursors = {};                          // table → ISO timestamp of last pulled change
let userId = null;
let version = 0;
const listeners = new Set();
let rowsCache = { version: -1, data: {} };
let statsCache = { version: -1, stats: null };

export const status = {
  ready: false,        // local cache loaded
  synced: false,       // at least one full download has completed (ever)
  syncing: false,
  pending: 0,          // changes waiting to upload
  lastSyncAt: null,
  offline: !navigator.onLine,
  failed: [],          // changes the server rejected (should never happen)
};

// ---- change notification ----------------------------------------------------
let emitQueued = false;
function emit() {
  version++;
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => { emitQueued = false; for (const fn of listeners) fn(version); });
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const getVersion = () => version;

// ---- reading ----------------------------------------------------------------
/** All live (not deleted) rows of a table. Arrays are cached per version. */
export function rows(t) {
  if (rowsCache.version !== version) rowsCache = { version, data: {} };
  if (!rowsCache.data[t]) rowsCache.data[t] = [...mem[t].values()].filter((r) => !r.deleted);
  return rowsCache.data[t];
}

/** One row by its key fields, e.g. find('steps', { date: '2026-10-21' }). */
export function find(t, keyFields) {
  const r = mem[t].get(keyOf(t, keyFields));
  return r && !r.deleted ? r : null;
}

export const getUserId = () => userId;

/** Your settings merged with defaults. */
export function settings() {
  const p = mem.profiles.get(userId);
  return mergeSettings(p?.settings || {});
}

export function profile() { return mem.profiles.get(userId) || null; }

/** Stats engine over all local data (rebuilt only when data changed). */
export function stats() {
  if (statsCache.version !== version) {
    const data = Object.fromEntries(TABLE_NAMES.map((t) => [t, rows(t)]));
    statsCache = { version, stats: createStats(data, settings()) };
  }
  return statsCache.stats;
}

/** The plan for a date as if `overrideRow` were saved (planner preview). */
export function previewPlan(date, overrideRow) {
  const st = stats();
  const s = settings();
  return buildDayPlan({
    date, settings: s, override: overrideRow,
    nextOverride: find('day_plans', { date: addDays(date, 1) }),
    gymWeek: gymWeekInfo(date, s, st.countedWorkouts),
  });
}

// ---- writing ----------------------------------------------------------------
/**
 * Create or update a row. Pass only the fields you're changing for an update.
 * Returns the full saved row.
 */
export function put(t, fields) {
  const def = TABLES[t];
  if (!def) throw new Error(`Unknown table ${t}`);
  const base = { user_id: userId };
  if (def.key[0] === 'id' && !fields.id) base.id = crypto.randomUUID();
  const draft = { ...base, ...fields };
  const k = keyOf(t, draft);
  const existing = mem[t].get(k);
  const row = { ...(existing || {}), ...draft, user_id: userId, deleted: fields.deleted ?? false, updated_at: new Date().toISOString() };
  mem[t].set(k, row);
  pendingKeys.add(`${t}|${k}`);
  emit();
  persist(t, k, row);
  return row;
}

/** Soft-delete a row (syncs as a change). */
export function remove(t, keyFields) {
  const k = keyOf(t, keyFields);
  const existing = mem[t].get(k);
  if (!existing) return;
  put(t, { ...keyFieldsOf(t, existing), deleted: true });
}

const keyFieldsOf = (t, row) => Object.fromEntries(TABLES[t].key.map((c) => [c, row[c]]));

// Writes are chained so the outbox keeps the exact order of your changes.
let writeChain = Promise.resolve();
function persist(t, k, row) {
  writeChain = writeChain.then(async () => {
    await idb.write('rows', [{ k: `${t}|${k}`, t, row }]);
    // Coalesce: an older unsent change to the same row is replaced by this one.
    const outbox = await idb.getAll('outbox');
    const stale = outbox.filter((o) => o.t === t && o.k === k).map((o) => o.id);
    if (stale.length) await idb.write('outbox', [], stale);
    await idb.add('outbox', { t, k, row });
    status.pending = outbox.length - stale.length + 1;
  }).catch((e) => console.error('persist failed', e));
  scheduleFlush();
}

// ---- sync ---------------------------------------------------------------------
let flushTimer = null;
function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flush(); }, 400);
}

const isRetryable = (st) => st === 0 || st === 401 || st === 408 || st === 429 || st >= 500 || st === undefined;

function toServerRow(t, row) {
  const out = { ...row };
  delete out.updated_at; // the server sets this
  for (const c of TABLES[t].readonly || []) delete out[c];
  return out;
}

let flushing = null;
/** Upload queued changes in order. Stops at the first network problem. */
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    await writeChain;
    if (!userId) return;
    const ops = (await idb.getAll('outbox')).sort((a, b) => a.id - b.id);
    status.pending = ops.length;
    const uid = userId;
    for (const op of ops) {
      if (userId !== uid) break; // signed out mid-way
      if (!TABLES[op.t]) { await idb.write('outbox', [], [op.id]); continue; }
      const def = TABLES[op.t];
      const res = await supa.from(op.t).upsert(toServerRow(op.t, op.row), { onConflict: def.conflict || def.key.join(',') });
      if (!res.error) {
        await idb.write('outbox', [], [op.id]);
        status.pending = Math.max(0, status.pending - 1);
        // Only clear "pending" if no newer change for the row was queued meanwhile.
        const still = (await idb.getAll('outbox')).some((o) => o.t === op.t && o.k === op.k);
        if (!still) pendingKeys.delete(`${op.t}|${op.k}`);
        continue;
      }
      if (isRetryable(res.status)) {
        if (res.status === 401) await supa.auth.refreshSession().catch(() => {});
        status.offline = res.status === 0 || !navigator.onLine;
        break; // try again later, keep order
      }
      // The server refused this change (invalid data). Drop it so it can't block
      // everything behind it, and remember it so the UI can tell you.
      console.error('Sync rejected', op, res.error);
      status.failed.push({ table: op.t, row: op.row, message: res.error.message, at: new Date().toISOString() });
      await idb.write('outbox', [], [op.id]);
      pendingKeys.delete(`${op.t}|${op.k}`);
      status.pending = Math.max(0, status.pending - 1);
    }
    emit();
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Download everything that changed on the server since the last pull. */
async function pull() {
  const uid = userId;
  const results = await Promise.all(TABLE_NAMES.map(async (t) => {
    const changed = [];
    let since = cursors[t] ? new Date(Date.parse(cursors[t]) - PULL_OVERLAP_MS).toISOString() : null;
    for (;;) {
      let q = supa.from(t).select('*').order('updated_at', { ascending: true }).limit(PAGE);
      if (since) q = q.gt('updated_at', since);
      const { data, error, status: st } = await q;
      if (error) throw Object.assign(new Error(error.message), { status: st });
      changed.push(...data);
      if (data.length < PAGE) break;
      since = data[data.length - 1].updated_at;
    }
    return [t, changed];
  }));

  // Signed out (or switched account) while downloading: throw the results away.
  if (userId !== uid) return;
  const puts = [], dels = [];
  let any = false;
  for (const [t, list] of results) {
    for (const row of list) {
      if (!cursors[t] || row.updated_at > cursors[t]) cursors[t] = row.updated_at;
      const k = keyOf(t, row);
      if (pendingKeys.has(`${t}|${k}`)) continue; // our unsent change is newer
      const cur = mem[t].get(k);
      if (cur && cur.updated_at === row.updated_at && !cur.deleted === !row.deleted) continue;
      any = true;
      if (row.deleted) { mem[t].delete(k); dels.push(`${t}|${k}`); }
      else { mem[t].set(k, row); puts.push({ k: `${t}|${k}`, t, row }); }
    }
  }
  if (puts.length || dels.length) await idb.write('rows', puts, dels);
  await idb.write('meta', [{ k: 'cursors', v: cursors }, { k: 'synced', v: true }]);
  if (any) emit();
}

let syncing = null;
/** Upload, then download. Safe to call any time; concurrent calls share one run. */
export function sync() {
  if (syncing) return syncing;
  if (!userId) return Promise.resolve();
  syncing = (async () => {
    status.syncing = true; emit();
    try {
      await flush();
      await pull();
      status.synced = true;
      status.offline = false;
      status.lastSyncAt = new Date().toISOString();
    } catch (e) {
      status.offline = !navigator.onLine || e.status === 0 || /fetch|network/i.test(e.message);
      // 401 = session expired or signed out mid-sync: refresh quietly, retry next round.
      if (e.status === 401) { if (userId) await supa.auth.refreshSession().catch(() => {}); }
      else if (!status.offline && userId) console.error('sync failed', e);
    } finally {
      status.syncing = false;
      syncing = null;
      emit();
    }
  })();
  return syncing;
}

// ---- lifecycle ----------------------------------------------------------------
let timers = [];

/** Load the local cache for a user and start background syncing. */
export async function init(uid) {
  if (userId === uid && status.ready) return;
  const owner = await idb.get('meta', 'owner');
  if (owner && owner.v !== uid) await idb.clearAll(); // a different account used this device
  userId = uid;
  await idb.write('meta', [{ k: 'owner', v: uid }]);

  for (const t of TABLE_NAMES) mem[t].clear();
  for (const { t, row } of await idb.getAll('rows')) {
    if (mem[t]) mem[t].set(keyOf(t, row), row);
  }
  const outbox = await idb.getAll('outbox');
  pendingKeys.clear();
  for (const o of outbox) pendingKeys.add(`${o.t}|${o.k}`);
  status.pending = outbox.length;
  cursors = (await idb.get('meta', 'cursors'))?.v || {};
  status.synced = !!(await idb.get('meta', 'synced'))?.v;
  status.ready = true;
  emit();

  const onOnline = () => { status.offline = false; sync(); };
  const onOffline = () => { status.offline = true; emit(); };
  const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  const iv = setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60000);
  timers = [() => window.removeEventListener('online', onOnline), () => window.removeEventListener('offline', onOffline),
    () => document.removeEventListener('visibilitychange', onVisible), () => clearInterval(iv)];

  sync();
}

/** Forget everything on this device (used on sign-out). */
export async function reset() {
  for (const off of timers) off();
  timers = [];
  userId = null;
  for (const t of TABLE_NAMES) mem[t].clear();
  pendingKeys.clear();
  cursors = {};
  Object.assign(status, { ready: false, synced: false, pending: 0, lastSyncAt: null, failed: [] });
  await idb.clearAll();
  emit();
}

/** Unsent changes count — used to warn before signing out. */
export async function pendingCount() {
  await writeChain;
  return (await idb.getAll('outbox')).length;
}

/** Update your settings (deep-merged into what's saved). */
export function saveSettings(patch) {
  const p = mem.profiles.get(userId);
  const current = p?.settings || {};
  const next = deepMerge(current, patch);
  put('profiles', { user_id: userId, settings: next });
  return mergeSettings(next);
}

function deepMerge(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}
