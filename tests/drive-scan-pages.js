// The scan's pages while they change. Read music waits until every page of a
// PDF is in; pages still arriving when another scan is opened aren't added to
// it; and a page turned after its systems were found has them found again
// (the old ones were drawn over the turned picture, and read with).
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label + " | " + $("status").textContent); };
const $ = (id) => document.getElementById(id);
const file = async (name, type) => new File([await (await fetch("/testdata/" + name)).blob()], name, { type });
const add = (files) => { const dt = new DataTransfer(); for (const f of files) dt.items.add(f); $("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change")); };
const tiles = () => document.querySelectorAll("#pages li").length;
let found = "";
const log = console.log;
console.log = (...a) => { if (/Systems \(staves in each\)/.test(a.join(" "))) found = a.join(" "); log(...a); };
await sleep(500);
const r = {};
$("new-scan").click();
await waitFor(() => !$("scan").hidden, 10000, "scan");
add([await file("tree.pdf", "application/pdf")]);
r.readWaitsWhileAdding = $("recognise").disabled;
await waitFor(() => tiles() >= 1, 60000, "first PDF page");
r.readStillWaits = $("recognise").disabled;
// Another scan opened part-way through the PDF: its remaining pages don't land in it.
$("back").click(); await sleep(400);
$("new-scan").click(); await sleep(8000);
r.strayPages = tiles();
r.readOffWhenEmpty = $("recognise").disabled;
// Two photos; Cancel once page 1's systems are found, turn page 1, read again.
add([await file("cam_0_exif1.jpg", "image/jpeg"), await file("cam_1_exif1.jpg", "image/jpeg")]);
await waitFor(() => tiles() === 2 && !$("recognise").disabled, 60000, "photos added");
$("recognise").click();
await waitFor(() => document.querySelectorAll("#check-list .check-page").length >= 1, 600000, "page 1's systems");
r.page2FoundBeforeCancel = !$("check-done").hidden;
$("check-stop").click();
await waitFor(() => $("systems-check").hidden && $("recognise").textContent === "Read music", 30000, "cancelled");
const src = document.querySelector("#pages li img").src;
document.querySelector("#pages li .rotate").click();
await waitFor(() => document.querySelector("#pages li img").src !== src, 30000, "turned");
$("recognise").click();
await waitFor(() => !$("check-done").hidden || /Couldn't|doesn't look/.test($("status").textContent), 600000, "systems found again");
r.foundAfterTurn = found.replace(/^.*: /, "");
r.pagesToCheck = [...document.querySelectorAll("#check-list .check-page")].map((p) => p.textContent.trim().slice(0, 6));
$("check-stop").hidden ? $("back").click() : $("check-stop").click();
// Page 1, sideways now, was looked at again and has no systems (before, its
// upright systems were kept and shown); page 2's are found as usual.
r.ok = r.readWaitsWhileAdding && r.readStillWaits && r.strayPages === 0 && r.readOffWhenEmpty && !r.page2FoundBeforeCancel && /^p1 none parts -; p2 [\d,]+ parts/.test(r.foundAfterTurn);
window.result = r;
