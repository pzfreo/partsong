// iPhone Safari closes a backgrounded page's IndexedDB connection, and the next
// save threw "The database connection is closing". db.js should reopen and
// retry once. The closed connection is stood in for by a transaction() that
// throws Safari's InvalidStateError, and Safari's restarted storage process by
// one that throws UnknownError ("internal error ... Indexed Database server").
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-db-reopen.js
const db = await import("/db.js");
const real = IDBDatabase.prototype.transaction;
let fails = 0;
const failOnce = (message, name) => () => {
  IDBDatabase.prototype.transaction = function (...a) {
    IDBDatabase.prototype.transaction = real;
    fails++;
    throw new DOMException(message, name);
  };
};
const closeOnce = failOnce("Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.", "InvalidStateError");
// Safari after its IndexedDB process restarted.
const internalOnce = failOnce("An internal error was encountered in the Indexed Database server", "UnknownError");
const r = {};
try {
  await db.all();
  closeOnce();
  await db.put({ id: "reopen-test", title: "Reopen", images: [new Blob(["x"], { type: "text/plain" })] });
  internalOnce();
  await db.update("reopen-test", { title: "Reopened" });
  closeOnce();
  const got = (await db.all()).find((e) => e.id === "reopen-test");
  r.title = got?.title;
  r.image = got && (await got.images[0].text());
  closeOnce();
  await db.remove("reopen-test");
  r.gone = !(await db.all()).some((e) => e.id === "reopen-test");
  r.fails = fails;
  // A failed request rejects with its error, not null (duplicate key here).
  await db.put({ id: "dup-test", title: "Dup", images: [] });
  const realPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v) { IDBObjectStore.prototype.put = realPut; return this.add(v); };
  r.requestError = await db.put({ id: "dup-test", title: "Dup", images: [] }).then(() => "none", (e) => (e === null ? "null" : e?.name));
  await db.remove("dup-test");
  // Two calls failing together reopen once, and both succeed.
  const realOpen = indexedDB.open.bind(indexedDB);
  let opens = 0;
  indexedDB.open = (...a) => (opens++, realOpen(...a));
  let left = 2;
  IDBDatabase.prototype.transaction = function (...a) {
    if (--left === 0) IDBDatabase.prototype.transaction = real;
    throw new DOMException("closing", "InvalidStateError");
  };
  const both = await Promise.all([db.all(), db.all()]);
  r.together = { opens, ok: both.every(Array.isArray) };
  indexedDB.open = realOpen;
  // Other errors still surface.
  IDBDatabase.prototype.transaction = () => { throw new DOMException("no", "NotFoundError"); };
  r.otherError = await db.all().then(() => "none", (e) => e.name);
  IDBDatabase.prototype.transaction = real;
} catch (e) {
  r.error = String(e);
}
r.ok = r.title === "Reopened" && r.image === "x" && r.gone && r.fails === 4 && r.otherError === "NotFoundError" && r.requestError === "ConstraintError" && r.together?.opens === 1 && r.together.ok;
window.result = r;
