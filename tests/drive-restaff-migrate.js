// A pair of staves the reader wrote as one goes back on two (layout 3), which
// can reorder a score's parts. A score saved under layout 2 keeps its part
// choices: your part, the parts switched off, and a mark move to the lines
// with the same music. Uses testdata/corpus/rose.partsong.pdf, where the
// re-staffed part (page 1's last piano system) gains two lines, so the second
// piano part moves from lines 16-19 to 18-21.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 120 tests/drive-restaff-migrate.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = (mode, fn) => new Promise((res, rej) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out.result ?? out); tx.onerror = rej; }; });
const { buildScore, parsePage } = await import("/score.js");
await sleep(500);
const dt = new DataTransfer();
dt.items.add(new File([await (await fetch("/testdata/corpus/rose.partsong.pdf")).blob()], "rose.partsong.pdf", { type: "application/pdf" }));
$("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
let entry;
for (let i = 0; i < 40 && !entry; i++) {
  await sleep(500);
  [...document.querySelectorAll("button")].find((b) => b.textContent === "Add" && b.offsetParent)?.click();
  entry = (await db("readonly", (s) => s.getAll())).find((e) => e.pages?.length);
}
const old = buildScore(entry.pages.map((x) => parsePage(x, { restaff: false })));
const now = buildScore(entry.pages.map(parsePage));
const sop = old.lines.findIndex((l) => l.staffKey === "2#1/1" && l.voice === "upper");
const sys = old.systems.findIndex((s) => s.staves.some((st) => st.lines.includes(sop)));
const off = old.lines.filter((l) => l.accompaniment).map((l) => l.id);
// Saved by the version before: layout 2, ids from the old parts.
await db("readwrite", (s) => s.put({ ...entry, layout: 2, mine: sop, excluded: off, manual: { [sys]: sop }, markedStaff: { [sys]: old.lines[sop].staffKey } }));
history.back(); await sleep(800);
if ($("home").hidden) { history.back(); await sleep(800); }
document.querySelector(`#library li[data-id="${entry.id}"] button`).click();
await waitFor(() => !$("practice").hidden, 20000, "score");
await sleep(500);
const saved = await db("readonly", (s) => s.get(entry.id));
const label = (l) => l && `${l.label} ${l.staffKey} ${l.voice}`;
const r = {
  oldSoprano: sop,
  newSoprano: now.lines.findIndex((l) => l.staffKey === "2#1/1" && l.voice === "upper"),
  layout: saved.layout,
  mine: label(now.lines[saved.mine]),
  mark: label(now.lines[saved.manual[sys]]),
  markedStaff: saved.markedStaff[sys],
  offBefore: off.map((id) => label(old.lines[id])).sort().join(","),
  offAfter: saved.excluded.map((id) => label(now.lines[id])).sort().join(","),
};
r.ok = r.oldSoprano !== r.newSoprano && r.layout === 4 && r.mine === label(old.lines[sop]) && r.mark === r.mine && r.offBefore.split(",").length === 8 && r.markedStaff === now.lines[r.newSoprano].staffKey && r.offBefore === r.offAfter;
window.result = r;
