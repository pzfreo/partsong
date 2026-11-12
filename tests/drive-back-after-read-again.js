// Back in the header goes home in one step, also after Read again (which
// leaves the score's and the panel's entries under the new reading: Back
// landed on the settings panel, v275) and with the panel open. The phone's own
// back still steps through the entries. A stand-in reader: no models needed.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-back-after-read-again.js
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
  terminate() {} };
const c = new OffscreenCanvas(400, 600); const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 400, 600);
const png = await (await c.convertToBlob({ type: "image/png" })).arrayBuffer();
const photo = () => ({ type: "image/png", bytes: png.slice(0) });
const screen = () => ["home", "scan", "practice"].find((s) => !$(s).hidden) + (!$("panel").hidden ? "+panel" : "");
await idb("readwrite", (s) => { s.clear(); s.put({ id: "a", title: "A", created: 1, pages: xml, images: [photo(), photo()], layout: 4, mine: 0 }); });
location.hash = ""; $("new-scan").click(); history.back(); await sleep(600);
await waitFor(() => [...document.querySelectorAll("#library button")].find((b) => b.textContent.includes("A")), 5000, "library").then((b) => b.click());
await waitFor(() => !$("practice").hidden, 5000, "score"); await sleep(300);
const r = { lenOpen: history.length };
$("settings").click(); await sleep(300);
$("read-again").click();
await waitFor(() => !$("scan").hidden, 5000, "scan");
await waitFor(() => !$("practice").hidden, 20000, "read again done"); await sleep(500);
r.afterRead = screen();
$("back").click(); await sleep(600);
r.backAfterReadAgain = screen();
// Open it again, panel open: still one Back.
await waitFor(() => [...document.querySelectorAll("#library button")].find((b) => b.textContent.includes("A")), 5000, "library again").then((b) => b.click());
await waitFor(() => !$("practice").hidden, 5000, "score again"); await sleep(300);
$("settings").click(); await sleep(300);
r.withPanel = screen();
$("back").click(); await sleep(600);
r.backWithPanel = screen();
r.ok = r.afterRead === "practice" && r.backAfterReadAgain === "home" && r.withPanel === "practice+panel" && r.backWithPanel === "home";
window.result = r;
