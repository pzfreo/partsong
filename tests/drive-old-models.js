// Models from an earlier version (e.g. the 465 pair) are removed from the
// cache once the current ones are stored, so a phone doesn't keep ~100 MB it
// no longer uses. Run against http://127.0.0.1:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
// An old model, whole and in pieces, as an earlier version would have stored it.
const cache = await caches.open("partscanner-models-v1");
const old = new URL("models/encoder_pytorch_model_465-old.onnx", location.href).href;
await cache.put(old, new Response(new Uint8Array(10)));
await cache.put(old + "?piece=0", new Response(new Uint8Array(10)));
document.querySelector("#library-empty .try-sample").click();
await waitFor(() => document.querySelectorAll("#pages img").length === 3 && !$("recognise").disabled, 30000, "sample pages");
await waitFor(() => localStorage.getItem("partsong-reader-fetched"), 900000, "reader downloaded");
const urls = (await cache.keys()).map((k) => k.url);
const r = { old: urls.filter((u) => u.includes("465")).length, current: urls.filter((u) => u.includes("509")).length };
r.ok = r.old === 0 && r.current > 0;
window.result = r;
