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
// 8, not 9: one system's piano staves, read as a single staff, now go back on
// two staves (by the staff each note was read from) and join the piano part,
// instead of making an extra part with an upper and lower line.
r.rosePianoParts = new Set(rose.lines.filter((l) => l.label.startsWith("Piano")).map((l) => l.staffKey.split("/")[0])).size;
r.roseOddParts = rose.lines.filter((l) => /^Part 1\.6/.test(l.label)).length;
r.ok = r.pontio.length === 5 && r.roseSplit === 8 && r.rosePianoParts === 2 && r.roseOddParts === 0;
window.result = r;
