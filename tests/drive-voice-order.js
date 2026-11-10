// Parts numbered by voice when the layout changes (score.js numberParts): In the Bleak Midwinter
// laid out with verse 1 on four staves and verse 4 on two (S+A, T+B), as read
// (testdata/bleakdemo_N.musicxml, from scripts/video/difficult-scores/score.ly
// with its systems fixed). Matching parts by staff layout gave eight muddled
// lines ("Soprano" was page 1's tenor). Every system has the same four voices
// top to bottom, so it's Parts 1-4 (soprano? alto? tenor? bass?), and part 2 is
// page 1's second staff and page 2's lower voice on the top staff. A score
// saved under layout 3 with the old line holding page 1's alto as its part
// keeps part 2.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-voice-order.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = (mode, fn) => new Promise((res, rej) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out.result ?? out); tx.onerror = rej; }; });
const { buildScore, parsePage } = await import("/score.js");
const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const nn = (m) => names[m % 12] + (Math.floor(m / 12) - 1);
const pages = await Promise.all([0, 1].map((i) => fetch(`/testdata/bleakdemo_${i}.musicxml`).then((r) => r.text())));
const now = buildScore(pages.map(parsePage));
const old = buildScore(pages.map(parsePage), { numbers: false });
const bar = (line, b) => { const m = now.measures[b - 1]; return line.notes.filter((n) => n.t >= m.start && n.t < m.start + m.length).map((n) => nn(n.midi)).join(" "); };
const alto = now.lines.find((l) => l.hint === "Alto");
// The old line with most of page 1's alto (its second staff).
const oldAlto = old.systems[0].staves[1].lines[0];
await db("readwrite", (s) => s.put({ id: "bleak", title: "Bleak", created: 1, pages, layout: 3, mine: oldAlto }));
await sleep(300);
location.hash = ""; $("new-scan").click(); history.back(); await sleep(600);
await waitFor(() => [...document.querySelectorAll("#library button")].find((b) => b.textContent.includes("Bleak")), 5000, "library").then((b) => b.click());
await waitFor(() => !$("practice").hidden, 20000, "score");
await sleep(500);
const saved = await db("readonly", (s) => s.get("bleak"));
const r = {
  labels: now.lines.map((l) => `${l.label} ${l.hint}`).join(","),
  by: now.numbered,
  oldLines: old.lines.length,
  altoBar1: bar(alto, 1), // page 1, its own staff: F4 F4 F4 C4
  altoBar23: bar(alto, 23), // page 2, lower voice on the top staff: D4 D4
  page2Top: now.systems[5].staves[0].lines.map((id) => now.lines[id].hint).join("+"),
  layout: saved.layout,
  mine: now.lines[saved.mine]?.label,
  doubt: !$("parts-doubt").hidden,
  shown: [...document.querySelectorAll("#lines li .pick")].map((l) => l.textContent.replace(/\s+/g, " ").trim()).join(" | "),
};
r.ok = r.labels === "Part 1 Soprano,Part 2 Alto,Part 3 Tenor,Part 4 Bass" && r.by === "voice" && !r.doubt && r.oldLines === 8 && r.altoBar1 === "F4 F4 F4 C4" && r.altoBar23 === "D4 D4" &&
  r.page2Top === "Soprano+Alto" && r.layout === 4 && r.mine === "Part 2";
window.result = r;
