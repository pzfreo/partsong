// In low memory a phone's 12 MP photo goes to the reader as a smaller copy;
// the systems it finds must still be where they are on the photo. Run twice,
// normally and with ?lowmem, and compare the two outputs' boxes:
//   node scripts/headless-test.mjs http://localhost:8765/index.html a.json 1200 tests/drive-low-memory-positions.js
//   node scripts/headless-test.mjs "http://localhost:8765/index.html?lowmem" b.json 1200 tests/drive-low-memory-positions.js
//   node tests/compare-positions.mjs a.json b.json
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const idb = (fn) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const tx = q.result.transaction("scores", "readonly"); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out.result); }; });
await sleep(500);
$("new-scan").click();
await waitFor(() => !$("scan").hidden, 10000, "scan");
const dt = new DataTransfer();
for (const f of ["cam_0_exif1.jpg", "cam_1_exif1.jpg"]) dt.items.add(new File([await (await fetch("/testdata/" + f)).blob()], f, { type: "image/jpeg" }));
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
await waitFor(() => !$("recognise").disabled, 60000, "pages added");
$("recognise").click();
await waitFor(() => !$("check-done").hidden, 600000, "systems found");
const entry = await waitFor(async () => (await idb((s) => s.getAll())).find((e) => e.found?.every(Boolean)), 30000, "systems saved");
window.result = { low: new URLSearchParams(location.search).has("lowmem"), systems: entry.found.map((f) => f.systems), ok: true };
