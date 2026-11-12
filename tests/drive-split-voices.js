// A one-voice staff read with a stray chord in one bar stays one line (Pontio's
// Altus came out twice), while a real divide keeps both lines (Of a Rose's
// soprano splits for its last three bars). Needs the page readings saved in
// testdata/corpus/xml/pontio.json and testdata/corpus/rose.partsong.pdf.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 120 tests/drive-split-voices.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const { buildScore, parsePage } = await import("/score.js");
const r = {};
const pontio = buildScore((await (await fetch("/testdata/corpus/xml/pontio.json")).json()).map(parsePage));
r.pontio = pontio.lines.map((l) => l.label);
await sleep(500);
const dt = new DataTransfer();
dt.items.add(new File([await (await fetch("/testdata/corpus/rose.partsong.pdf")).blob()], "rose.partsong.pdf", { type: "application/pdf" }));
$("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
let entry;
for (let i = 0; i < 40 && !entry; i++) {
  await sleep(500);
  [...document.querySelectorAll("button")].find((b) => b.textContent === "Add" && b.offsetParent)?.click();
  entry = await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result.find((e) => /Rose/i.test(e.title))); }; });
}
const rose = buildScore(entry.pages.map(parsePage));
r.roseSplit = rose.lines.filter((l) => l.voice === "lower").length;
// The parts are numbered by staff (Parts 1-6), so the divide is Part 1's lower
// line, with only its few notes; four staves have a lower line in all.
r.roseDivide = rose.lines.find((l) => l.label === "Part 1 lower")?.notes.length;
// The piano's last system on page 1, read as one staff, goes back on two (by
// the staff each note was read from): the lower piano staff gains its notes.
const plain = buildScore(entry.pages.map((x) => parsePage(x, { restaff: false })));
const count = (s, label) => s.lines.find((l) => l.label === label)?.notes.length;
r.rosePiano = ["Part 6 upper", "Part 6 lower"].map((l) => `${count(plain, l)}>${count(rose, l)}`).join(" ");
// Christ Is King: where soprano and alto share a stem, the reader writes them
// as a chord in the soprano's voice, in bars where the alto also has notes of
// its own. The alto (lower) line keeps the chord's bottom note: bar 22 starts
// with the alto's E flat (it used to be silent until beat 3).
const { readScoreFile } = await import("/share.js");
const cikEntry = await readScoreFile(new File([await (await fetch("/testdata/corpus/cik.partsong.pdf")).blob()], "cik.partsong.pdf"));
const cik = buildScore(cikEntry.pages.map(parsePage));
const bar = (n, line) => { const m = cik.measures[n - 1]; return line.notes.filter((x) => x.t >= m.start - 1e-6 && x.t < m.start + m.length - 1e-6).map((x) => `${x.midi}@${x.t - m.start}`).join(" "); };
const alto = cik.lines.find((l) => l.label === "Alto" && l.staffKey === "2#0/1");
r.cik22 = bar(22, alto);
r.ok = r.pontio.length === 5 && r.roseSplit === 4 && r.roseDivide === 11 && r.rosePiano === "210>228 204>221" && rose.lines.length === 10
  && r.cik22 === "63@0 67@2 68@2.5";
window.result = r;
