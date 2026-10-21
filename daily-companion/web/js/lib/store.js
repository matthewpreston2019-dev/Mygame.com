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

// Every local change gets a number (writeGen); `touched` keeps the number of
// the last change per "table|key". A download that started before a change
// holds an older copy of that row, so it must not replace it (see pull()).
let writeGen = 0;
const touched = new Map();

// Bumped on sign-in and sign-out. Background uploads/downloads remember the
// value they started with and stop (dropping their results) once it changes,
// because they belong to the old session.
let gen = 0;

// Changes this device couldn't save in IndexedDB (storage error, e.g. full).
// They're kept here in order and uploaded from memory, so they still reach
// the server while the app stays open.   "table|key" → { t, k, row, unsaved }
const unsaved = new Map();

export const status = {
  ready: false,        // local cache loaded
  synced: false,       // at least one full download has completed (ever)
  syncing: false,
  pending: 0,          // changes waiting to upload
  lastSyncAt: null,
  offline: !navigator.onLine,
  failed: [],          // changes the server rejected (kept until you dismiss them)
  storageError: false, // some changes couldn't be saved on this device (see `unsaved`)
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
  touched.set(`${t}|${k}`, ++writeGen);
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
  const key = `${t}|${k}`;
  const g = gen;
  writeChain = writeChain.then(async () => {
    if (g !== gen) return; // signed out before this was saved
    // Once saving failed, keep queueing in memory so uploads stay in order.
    if (unsaved.size) throw new Error('storage unavailable');
    // Saves the row and queues it in one go (an older unsent change to the
    // same row is replaced by this one).
    status.pending = await idb.putRowAndQueue({ k: key, t, row }, { t, k, row });
  }).catch((e) => {
    if (g !== gen) return;
    if (!unsaved.size) console.error('persist failed', e);
    if (!unsaved.has(key)) status.pending++;
    unsaved.delete(key); // delete + set moves it to the end: it's the newest change
    unsaved.set(key, { t, k, row, unsaved: true });
    status.storageError = true;
    emit();
  });
  scheduleFlush();
}

// ---- sync ---------------------------------------------------------------------
let flushTimer = null;
function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flush().catch((e) => console.error('flush failed', e)); }, 400);
}

const isRetryable = (st) => st === 0 || st === 401 || st === 408 || st === 429 || st >= 500 || st === undefined;

function toServerRow(t, row) {
  const out = { ...row };
  delete out.updated_at; // the server sets this
  for (const c of TABLES[t].readonly || []) delete out[c];
  return out;
}

/**
 * Run `start` at most once at a time. A call made while it runs gets a
 * promise for ONE more run right after the current one (shared by all such
 * calls), so a change made during a run is never left waiting.
 * fn.forget() lets go of the current run (used on sign-out/sign-in; the old
 * run notices that `gen` changed and stops by itself).
 */
function singleFlight(start) {
  let running = null, next = null;
  const fn = () => {
    if (running) {
      if (!next) {
        const p = running.catch(() => {}).then(() => { if (next === p) next = null; return fn(); });
        next = p;
      }
      return next;
    }
    const p = start().finally(() => { if (running === p) running = null; });
    running = p;
    return p;
  };
  fn.forget = () => { running = null; next = null; };
  return fn;
}

// The server's current copy of one row ({ data: row or null, error, status }).
function serverRow(t, row) {
  let q = supa.from(t).select('*');
  for (const c of TABLES[t].key) q = q.eq(c, row[c]);
  return q.maybeSingle();
}

// Show the server's copy of a row on this device, or drop the row if the
// server has none. Skipped if you changed the row again after `since`.
async function adoptServerRow(t, k, srv, since, g) {
  const key = `${t}|${k}`;
  if (g !== gen || pendingKeys.has(key) || (touched.get(key) || 0) > since) return;
  if (srv && !srv.deleted) mem[t].set(k, srv); else mem[t].delete(k);
  emit();
  if (srv && !srv.deleted) await idb.write('rows', [{ k: key, t, row: srv }]);
  else await idb.write('rows', [], [key]);
}

