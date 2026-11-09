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
// 10, not 9: the piano's last system on page 1, read as one staff, goes back
// on two staves (by the staff each note was read from), each with an upper and
// lower line, so it can be marked staff by staff. It stays its own part, with
// plain names (it could as well be singers), rather than joining the piano.
r.rose16 = rose.lines.filter((l) => /^Part 1\.6 /.test(l.label)).map((l) => `${l.staffKey} ${l.voice}`).join(",");
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
r.ok = r.pontio.length === 5 && r.roseSplit === 10 && r.rose16 === "1#6/1 upper,1#6/1 lower,1#6/2 upper,1#6/2 lower" && !rose.lines.some((l) => l.label === "Soprano")
  && r.cik22 === "63@0 67@2 68@2.5";
window.result = r;
