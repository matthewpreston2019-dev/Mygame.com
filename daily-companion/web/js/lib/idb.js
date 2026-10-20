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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

// Memory fallback
const mem = { rows: new Map(), outbox: new Map(), meta: new Map() };
let memId = 1;

export async function getAll(store) {
  const db = await open();
  if (!db) return [...mem[store].values()];
  return reqP(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await open();
  if (!db) return mem[store].get(key);
  return reqP(db.transaction(store).objectStore(store).get(key));
}

/** Write many values (and delete keys) in one transaction. */
export async function write(store, puts = [], deletes = []) {
  const db = await open();
  if (!db) {
    for (const v of puts) {
      if (store === 'outbox' && v.id == null) v.id = memId++;
      mem[store].set(v.k ?? v.id, v);
    }
    for (const k of deletes) mem[store].delete(k);
    return;
  }
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of puts) os.put(v);
  for (const k of deletes) os.delete(k);
  await txDone(tx);
}

/** Add one value and return its generated key (used for the outbox). */
export async function add(store, value) {
  const db = await open();
  if (!db) { const id = memId++; mem[store].set(id, { ...value, id }); return id; }
  const tx = db.transaction(store, 'readwrite');
  const id = await reqP(tx.objectStore(store).add(value));
  await txDone(tx);
  return id;
}

export async function clearAll() {
  const db = await open();
  if (!db) { for (const m of Object.values(mem)) m.clear(); return; }
  const tx = db.transaction(['rows', 'outbox', 'meta'], 'readwrite');
  for (const s of ['rows', 'outbox', 'meta']) tx.objectStore(s).clear();
  await txDone(tx);
}