// Steps: the iOS Shortcut writes these rows too. True when it sent a newer
// Apple Health total than this queued change (e.g. steps typed in offline in
// the morning, Shortcut ran in the evening) — then the server's number wins.
const isNewerShortcut = (srv, row) => !!srv && !srv.deleted && srv.source === 'shortcut'
  && Date.parse(srv.updated_at) > Date.parse(row.updated_at);

// A queued change is done (uploaded, rejected or skipped): take it out of the
// outbox and clear the row's "pending" mark unless a newer change is queued.
async function finishOp(op, g) {
  const key = `${op.t}|${op.k}`;
  if (op.unsaved) {
    if (unsaved.get(key) === op) unsaved.delete(key);
    status.storageError = unsaved.size > 0;
  } else {
    await idb.write('outbox', [], [op.id]);
  }
  if (g !== gen) return;
  status.pending = Math.max(0, status.pending - 1);
  const still = unsaved.has(key) || (await idb.getAll('outbox')).some((o) => o.t === op.t && o.k === op.k);
  if (g === gen && !still) pendingKeys.delete(key);
}

// Network or login trouble: stop uploading for now (order is kept).
async function pauseUploads(st) {
  if (st === 401) await supa.auth.refreshSession().catch(() => {});
  status.offline = st === 0 || !navigator.onLine;
}

/** Upload queued changes in order. Stops at the first network problem. */
export const flush = singleFlight(async () => {
  const g = gen;
  await writeChain;
  if (!userId || g !== gen) return;
  const ops = (await idb.getAll('outbox')).sort((a, b) => a.id - b.id);
  // Changes that couldn't be saved on the device are the newest: they go last.
  ops.push(...unsaved.values());
  status.pending = ops.length;
  for (const op of ops) {
    if (g !== gen) break; // signed out mid-way
    const def = TABLES[op.t];
    if (!def) { await finishOp(op, g); continue; }
    if (op.t === 'steps') {
      const since = writeGen;
      const cur = await serverRow(op.t, op.row);
      if (g !== gen) break;
      if (cur.error && isRetryable(cur.status)) { await pauseUploads(cur.status); break; }
      if (!cur.error && isNewerShortcut(cur.data, op.row)) {
        await finishOp(op, g);
        await adoptServerRow(op.t, op.k, cur.data, since, g);
        continue;
      }
    }
    const res = await supa.from(op.t).upsert(toServerRow(op.t, op.row), { onConflict: def.conflict || def.key.join(',') });
    if (g !== gen) break;
    if (!res.error) { await finishOp(op, g); continue; }
    if (isRetryable(res.status)) { await pauseUploads(res.status); break; } // try again later, keep order
    // The server refused this change (invalid data). Drop it so it can't block
    // everything behind it, and remember it (also after a restart) so the UI
    // can tell you.
    console.error('Sync rejected', op, res.error);
    status.failed = [...status.failed, { table: op.t, row: op.row, message: res.error.message, at: new Date().toISOString() }].slice(-50);
    await idb.write('meta', [{ k: 'failed', v: status.failed }]).catch((e) => console.error('could not save failed list', e));
    await finishOp(op, g);
    // Undo it on this device too: show the server's version again, or remove
    // the row if it never reached the server. (Offline: leave it for now.)
    const since = writeGen;
    const srv = await serverRow(op.t, op.row);
    if (!srv.error) await adoptServerRow(op.t, op.k, srv.data, since, g);
  }
  emit();
});

