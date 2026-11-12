// A score saved under an earlier layout keeps its part choices when the parts
// change: your part, the parts switched off, and a mark move to the lines with
// the same music. Layout 3 put a pair of staves the reader wrote as one back
// on two; layout 4 numbers the parts from the top (score.js numberParts).
// Uses testdata/corpus/rose.partsong.pdf saved as under layout 2, where it had
// 20 lines matched by what the reader called them; now it has 10, by staff.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 120 tests/drive-restaff-migrate.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = (mode, fn) => new Promise((res, rej) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out.result ?? out); tx.onerror = rej; }; });
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
const old = buildScore(entry.pages.map((x) => parsePage(x, { restaff: false })), { numbers: false }); // as layout 2 had the parts
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
// The share of an old line's notes that a line has now.
const kept = (from, to) => { const set = new Set((to?.notes ?? []).map((n) => `${n.t}:${n.midi}`)); return from.notes.filter((n) => set.has(`${n.t}:${n.midi}`)).length / from.notes.length; };
const r = {
  linesBefore: old.lines.length,
  linesNow: now.lines.length,
  was: label(old.lines[sop]),
  layout: saved.layout,
  mine: label(now.lines[saved.mine]),
  mineKeepsNotes: kept(old.lines[sop], now.lines[saved.mine]),
  mark: label(now.lines[saved.manual[sys]]),
  markedStaff: saved.markedStaff[sys],
  markedStaffHasLine: !!now.systems[sys].staves.find((st) => st.key === saved.markedStaff[sys])?.lines.includes(saved.mine),
  offBefore: off.length,
  offAfter: saved.excluded.map((id) => label(now.lines[id])).sort().join(","),
};
// The old line 2#1/1 upper was called a piano but is the top staff's music in
// its systems, so it's Part 1 upper now; the real piano's four lines stay off.
r.ok = r.linesBefore === 20 && r.linesNow === 10 && r.layout === 4 && r.mineKeepsNotes === 1 && r.mine === "Part 1 upper 1#0/1 upper" && r.mark === r.mine && r.markedStaffHasLine && r.offBefore === 8
  && r.offAfter === "Part 1 upper 1#0/1 upper,Part 5 lower 1#4/1 lower,Part 5 upper 1#4/1 upper,Part 6 lower 1#5/1 lower,Part 6 upper 1#5/1 upper";
window.result = r;
