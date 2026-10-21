// =============================================================================
// Tiny promise wrapper around IndexedDB — the app's on-device cache.
// Three object stores:
//   rows   – every synced row, key "table|rowKey"        { k, t, row }
//   outbox – changes waiting to be uploaded, in order    { id, t, k, row }
//   meta   – small values (sync cursors, owner id)       { k, v }
// If IndexedDB is unavailable (rare: private mode on old browsers) we fall
// back to memory so the app still works while online.
// =============================================================================

const DB_NAME = 'daily-companion';
const DB_VERSION = 1;

let dbPromise = null;
let openDb = null; // the connection dbPromise resolved to

// Forget a connection that stopped working, so the next call opens a new one.
function forget(db) {
  if (openDb !== db) return; // already replaced
  openDb = null;
  dbPromise = null;
}

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in globalThis)) return resolve(null);
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('rows')) db.createObjectStore('rows', { keyPath: 'k' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => {
      const db = req.result;
      openDb = db;
      // iOS can close the connection while the app is in the background
      // (its storage process was stopped). Open a fresh one next time.
      db.onclose = () => forget(db);
      // Another tab wants to upgrade the database: step aside.
      db.onversionchange = () => { db.close(); forget(db); };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const txDone = (tx) => new Promise((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
  tx.onabort = () => rej(tx.error || new DOMException('Transaction aborted', 'AbortError'));
});

// Errors that mean "the connection is gone" (WebKit: "Connection to Indexed
// Database server lost"). A transaction that failed this way changed nothing,
// so it's safe to run it again on a new connection.
const LOST = ['InvalidStateError', 'UnknownError', 'AbortError'];

/**
 * Run fn(db) on an open connection, reconnecting and retrying once if the
 * connection was lost. Without IndexedDB, runs fallback() (memory) instead.
 */
async function withDb(fn, fallback) {
  for (let attempt = 0; ; attempt++) {
    const db = await open();
    if (!db) return fallback();
    try {
      return await fn(db);
    } catch (e) {
      if (attempt > 0 || !LOST.includes(e?.name)) throw e;
      try { db.close(); } catch { /* already closed */ }
      forget(db);
    }
  }
}

// Memory fallback
const mem = { rows: new Map(), outbox: new Map(), meta: new Map() };
let memId = 1;

export function getAll(store) {
  return withDb(
    (db) => reqP(db.transaction(store).objectStore(store).getAll()),
    () => [...mem[store].values()],
  );
}

export function get(store, key) {
  return withDb(
    (db) => reqP(db.transaction(store).objectStore(store).get(key)),
    () => mem[store].get(key),
  );
}

/** Write many values (and delete keys) in one transaction. */
export function write(store, puts = [], deletes = []) {
  return withDb(async (db) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const v of puts) os.put(v);
    for (const k of deletes) os.delete(k);
    await txDone(tx);
  }, () => {
    for (const v of puts) {
      if (store === 'outbox' && v.id == null) v.id = memId++;
      mem[store].set(v.k ?? v.id, v);
    }
    for (const k of deletes) mem[store].delete(k);
  });
}

/** Add one value and return its generated key (used for the outbox). */
export function add(store, value) {
  return withDb(async (db) => {
    const tx = db.transaction(store, 'readwrite');
    const id = await reqP(tx.objectStore(store).add(value));
    await txDone(tx);
    return id;
  }, () => { const id = memId++; mem[store].set(id, { ...value, id }); return id; });
}

/**
 * Save a changed row AND queue it for upload in ONE transaction, so an app
 * kill in between can't leave a saved row that never uploads.
 * Older queued changes to the same row are replaced by this one.
 *   entry – { k, t, row } for 'rows';  op – { t, k, row } for 'outbox'
 * Returns how many changes are now waiting in the outbox.
 */
export function putRowAndQueue(entry, op) {
  const same = (o) => o.t === op.t && o.k === op.k;
  return withDb(async (db) => {
    const tx = db.transaction(['rows', 'outbox'], 'readwrite');
    tx.objectStore('rows').put(entry);
    const ob = tx.objectStore('outbox');
    let count = 0;
    // Callbacks (not await) inside the transaction, so it stays open.
    ob.getAll().onsuccess = (e) => {
      const all = e.target.result;
      for (const o of all) if (same(o)) ob.delete(o.id);
      ob.add(op);
      count = all.filter((o) => !same(o)).length + 1;
    };
    await txDone(tx);
    return count;
  }, () => {
    mem.rows.set(entry.k, entry);
    for (const [id, o] of mem.outbox) if (same(o)) mem.outbox.delete(id);
    const id = memId++;
    mem.outbox.set(id, { ...op, id });
    return mem.outbox.size;
  });
}

export function clearAll() {
  return withDb(async (db) => {
    const tx = db.transaction(['rows', 'outbox', 'meta'], 'readwrite');
    for (const s of ['rows', 'outbox', 'meta']) tx.objectStore(s).clear();
    await txDone(tx);
  }, () => { for (const m of Object.values(mem)) m.clear(); });
}
