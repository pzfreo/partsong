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

// Forget a connection only if it's still the current one: a stale one closing
// later mustn't drop the fresh one opened in its place.
function forget(p) {
  if (dbPromise === p) dbPromise = undefined;
}

function open() {
  if (dbPromise) return dbPromise;
  const p = (dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => {
      const db = req.result;
      // Safari closes the connection of a page left in the background; open
      // a fresh one next time rather than keep using the closed one.
      db.onclose = () => forget(p);
      db.onversionchange = () => {
        db.close();
        forget(p);
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  }).then(migrateLegacy));
  p.catch(() => forget(p));
  return p;
}

function transact(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result.result ?? result);
    // A failed request reaches onerror before the transaction has its error:
    // take the request's, so callers (and run's retry) see what went wrong.
    tx.onerror = (e) => reject(tx.error ?? e.target.error);
    tx.onabort = () => reject(tx.error);
  });
}

// A connection closed without a close event ("The database connection is
// closing", iPhone Safari) throws InvalidStateError, and one whose storage
// process Safari has restarted fails with UnknownError ("An internal error was
// encountered in the Indexed Database server"): reopen and try once more.
const REOPEN = new Set(["InvalidStateError", "UnknownError"]);
// Calls failing together share one reopen; the old connection is closed.
async function run(mode, fn) {
  const p = open();
  try {
    return await transact(await p, mode, fn);
  } catch (e) {
    if (!REOPEN.has(e?.name)) throw e;
    if (dbPromise === p) {
      dbPromise = undefined;
      p.then((db) => db.close(), () => {});
    }
    return transact(await open(), mode, fn);
  }
}

async function migrateLegacy(db) {
  let legacy;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
  } catch {
    return db;
  }
  if (!Array.isArray(legacy)) return db;
  await transact(db, "readwrite", (store) => {
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
  return (await run("readonly", (store) => store.getAll())).map(fromStored);
}

export async function put(entry) {
  navigator.storage?.persist?.();
  const stored = await toStored(entry);
  return run("readwrite", (store) => store.put(stored));
}

export async function update(id, changes) {
  const stored = await toStored(changes);
  return run("readwrite", (store) => {
    const req = store.get(id);
    req.onsuccess = () => req.result && store.put({ ...req.result, ...stored });
    return {};
  });
}

export async function remove(id) {
  return run("readwrite", (store) => store.delete(id));
}
