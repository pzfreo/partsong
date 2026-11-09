// A cover page (no music) then a page of music, in one scan: the cover is
// skipped and the music page still reads. (Since v211 the reader says "No
// noteheads or clefs found", which app.js's NO_MUSIC didn't match, so a cover
// failed the whole read.) The reader keeps one instance for
// every page (omr-worker.js openPage) and a reported error mustn't break it.
// Run against http://localhost:8765/index.html.
const events = []; window.goatcounter = { count: (e) => events.push(e) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
$("new-scan").click();
await waitFor(() => !$("scan").hidden, 10000, "scan screen");
$("scan-name").value = "Cover test";
const canvas = Object.assign(document.createElement("canvas"), { width: 1200, height: 1600 });
const ctx = canvas.getContext("2d");
ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1200, 1600);
ctx.fillStyle = "black"; ctx.font = "40px sans-serif"; ctx.fillText("Cover page", 400, 800);
const cover = await new Promise((r) => canvas.toBlob(r, "image/png"));
const music = await (await fetch("/testdata/huron_0.png")).blob();
const dt = new DataTransfer();
dt.items.add(new File([cover], "cover.png", { type: "image/png" }));
dt.items.add(new File([music], "music.png", { type: "image/png" }));
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
await waitFor(() => !$("recognise").disabled && document.querySelectorAll("#pages img").length === 2, 20000, "pages added");
$("recognise").click();
// The systems check may come up: carry on through it.
await waitFor(() => {
  if ($("check-done") && !$("check-done").hidden && $("check-done").onclick) $("check-done").click();
  return !$("practice").hidden || events.some((e) => /^read-failed/.test(e.path));
}, 900000, "read done");
const entry = await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result.find((e) => e.title === "Cover test")); }; });
const r = {
  events: events.map((e) => e.path).filter((p) => /^read/.test(p)),
  practice: !$("practice").hidden,
  pages: entry?.pages?.map((p) => (p ? (p.match(/<note>/g) ?? []).length : null)),
};
r.ok = r.practice && r.events.includes("read-skipped-page") && r.events.includes("read-ok") && r.pages?.length === 1 && r.pages[0] > 50; // the cover is left out
window.result = r;
