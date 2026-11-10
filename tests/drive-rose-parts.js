// Of a Rose (SATB and piano throughout) is numbered by staff even though the
// reader reads its piano differently in places (as two staves, one, or two
// separate parts) and, on pp. 4 and 11, its tenor and bass staves as a piano:
// Parts 1-4 are soprano, alto, tenor, bass, with notes in every system, and
// the piano (Parts 5, 6) starts switched off. testdata/roseshare_N.musicxml
// is the reading a singer shared (Android, Nov 2026).
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-rose-parts.js
const { buildScore, parsePage } = await import("/score.js");
const pages = await Promise.all([...Array(11).keys()].map((i) => fetch(`/testdata/roseshare_${i}.musicxml`).then((r) => r.text())));
const s = buildScore(pages.map(parsePage));
const voice = (hint) => s.lines.filter((l) => l.hint === hint);
const sings = (hint, sys) => voice(hint).some((l) => l.notes.some((n) => n.t >= sys.start && n.t < sys.end));
const r = {
  by: s.numbered,
  parts: s.lines.map((l) => `${l.label}${l.hint ? ` ${l.hint}` : ""}${l.accompaniment ? " off" : ""}`).join(", "),
  // Systems where a voice has no notes (the score has none resting a whole system).
  silent: ["Soprano", "Alto", "Tenor", "Bass"].flatMap((h) => s.systems.filter((sys) => !sings(h, sys)).map((sys) => `${h} p${sys.page + 1}`)),
};
r.ok = r.by === "staff" && /^Part 1 upper Soprano, Part 1 lower Soprano, Part 2 Alto, Part 3 Tenor, Part 4 upper Bass, Part 4 lower Bass, Part 5 upper Piano off, Part 5 lower Piano off, Part 6 upper Piano off, Part 6 lower Piano off$/.test(r.parts) && !r.silent.length;
window.result = r;
