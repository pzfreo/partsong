// Two phases: Read music first finds the systems on every page (no staff is
// read yet) and shows them all to check; tapping Read music there reads the
// staves with them. There was a tree, page 1, whose piano the reader leaves
// out of the choir's systems, fixed here reads once with those systems, and
// the parts panel afterwards doesn't ask you to check the systems again.
// Run against http://localhost:8765/index.html.
window.manualCheck = true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = await import("/db.js");
const sc = await import("/score.js");
await sleep(500);
let staffReads = 0;
let pagesRead = 0;
const log = console.log;
console.log = (...a) => {
  const t = a.join(" ");
  if (/Running TrOmr inference/.test(t)) staffReads++;
  if (/Page in \d+ ms/.test(t)) pagesRead++;
  log(...a);
};
const pdf = new File([await (await fetch("/testdata/tree.pdf")).blob()], "tree.pdf", { type: "application/pdf" });
const dt = new DataTransfer(); dt.items.add(pdf);
$("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
await waitFor(() => !$("systems-check").hidden, 900000, "systems check");
await sleep(3000);
const r = { staffsReadBeforeCheck: staffReads, intro: $("check-intro").textContent };
r.pagesShown = [...document.querySelectorAll("#check-list .check-page")].map((p) => p.textContent).join(" | ");
const svg = document.querySelector("#check-list svg");
await waitFor(() => svg.getAttribute("viewBox"), 30000, "photo");
const [, , , h] = svg.getAttribute("viewBox").split(" ").map(Number);
const tap = (y) => {
  const rc = svg.getBoundingClientRect();
  svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rc.left + 0.5 * rc.width, clientY: rc.top + (y / h) * rc.height }));
};
const bands = [[605, 1380], [1720, 2050], [2390, 2870]];
const inside = (y) => bands.some(([top, bottom]) => top < y && y < bottom);
const gaps = () => [...svg.querySelectorAll("line.fix-split, line.fix-gap")].map((l) => ({ y: +l.getAttribute("y1"), split: l.classList.contains("fix-split") }));
r.gapsBefore = gaps().map((g) => (g.split ? "|" : ".")).join("");
for (const g of gaps()) if (g.split === inside(g.y)) tap(g.y);
r.gapsAfter = gaps().map((g) => (g.split ? "|" : ".")).join("");
await shot(false);
r.staffsReadWhileChecking = staffReads;
$("check-done").click();
await waitFor(() => !$("practice").hidden, 900000, "read");
const entry = await waitFor(async () => (await db.all()).find((e) => !e.pending && e.pages?.every(Boolean)), 30000, "saved");
const s = sc.buildScore(entry.pages.map(sc.parsePage));
r.page1 = s.systems.filter((x) => x.page === 0).map((x) => x.staves.length).join(",");
r.pagesRead = pagesRead;
r.hints = entry.systemHints && Object.keys(entry.systemHints).join(",");
r.checkHidden = $("systems-check").hidden;
r.checkedKept = entry.systemsChecked === true;
// The parts are still muddled (tree's layout changes), but the panel doesn't
// send you back to check the systems you've just OK'd.
r.doubtShown = !$("parts-doubt").hidden;
r.fixStepHidden = $("doubt-fix-step").hidden;
r.ok = r.staffsReadBeforeCheck === 0 && r.staffsReadWhileChecking === 0 && r.pagesShown.split(" | ").length === 6 && r.page1 === "6,3,4" && r.pagesRead === 6 && r.hints === "0" && r.checkHidden && r.checkedKept && r.doubtShown && r.fixStepHidden;
window.result = r;
