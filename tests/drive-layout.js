// Bars lined up system by system (layout 2): on Of A Rose p. 11 one part's
// split bar 79 shifted it a bar against the others (bar 80's box covered the
// page). Opening the share, saved under layout 1 with your part marked by
// system, moves the marks to the same systems: the last system's mark (old
// system 22, after a misread one-bar system 21) becomes system 21.
// Needs testdata/of-a-rose.partsong.pdf (a share of that score; not in git).
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(1000);
const f = new File([await (await fetch("/testdata/of-a-rose.partsong.pdf")).blob()], "Of A Rose.partsong.pdf", { type: "application/pdf" });
const dt = new DataTransfer(); dt.items.add(f); $("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
await waitFor(() => !$("practice").hidden, 30000, "practice");
await sleep(4000);
const saved = await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result); }; });
const e = saved.find((x) => x.title === "Of A Rose");
const { parsePage, buildScore } = await import("/score.js");
const s = buildScore(e.pages.map(parsePage));
const pages = [...document.querySelectorAll("#photo-list .page")];
const r = {
  bars: s.measures.length,
  lastPage: s.measures.filter((m) => m.page === 10).map((m) => `${m.number}:sys${m.system}`).join(" "),
  layout: e.layout,
  manualKeys: Object.keys(e.manual).map(Number).sort((a, b) => a - b).join(","),
  page11: [...pages[10].querySelectorAll(".mark-label")].map((t) => t.textContent),
  marksPerPage: pages.map((p) => p.querySelectorAll("rect.mark").length).join(","),
};
r.ok = r.bars === 83 && r.lastPage === "76:sys20 77:sys20 78:sys20 79:sys20 80:sys21 81:sys21 82:sys21 83:sys21" && r.layout === 3 &&
  r.manualKeys === [...Array(22).keys()].join(",") && r.page11.join() === "upper voice" && r.marksPerPage === Array(11).fill(2).join(",");
window.result = r;
