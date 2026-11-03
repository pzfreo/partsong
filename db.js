// Score library in IndexedDB: recognised MusicXML pages, the original photos
// and practice settings, one record per score.
//
// Photos are stored as bytes, not Blobs: Safari on iPhones keeps a stored
// Blob in a separate file it can lose, and then hands back a Blob that can't
// be read ("An error occurred reading the Blob argument"). Callers still put
// and get Blobs; older records that hold Blobs read as before (test for a
// Blob first: Blobs have a bytes() method too).

const DB_NAME = "partscanner";
const STORE = "scores";
const LEGACY_KEY = "partscanner.library.v1"; // localStorage, before photos were kept

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).then(migrateLegacy);
  return dbPromise;
}

function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result.result ?? result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

async function migrateLegacy(db) {
  let legacy;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
  } catch {
    return db;
  }
  if (!Array.isArray(legacy)) return db;
  await run(db, "readwrite", (store) => {
    for (const entry of legacy) store.put({ images: [], ...entry });
    return {};
  });
  localStorage.removeItem(LEGACY_KEY);
  return db;
}

async function toStored(entry) {
  if (!entry.images?.some((b) => b instanceof Blob)) return entry;
  const images = await Promise.all(
    entry.images.map(async (b) => (b instanceof Blob ? { type: b.type, bytes: await b.arrayBuffer() } : b)),
  );
  return { ...entry, images };
}

function fromStored(entry) {
  if (!entry.images?.length) return entry;
  return { ...entry, images: entry.images.map((b) => (b instanceof Blob || !b?.bytes ? b : new Blob([b.bytes], { type: b.type }))) };
}

export async function all() {
  return (await run(await open(), "readonly", (store) => store.getAll())).map(fromStored);
}

export async function put(entry) {
  navigator.storage?.persist?.();
  const stored = await toStored(entry);
  return run(await open(), "readwrite", (store) => store.put(stored));
}

export async function update(id, changes) {
  const stored = await toStored(changes);
  const db = await open();
  return run(db, "readwrite", (store) => {
    const req = store.get(id);
    req.onsuccess = () => req.result && store.put({ ...req.result, ...stored });
    return {};
  });
}

export async function remove(id) {
  return run(await open(), "readwrite", (store) => store.delete(id));
}
