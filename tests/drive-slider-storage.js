// Dragging the "Other parts" slider, or ticking parts on and off, doesn't load
// the library from storage. Each change used to run the share-link check,
// which loaded every score with its photos (stored as bytes): with a library
// of photographed scores, a drag on an iPhone ran out of memory and Safari
// closed the page ("A problem repeatedly occurred", v273). Now a drag reads
// nothing, and letting go only saves the setting (update reads the record to
// write it back: one get); the link check uses the open score, not storage.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-slider-storage.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = (mode, fn) => new Promise((res, rej) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out?.result ?? out); tx.onerror = rej; }; });
const pages = await Promise.all([0, 1].map((i) => fetch(`/testdata/bleakdemo_${i}.musicxml`).then((r) => r.text())));
// A library of photographed scores: 8 more, each with 3 MB of photo.
const photo = { type: "image/png", bytes: new Uint8Array(3e6).buffer };
await db("readwrite", (s) => {
  s.clear();
  s.put({ id: "bleak", title: "Bleak", created: 9, pages, images: [], layout: 4, mine: 1, shareLink: { key: "stale", link: "https://x/#s=a.b", at: Date.now() } });
  for (let i = 0; i < 8; i++) s.put({ id: `other${i}`, title: `Other ${i}`, created: i, pages, images: [photo] });
});
await sleep(300);
location.hash = ""; $("new-scan").click(); history.back(); await sleep(600);
await waitFor(() => [...document.querySelectorAll("#library button")].find((b) => b.textContent.includes("Bleak")), 5000, "library").then((b) => b.click());
await waitFor(() => !$("practice").hidden, 20000, "score");
await sleep(800);
$("settings").click();
await sleep(800);
// Count reads from here on.
const reads = { getAll: 0, get: 0 };
const { getAll, get } = IDBObjectStore.prototype;
IDBObjectStore.prototype.getAll = function (...a) { reads.getAll++; return getAll.apply(this, a); };
IDBObjectStore.prototype.get = function (...a) { reads.get++; return get.apply(this, a); };
const slider = $("others");
for (let v = 25; v >= 0; v--) { slider.value = v; slider.dispatchEvent(new Event("input", { bubbles: true })); }
await sleep(800);
const drag = { ...reads };
slider.dispatchEvent(new Event("change", { bubbles: true }));
await sleep(800);
const release = { getAll: reads.getAll - drag.getAll, get: reads.get - drag.get };
const box = document.querySelector("#lines li:not(.mine) .include input");
box.click();
await sleep(800);
const tick = { getAll: reads.getAll - drag.getAll - release.getAll, get: reads.get - drag.get - release.get };
// Saved settings get read back by update (a get), not by loading the library.
const r = {
  drag,
  release,
  tick,
  others: $("others-val").textContent,
  shareReady: $("share-score").classList.contains("ready"), // stale key: not reusable
};
r.ok = drag.getAll === 0 && drag.get === 0 && release.getAll === 0 && release.get <= 1 && tick.getAll === 0 && tick.get <= 1 && r.others === "0%" && r.shareReady === false;
window.result = r;
