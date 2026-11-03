// Checking the systems while reading: the reader finds every page's systems
// first (before reading any staff), and pages whose systems give other parts
// than most (There was a tree: pages 2, 3 and 5) are shown while the rest is
// read. A change to a page that's already been read reads it again at the
// end, with those systems; the other pages are read once.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = await import("/db.js");
const sc = await import("/score.js");
await sleep(500);
let staffReads = 0;
const pagesRead = [];
const log = console.log;
console.log = (...a) => {
  const t = a.join(" ");
  if (/Running TrOmr inference/.test(t)) staffReads++;
  if (/Page in \d+ ms/.test(t)) pagesRead.push(t);
  log(...a);
};
const pdf = new File([await (await fetch("/testdata/tree.pdf")).blob()], "tree.pdf", { type: "application/pdf" });
const dt = new DataTransfer(); dt.items.add(pdf);
$("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
await waitFor(() => !$("systems-check").hidden, 900000, "systems check");
const r = { staffsReadBeforeCheck: staffReads, intro: $("check-intro").textContent };
r.pagesShown = [...document.querySelectorAll("#check-list .check-page")].map((p) => p.textContent).join(", ");
const svg = document.querySelector("#check-list svg");
await waitFor(() => svg.getAttribute("viewBox"), 30000, "photo");
await shot(false);
// Once page 2 is read, join its first two systems.
await waitFor(() => /Page 3 of/.test($("status").textContent), 600000, "page 2 read");
const [, , , h] = svg.getAttribute("viewBox").split(" ").map(Number);
const split = svg.querySelector("line.fix-split");
const y = +split.getAttribute("y1");
const rc = svg.getBoundingClientRect();
svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rc.left + 0.5 * rc.width, clientY: rc.top + (y / h) * rc.height }));
r.splitsAfterTap = svg.querySelectorAll("line.fix-split").length;
await waitFor(() => !$("practice").hidden, 900000, "read");
const entry = await waitFor(async () => (await db.all()).find((e) => !e.pending && e.pages?.every(Boolean)), 30000, "saved");
const s = sc.buildScore(entry.pages.map(sc.parsePage));
r.page2Systems = s.systems.filter((x) => x.page === 1).map((x) => x.staves.length).join(",");
r.pagesRead = pagesRead.length;
r.hints = entry.systemHints && Object.keys(entry.systemHints).join(",");
r.checkHidden = $("systems-check").hidden;
r.checkedKept = "systemsChecked" in entry;
r.ok = r.staffsReadBeforeCheck === 0 && r.pagesShown === "Page 2, Page 3, Page 5" && r.pagesRead === 7 && r.hints === "1" && r.checkHidden && !r.checkedKept;
window.result = r;
