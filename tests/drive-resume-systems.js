// Interrupted while finding systems: start a 4-page scan in an iframe, kill it
// once page 2's systems are found (before any page is read), then load a
// fresh app and check it carries on from page 3 rather than finding every
// page's systems again (a phone that keeps closing the app never got past
// this on a long score), and that the finished score keeps no layouts.
// Run with host page http://localhost:8765/testdata/.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const app = async () => {
  const f = document.createElement("iframe");
  f.style.cssText = "width:412px;height:900px;border:0";
  f.src = "/index.html?" + Math.random();
  document.body.prepend(f);
  await waitFor(() => f.contentWindow.document.getElementById("new-scan"), 20000, "app");
  return { f, w: f.contentWindow, $: (id) => f.contentWindow.document.getElementById(id) };
};
const scans = () => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result); }; });
const entry = async () => (await scans()).find((e) => e.title === "Interrupted systems");
const r = {};

let a = await app();
a.$("new-scan").click();
const dt = new a.w.DataTransfer();
for (const i of [0, 1, 2, 3]) dt.items.add(new a.w.File([await (await fetch(`/testdata/huron_${i}.png`)).blob()], `p${i}.png`, { type: "image/png" }));
a.$("gallery").files = dt.files; a.$("gallery").dispatchEvent(new a.w.Event("change"));
await waitFor(() => a.w.document.querySelectorAll("#pages img").length === 4 && !a.$("recognise").disabled, 20000, "pages added");
a.$("scan-name").value = "Interrupted systems";
a.$("recognise").click();
await waitFor(async () => (await entry())?.found?.filter(Boolean).length >= 2, 300000, "two pages' systems saved");
a.f.remove(); // the tab is killed while finding systems
await sleep(500);
const mid = await entry();
r.savedMidway = { pending: mid.pending, images: mid.images.length, found: mid.found.filter(Boolean).length, read: mid.pages.filter(Boolean).length, classes: mid.found.filter((f) => f?.classes?.length).length };

let b = await app(); // reopening the app
const waits = [];
await waitFor(() => { const t = b.$("check-wait")?.textContent ?? ""; if (t && waits.at(-1) !== t) waits.push(t); return !b.$("practice").hidden; }, 300000, "resumed and finished");
r.findingAfterResume = waits.filter((t) => /page \d of 4/.test(t));
r.bars = b.$("to-bar").value;
const done = await entry();
r.final = { pending: done.pending, read: done.pages.filter(Boolean).length, found: "found" in done };
r.ok = r.savedMidway.images === 4 && r.savedMidway.read === 0 && r.savedMidway.found >= 2 && r.savedMidway.classes >= 2 && !r.findingAfterResume.some((t) => /page [12] of 4/.test(t)) && done.pending === false && r.final.read === 4 && !r.final.found;
window.result = r;
