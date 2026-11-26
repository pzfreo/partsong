// Reads a landscape test page (see tests/make-landscape-fixtures.py) and says
// what the reader made of it: what it saw (staff lines and noteheads, per cent
// of the page), the systems it found, and the bars read against the Huron
// Carol answer key. The file is the page's ?f=:
//   node scripts/headless-test.mjs "http://localhost:8765/index.html?f=landscape-frame-70.jpg" out.json 600 tests/drive-landscape.js
// EXPECT is what the reader does today (24 Nov). A "gap" is a page it should
// read and doesn't: when one is fixed this fails, so the table gets updated.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label + " | " + document.getElementById("status").textContent); };
const $ = (id) => document.getElementById(id);
const file = new URLSearchParams(location.search).get("f");
// ?failcut=1: cutting the photo fails (a picture too big for the canvas): the page is read whole, not failed.
const failcut = new URLSearchParams(location.search).has("failcut");
if (failcut) {
  const encode = OffscreenCanvas.prototype.convertToBlob;
  OffscreenCanvas.prototype.convertToBlob = function (o) { return o?.type === "image/jpeg" ? Promise.reject(new Error("canvas too big")) : encode.call(this, o); };
}
const EXPECT = {
  "huron_0.png": { outcome: "read", bars: 22 },                      // a portrait page: the baseline
  "landscape-frame-96.jpg": { outcome: "read", bars: 22 },           // the page fills the frame's height
  "landscape-frame-70.jpg": { outcome: "no music", gap: "the page 70% of the frame's height is not found (0.2% staff lines)" },
  "landscape-frame-50.jpg": { outcome: "no music", gap: "the page 50% of the frame's height is not found" },
  "landscape-frame-35.jpg": { outcome: "no music", gap: "the page 35% of the frame's height is not found" },
  "landscape-frame-96.pdf": { outcome: "no music", gap: "the same page as a landscape PDF (drawn at 2480 wide) is not found" },
  "landscape-spread.jpg": { outcome: "read", bars: 38, pages: 2, note: true },   // split into its two pages (it read as one muddled part, 92 bars)
  "landscape-spread.pdf": { outcome: "read", bars: 38, pages: 2, note: true },
  "landscape-spread.jpg#failcut": { outcome: "read", bars: 92, pages: 1 },       // the cut failed: read whole, as before
};
const seen = [], systems = [];
const log = console.log;
console.log = (...a) => { const t = a.join(" "); const s = /Seen on the page: staff lines ([\d.]+)%, noteheads ([\d.]+)%/.exec(t); if (s) seen.push({ staff: +s[1], heads: +s[2] }); const y = /Systems \(staves in each\): (.*)/.exec(t); if (y) systems.push(y[1]); log(...a); };
const barsIn = (xml) => (/<part id=[^>]*>([\s\S]*?)<\/part>/.exec(xml)?.[1].match(/<measure /g) ?? []).length;
// The answer: the bars of the Huron pages the file is made of.
const expected = (await Promise.all((/spread/.test(file) ? [0, 1] : [0]).map(async (i) => barsIn(await (await fetch(`/testdata/huron_${i}.musicxml`)).text())))).reduce((a, b) => a + b, 0);
await sleep(500);
$("new-scan").click();
await waitFor(() => !$("scan").hidden, 10000, "scan");
const dt = new DataTransfer();
dt.items.add(new File([await (await fetch("/testdata/" + file)).blob()], file, { type: /\.pdf$/.test(file) ? "application/pdf" : "image/jpeg" }));
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
await waitFor(() => !$("recognise").disabled, 120000, "pages added");
$("recognise").click();
await waitFor(() => !$("check-done").hidden || /doesn't look like sheet music|Couldn't/.test($("status").textContent), 600000, "systems found");
const r = { file, expected, seen: seen[0] ?? null, systems: systems[0] ?? null };
if ($("check-done").hidden) {
  r.outcome = "no music: " + $("status").textContent.split("\n")[0];
} else {
  r.note = /two pages side by side/.test($("check-intro").textContent); // still said when the systems are all found
  $("check-done").click();
  await waitFor(() => !$("practice").hidden || /Couldn't|doesn't look like sheet music/.test($("status").textContent), 900000, "read");
  if ($("practice").hidden) r.outcome = "failed: " + $("status").textContent.split("\n")[0];
  else {
    const entry = await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result.sort((a, b) => b.created - a.created)[0]); }; });
    r.outcome = "read";
    r.bars = entry.pages.reduce((n, x) => n + barsIn(x), 0);
    r.lines = entry.pages.map((x) => (x.match(/<part id=/g) ?? []).length);
    r.pages = entry.pages.length;
  }
}
const want = EXPECT[file + (failcut ? "#failcut" : "")];
window.result = { ...r, gap: want?.gap, ok: !!want && r.outcome.startsWith(want.outcome) && (want.bars == null || r.bars === want.bars) && (want.pages == null || r.pages === want.pages) && (want.note == null || r.note === want.note) };
