// Persistent storage for the recorder.
//  - Metadata (folders, recording info, markers, settings) lives in localStorage as JSON.
//  - Audio blobs live in IndexedDB, keyed by recording id.
// Both work in a regular browser and inside the Android WebView, so the same code
// runs in the web preview and in the APK.

const META_KEY = 'recorder.meta.v1';
const DB_NAME = 'recorder';
const STORE = 'blobs';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const result = fn(store);
        t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('transaction aborted'));
      })
  );
}

export function putBlob(id, blob) {
  return tx('readwrite', (s) => s.put(blob, id));
}

export function getBlob(id) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      })
  );
}

export function deleteBlob(id) {
  return tx('readwrite', (s) => s.delete(id));
}

// Remove every stored blob whose key is not in `keepIds` (cleans up after crashes).
export async function pruneBlobs(keepIds) {
  const db = await openDb();
  const keys = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const stale = keys.filter((k) => !keepIds.has(k));
  if (stale.length) await tx('readwrite', (s) => stale.forEach((k) => s.delete(k)));
}

export function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Could not read saved metadata', e);
    return null;
  }
}

// Returns false when the write failed (for example, storage is full).
export function saveMeta(meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    return true;
  } catch (e) {
    console.warn('Could not save metadata', e);
    return false;
  }
}
