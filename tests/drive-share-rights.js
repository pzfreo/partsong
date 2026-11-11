// Before a score first leaves the device (link, recording or PDF), Partsong
// asks "Are you allowed to share this music?", once per score: Cancel shares
// nothing and asks again next time; Yes is remembered for that score only,
// and isn't carried to the people it's shared with. A received score's Add
// question says to add it only if you're allowed to use the music.
// Run against http://localhost:8765/index.html.
localStorage.setItem("partsong.relay", "http://localhost:9");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = (mode, fn) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out?.result ?? out); }; });
const pages = [await (await fetch("/testdata/huron_0.musicxml")).text()];
await db("readwrite", (s) => { s.put({ id: "a", title: "Score A", created: 2, pages, images: [] }); s.put({ id: "b", title: "Score B", created: 1, pages, images: [] }); });
const events = []; window.goatcounter = { count: (e) => events.push(e.path) };
const shared = [];
Object.defineProperty(navigator, "userAgentData", { value: { mobile: true }, configurable: true });
navigator.canShare = () => true;
navigator.share = async (d) => { shared.push(d); };
$("new-scan").click(); history.back(); await sleep(500);
await waitFor(() => document.querySelectorAll("#library li").length === 2, 5000, "library");
const open = async (title) => { [...document.querySelectorAll("#library button")].find((b) => b.textContent.includes(title)).click(); await waitFor(() => !$("practice").hidden, 10000, "score"); await sleep(300); };
const r = {};
await open("Score A");
$("export-pdf").click();
await waitFor(() => !$("rights").hidden, 3000, "rights question");
r.asked = $("rights-heading").textContent;
await shot(false);
$("rights-no").click(); await sleep(1500);
r.afterCancel = { hidden: $("rights").hidden, shared: shared.length, saved: !!(await db("readonly", (s) => s.get("a"))).shareAllowed };
$("export-pdf").click();
await waitFor(() => !$("rights").hidden, 3000, "asked again");
$("rights-yes").click();
await waitFor(() => shared.length === 1, 20000, "PDF shared");
r.savedA = !!(await db("readonly", (s) => s.get("a"))).shareAllowed;
// Not asked again for this score, whichever way it's sent.
$("share-score").click(); await sleep(400);
r.askedAgainA = !$("rights").hidden;
if (r.askedAgainA) $("rights-no").click();
await sleep(1500);
// A different score is asked about.
history.back(); await sleep(500);
await open("Score B");
$("share-audio").click(); await sleep(400);
r.askedB = !$("rights").hidden;
$("rights-no").click(); await sleep(300);
// The file sent doesn't carry the answer.
const { readScoreFile } = await import("/share.js");
const got = await readScoreFile(shared[0].files[0]);
r.carried = JSON.stringify(got).includes("shareAllowed");
// Receiving: the Add question says to add it only if allowed.
r.receiveNote = document.querySelector("#import-offer .hint")?.textContent ?? "";
r.events = events.filter((e) => /^share-(not-)?allowed$/.test(e));
r.ok = r.asked === "Are you allowed to share this music?" && r.afterCancel.hidden && r.afterCancel.shared === 0 && !r.afterCancel.saved && r.savedA && !r.askedAgainA && r.askedB && !r.carried && /allowed to use this music/.test(r.receiveNote) && r.events.join() === "share-not-allowed,share-allowed,share-not-allowed";
window.result = r;
