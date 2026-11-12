// The library is listed without loading the scores (db.list): no getAll, and
// its rows hold no photos beyond each score's first (the thumbnail). Tapping a
// row fetches that one score. Loading every score with its photos (db.all) is
// what ran iPhones out of memory in v273.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-library-list.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = (mode, fn) => new Promise((res, rej) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out?.result ?? out); tx.onerror = rej; }; });
const pages = await Promise.all([0, 1].map((i) => fetch(`/testdata/bleakdemo_${i}.musicxml`).then((r) => r.text())));
const png = await (await fetch("/icon-192.png")).arrayBuffer();
const photo = () => ({ type: "image/png", bytes: png.slice(0) });
await db("readwrite", (s) => {
  s.clear();
  for (let i = 0; i < 4; i++) s.put({ id: `s${i}`, title: `Score ${i}`, created: i, pages, images: [photo(), photo()], manual: i === 3 ? { 0: 1 } : {} });
  s.put({ id: "half", title: "Half read", created: 9, pages: [pages[0], null], images: [photo(), photo()], pending: true, stopped: true });
});
const reads = { getAll: 0, get: 0 };
const { getAll, get } = IDBObjectStore.prototype;
IDBObjectStore.prototype.getAll = function (...a) { reads.getAll++; return getAll.apply(this, a); };
IDBObjectStore.prototype.get = function (...a) { reads.get++; return get.apply(this, a); };
location.hash = ""; $("new-scan").click(); history.back(); await sleep(800);
const rows = [...document.querySelectorAll("#library li")];
const r = {
  rows: rows.map((li) => li.querySelector(".meta").textContent.trim().replace(/\s+/g, " ")),
  thumbs: rows.filter((li) => li.querySelector(".thumb img")).length,
  listing: { ...reads },
};
rows.find((li) => li.dataset.id === "s3").querySelector("button").click();
await waitFor(() => !$("practice").hidden, 20000, "score");
await sleep(500);
r.opened = { title: $("title").value, getAll: reads.getAll, photos: document.querySelectorAll("#photo-list img, #photo-list image").length };
r.ok = r.listing.getAll === 0 && r.listing.get === 0 && r.opened.getAll === 0 && r.thumbs === 5 && r.opened.title === "Score 3" &&
  r.rows[0] === "Half readReading… 1 of 2" && r.rows[1] === "Score 32 pages · 1 system marked";
window.result = r;