/** Download everything that changed on the server since the last pull. */
async function pull() {
  const g = gen;
  const startGen = writeGen; // local changes after this are newer than what we download
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
  if (g !== gen) return;
  const puts = [], dels = [];
  let any = false;
  for (const [t, list] of results) {
    for (const row of list) {
      if (!cursors[t] || row.updated_at > cursors[t]) cursors[t] = row.updated_at;
      const k = keyOf(t, row);
      const key = `${t}|${k}`;
      if (pendingKeys.has(key)) continue; // our unsent change is newer
      // Changed here after this download started: even if that change is
      // already uploaded, this copy is older. The next pull brings the new one.
      if ((touched.get(key) || 0) > startGen) continue;
      const cur = mem[t].get(k);
      if (cur && cur.updated_at === row.updated_at && !cur.deleted === !row.deleted) continue;
      any = true;
      if (row.deleted) { mem[t].delete(k); dels.push(key); }
      else { mem[t].set(k, row); puts.push({ k: key, t, row }); }
    }
  }
  if (any) emit();
  if (puts.length || dels.length) await idb.write('rows', puts, dels);
  if (g !== gen) return;
  await idb.write('meta', [{ k: 'cursors', v: cursors }, { k: 'synced', v: true }]);
}

/**
 * Upload, then download. Safe to call any time: a call made while a sync is
 * running gets one more run right after it (e.g. a push arrived mid-sync).
 */
export const sync = singleFlight(async () => {
  if (!userId) return;
  const g = gen;
  status.syncing = true; emit();
  try {
    await flush();
    if (g !== gen) return;
    await pull();
    if (g !== gen) return;
    status.synced = true;
    status.offline = false;
    status.lastSyncAt = new Date().toISOString();
  } catch (e) {
    if (g !== gen) return;
    status.offline = !navigator.onLine || e.status === 0 || /fetch|network/i.test(e.message);
    // 401 = session expired or signed out mid-sync: refresh quietly, retry next round.
    if (e.status === 401) { if (userId) await supa.auth.refreshSession().catch(() => {}); }
    else if (!status.offline && userId) console.error('sync failed', e);
  } finally {
    if (g === gen) { status.syncing = false; emit(); }
  }
});

// ---- lifecycle ----------------------------------------------------------------
let timers = [];

// Let go of anything still running for the previous session.
function stopSession() {
  gen++;
  flush.forget();
  sync.forget();
  clearTimeout(flushTimer);
  for (const off of timers) off();
  timers = [];
}

/** Load the local cache for a user and start background syncing. */
export async function init(uid) {
  if (userId === uid && status.ready) return;
  stopSession();
  const owner = await idb.get('meta', 'owner');
  if (owner && owner.v !== uid) { await idb.clearAll(); unsaved.clear(); } // a different account used this device
  userId = uid;
  await idb.write('meta', [{ k: 'owner', v: uid }]);

  for (const t of TABLE_NAMES) mem[t].clear();
  for (const { t, row } of await idb.getAll('rows')) {
    if (mem[t]) mem[t].set(keyOf(t, row), row);
  }
  const outbox = await idb.getAll('outbox');
  pendingKeys.clear();
  touched.clear();
  for (const o of outbox) pendingKeys.add(`${o.t}|${o.k}`);
  for (const key of unsaved.keys()) pendingKeys.add(key);
  status.pending = outbox.length + unsaved.size;
  status.storageError = unsaved.size > 0;
  cursors = (await idb.get('meta', 'cursors'))?.v || {};
  status.synced = !!(await idb.get('meta', 'synced'))?.v;
  status.failed = (await idb.get('meta', 'failed'))?.v || [];
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
  stopSession(); // a sync still running for this account stops and drops its results
  userId = null;
  for (const t of TABLE_NAMES) mem[t].clear();
  pendingKeys.clear();
  touched.clear();
  unsaved.clear();
  cursors = {};
  Object.assign(status, { ready: false, synced: false, syncing: false, pending: 0, lastSyncAt: null, failed: [], storageError: false });
  await idb.clearAll();
  emit();
}

/** Dismiss the "changes were rejected by the server" notice. */
export function clearFailed() {
  status.failed = [];
  emit();
  idb.write('meta', [{ k: 'failed', v: [] }]).catch(() => {});
}

/** Unsent changes count — used to warn before signing out. */
export async function pendingCount() {
  await writeChain;
  return (await idb.getAll('outbox')).length + unsaved.size;
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
