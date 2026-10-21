// Regression tests for the offline store's sync engine (web/js/lib/store.js).
// Runs in Node with a fake Supabase client: an in-memory "server" whose replies
// can be slowed down, rejected or cut off (offline). IndexedDB doesn't exist in
// Node, so idb.js uses its memory fallback.
// Run: node --test tests/store.test.mjs
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fake server ---------------------------------------------------------------
const server = {};   // table → Map(key → row)
const net = { offline: false, selectMs: 0, selectMsByTable: {}, upsertMs: 0, reject: null };
const table = (t) => (server[t] ||= new Map());
let lastStamp = 0;
const stamp = () => { lastStamp = Math.max(Date.now(), lastStamp + 1); return new Date(lastStamp).toISOString(); };
const OFFLINE = { data: null, error: { message: 'TypeError: fetch failed' }, status: 0 };
// Same row identity as the app uses (e.g. steps by date, foods by id).
const serverKey = (t, row) => store.TABLES[t].key.map((c) => row[c]).join('|');

/** Put rows on the server (as if written by another device or the Shortcut). */
function seed(t, rows, at = () => stamp()) {
  rows.forEach((r, i) => {
    const row = { user_id: 'u1', deleted: false, ...r, updated_at: at(i) };
    table(t).set(serverKey(t, row), row);
  });
}

function query(t) {
  const filters = [];
  let limit = 1000, single = false;
  const q = {
    select: () => q,
    order: () => q,
    limit: (n) => { limit = n; return q; },
    gt: (c, v) => { filters.push((r) => r[c] > v); return q; },
    eq: (c, v) => { filters.push((r) => String(r[c]) === String(v)); return q; },
    maybeSingle: () => { single = true; return q; },
    then(res, rej) {
      return (async () => {
        if (net.offline) return OFFLINE;
        // The server reads the data right away; the reply arrives after the delay.
        const rows = [...table(t).values()].filter((r) => filters.every((f) => f(r)))
          .sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(0, limit).map((r) => ({ ...r }));
        await sleep(net.selectMsByTable[t] ?? net.selectMs);
        return { data: single ? rows[0] ?? null : rows, error: null, status: 200 };
      })().then(res, rej);
    },
  };
  return q;
}

const fakeClient = {
  from: (t) => ({
    select: () => query(t),
    async upsert(row) {
      if (net.offline) return OFFLINE;
      await sleep(net.upsertMs / 2);
      const bad = net.reject?.(t, row);
      if (!bad) table(t).set(serverKey(t, row), { ...row, updated_at: stamp() });
      await sleep(net.upsertMs / 2);
      return bad ? { data: null, error: { message: bad, code: '23514' }, status: 400 } : { data: null, error: null, status: 201 };
    },
  }),
  auth: { refreshSession: async () => ({ data: {}, error: null }) },
};

// ---- minimal browser globals, then load the store --------------------------------
globalThis.window = globalThis;
globalThis.supabase = { createClient: () => fakeClient };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

const store = await import('../web/js/lib/store.js');
const idb = await import('../web/js/lib/idb.js');

/** Wait until check() is true (it may be async). */
async function waitFor(check, ms = 3000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(10);
  }
}

beforeEach(async () => {
  await store.reset();
  for (const t of Object.keys(server)) delete server[t];
  Object.assign(net, { offline: false, selectMs: 0, selectMsByTable: {}, upsertMs: 0, reject: null });
});
after(() => store.reset()); // stops the store's timers so the test process can exit

// ---- tests ---------------------------------------------------------------------
test('a change made during a slow download is not undone by it', async () => {
  seed('workout_sets', [{ id: 'S', weight: 60, done: false }]);
  seed('foods', [{ id: 'F', name: 'apple' }]);
  await store.init('u1');
  await store.sync();
  assert.equal(store.find('workout_sets', { id: 'S' }).weight, 60);

  net.selectMsByTable.coach_messages = 900; // one slow table keeps the download open
  const pulling = store.sync();
  await sleep(30); // the download has read the server: weight 60, food still there
  store.put('workout_sets', { id: 'S', weight: 62.5, done: true });
  store.remove('foods', { id: 'F' });
  await waitFor(() => server.workout_sets.get('S').weight === 62.5 && server.foods.get('F').deleted);
  await pulling; // now the old snapshot arrives

  assert.equal(store.find('workout_sets', { id: 'S' }).weight, 62.5);
  assert.equal(store.find('workout_sets', { id: 'S' }).done, true);
  assert.equal(store.find('foods', { id: 'F' }), null);

  net.selectMsByTable = {};
  await store.sync(); // the next download brings the uploaded versions
  assert.equal(store.find('workout_sets', { id: 'S' }).weight, 62.5);
  assert.equal(store.find('foods', { id: 'F' }), null);
});

test('a change made while an upload is running is still uploaded', async () => {
  await store.init('u1');
  await store.sync();
  net.upsertMs = 600;
  store.put('weights', { date: '2026-10-21', kg: 80 });
  await sleep(500); // the weight's upload is in flight now
  store.put('sleep_logs', { date: '2026-10-21', minutes: 480 });
  await waitFor(async () => server.sleep_logs?.has('2026-10-21') && (await store.pendingCount()) === 0, 2500);
  assert.equal(server.weights.get('2026-10-21').kg, 80);
});

