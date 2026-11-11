// A file opened while a score is being read doesn't replace the pages being
// read (v275: the read carried on over the new file's pages, ended with
// "couldn't save it" and left the first scan as "Reading… 0 of 3"). The read
// is shown, with a message, and finishes as it would have. Also: the reader is
// closed once a read is saved (not kept while practising).
// A stand-in reader, so no models are needed.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-open-while-reading.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const idb = (mode, fn) => new Promise((res, rej) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out?.result ?? out); tx.onerror = rej; }; });
const xml = await Promise.all([0, 1].map((i) => fetch(`/testdata/bleakdemo_${i}.musicxml`).then((r) => r.text())));
// Stub reader: no models. layout says "no staffs" (page left out of the check), recognise returns saved XML after DELAY.
window.STUB_DELAY = 300;
let n = 0;
window.Worker = class { constructor() { setTimeout(() => this.onmessage?.({ data: { type: "ready" } }), 50); }
  postMessage(m) { if (m.type === "layout") setTimeout(() => this.onmessage?.({ data: { type: "error", id: m.id, msg: "No staffs found" } }), 50);
    if (m.type === "recognise") setTimeout(() => this.onmessage?.({ data: { type: "result", id: m.id, xml: xml[n++ % 2], ms: 1 } }), window.STUB_DELAY); }
  terminate() { window.readerClosed = (window.readerClosed ?? 0) + 1; } };
const c = new OffscreenCanvas(400, 600); const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 400, 600);
const png = await (await c.convertToBlob({ type: "image/png" })).arrayBuffer();
const photo = () => ({ type: "image/png", bytes: png.slice(0) });
const screen = () => ["home", "scan", "practice"].find((s) => !$(s).hidden) + (!$("panel").hidden ? "+panel" : "");
window.STUB_DELAY = 2500;
await idb("readwrite", (s) => { s.clear(); });
location.hash = ""; $("new-scan").click(); await sleep(300);
// a 3-page scan of plain images, read slowly
const dt = new DataTransfer(); for (let i = 0; i < 3; i++) dt.items.add(new File([png], `p${i}.png`, { type: "image/png" }));
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
await waitFor(() => document.querySelectorAll("#pages img").length === 3, 10000, "pages");
$("scan-name").value = "First";
$("recognise").click(); await sleep(1500);
const r = { reading1: $("recognise").textContent };
$("back").click(); await sleep(500); r.screenAfterBack = screen();
// Open PDF on the home screen while the first scan is still being read
const pdf = await (await fetch("/samples/tallis-if-ye-love-me.pdf")).blob();
const dt2 = new DataTransfer(); dt2.items.add(new File([pdf], "tallis.pdf", { type: "application/pdf" }));
$("open-xml").files = dt2.files; $("open-xml").dispatchEvent(new Event("change"));
await sleep(600);
r.duringRead = { screen: screen(), notice: $("import-offer").hidden ? "" : $("import-question").textContent, toast: $("error-toast").hidden ? "" : $("error-toast").textContent, button: $("recognise").textContent, scanPages: document.querySelectorAll("#pages img").length };
const closedBefore = window.readerClosed ?? 0;
await waitFor(() => !$("practice").hidden, 30000, "the first read to finish");
await sleep(500);
r.title = $("title").value;
r.readerClosed = (window.readerClosed ?? 0) - closedBefore;
r.library = (await idb("readonly", (s) => s.getAll())).map((e) => ({ title: e.title, pending: !!e.pending, pages: e.pages.filter(Boolean).length, images: e.images.length }));
r.ok = r.duringRead.screen === "scan" && /still reading/.test(r.duringRead.notice) && !r.duringRead.toast && r.duringRead.scanPages === 3 && r.title === "First" && r.readerClosed === 1 &&
  JSON.stringify(r.library) === JSON.stringify([{ title: "First", pending: false, pages: 3, images: 3 }]);
window.result = r;
