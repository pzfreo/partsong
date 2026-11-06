// A model piece that disappears from the cache after the reader has started
// (seen on iPhones) is downloaded again and the read carries on, counted as
// "model-refetched (<device> <version>)". Run against http://127.0.0.1:8765/index.html.
const events = []; window.goatcounter = { count: (e) => events.push(e.path) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
document.querySelector("#library-empty .try-sample").click();
await waitFor(() => document.querySelectorAll("#pages img").length === 3 && !$("recognise").disabled, 30000, "sample pages");
await waitFor(() => localStorage.getItem("partsong-reader-fetched"), 900000, "reader downloaded");
const cache = await caches.open("partscanner-models-v1");
// The sample's pages skip segnet, so take the decoder; the local server sends
// models whole, so remove the whole entry and any pieces.
const keys = (await cache.keys()).map((k) => k.url).filter((u) => u.includes("decoder"));
const r = { deleted: (await Promise.all(keys.map((k) => cache.delete(k)))).filter(Boolean).length };
$("recognise").click();
await waitFor(() => !$("practice").hidden || /couldn|failed/i.test($("status").textContent), 900000, "read");
r.read = !$("practice").hidden;
r.bars = $("to-bar").value;
r.storedAgain = (await Promise.all(keys.map((k) => cache.match(k)))).some(Boolean);
r.events = events.filter((e) => /refetch|read-/.test(e));
// The read must have gone through the refetch (a fresh reader would just download it).
r.ok = r.read && r.storedAgain && r.events.some((e) => e.startsWith("model-refetched"));
window.result = r;