test('a sync asked for during a running sync runs once more afterwards', async () => {
  await store.init('u1');
  await store.sync();
  net.selectMs = 300;
  const first = store.sync();
  await sleep(50); // first download has already read the server
  seed('coach_messages', [{ id: 'M1', kind: 'coach', text: 'Hi' }]); // e.g. a push just arrived
  const second = store.sync();
  await first;
  await second;
  assert.ok(store.find('coach_messages', { id: 'M1' }));
});

test('signing out during a sync and straight back in downloads everything', async () => {
  const old = Date.now() - 3 * 3600e3; // well before the 2-minute overlap window
  seed('foods', Array.from({ length: 50 }, (_, i) => ({ id: `f${i}`, name: `food ${i}` })), (i) => new Date(old + i * 60e3).toISOString());
  await store.init('u1');
  await store.sync();
  assert.equal(store.rows('foods').length, 50);

  seed('foods', [{ id: 'new', name: 'new food' }]);
  net.selectMs = 500;
  store.sync();           // a slow background sync…
  await sleep(100);
  await store.reset();    // …the user signs out…
  await store.init('u1'); // …and right back in (same account)
  await store.sync();
  net.selectMs = 0;
  await sleep(600);       // let the old download finish as well
  await store.sync();
  assert.equal(store.rows('foods').length, 51);
});

test('a change the server rejects is undone on the device, and the notice survives a restart', async (t) => {
  t.mock.method(console, 'error', () => {});
  seed('events', [{ id: 'E1', title: 'Dentist' }]);
  await store.init('u1');
  await store.sync();
  net.reject = (tbl) => (tbl === 'events' ? 'new row violates check constraint "events_check"' : null);
  store.put('events', { id: 'E2', title: 'Never saved' }); // new row: the server never had it
  store.put('events', { id: 'E1', title: 'Changed' });     // edit of a row the server has
  await waitFor(() => store.status.failed.length === 2
    && !store.find('events', { id: 'E2' }) && store.find('events', { id: 'E1' })?.title === 'Dentist');
  assert.equal((await idb.get('meta', 'failed')).v.length, 2); // saved for the next launch
  assert.equal(await store.pendingCount(), 0);

  store.clearFailed();
  assert.equal(store.status.failed.length, 0);
  await waitFor(async () => (await idb.get('meta', 'failed')).v.length === 0);
});

test('steps typed in offline do not overwrite a newer Apple Health total', async () => {
  const D = '2026-10-21';
  await store.init('u1');
  await store.sync();
  net.offline = true;
  store.put('steps', { date: D, steps: 4000, source: 'manual' }); // morning, at the gym, no signal
  await sleep(500);
  assert.equal(await store.pendingCount(), 1);
  await sleep(5);
  seed('steps', [{ date: D, steps: 12000, source: 'shortcut' }]); // evening: the Shortcut posts Health steps
  net.offline = false;
  await store.sync();
  assert.equal(server.steps.get(D).steps, 12000);
  assert.equal(store.find('steps', { date: D }).steps, 12000);
  assert.equal(await store.pendingCount(), 0);

  // A number you type in after the Shortcut ran still replaces it.
  store.put('steps', { date: D, steps: 13000, source: 'manual' });
  await store.sync();
  assert.equal(server.steps.get(D).steps, 13000);
  assert.equal(store.find('steps', { date: D }).steps, 13000);
});

test('a change made during sync’s own upload, sent while it downloads, is not undone', async () => {
  seed('workout_sets', [{ id: 'A', weight: 50, done: false }, { id: 'S', weight: 60, done: false }]);
  await store.init('u1');
  await store.sync();
  net.offline = true;
  store.put('workout_sets', { id: 'A', weight: 52.5, done: true }); // waits in the outbox
  await sleep(500);
  net.offline = false;
  net.upsertMs = 900;                         // slow uploads
  net.selectMsByTable.coach_messages = 2500;  // slow download
  const syncing = store.sync();               // its upload sends A
  await sleep(150);
  store.put('workout_sets', { id: 'S', weight: 62.5, done: true }); // sent by the follow-up upload, during the download
  await syncing;
  assert.equal(server.workout_sets.get('S').weight, 62.5);
  assert.equal(store.find('workout_sets', { id: 'S' }).weight, 62.5);
  assert.equal(store.find('workout_sets', { id: 'S' }).done, true);
});

test('several changes to one row queue as one upload', async () => {
  await store.init('u1');
  net.offline = true;
  store.put('weights', { date: '2026-10-20', kg: 80 });
  store.put('weights', { date: '2026-10-20', kg: 79.5 });
  store.put('weights', { date: '2026-10-21', kg: 79 });
  assert.equal(await store.pendingCount(), 2);
  net.offline = false;
  await store.sync();
  assert.equal(server.weights.get('2026-10-20').kg, 79.5);
  assert.equal(await store.pendingCount(), 0);
});
