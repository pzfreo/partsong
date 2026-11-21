// An iPhone sometimes refuses the 4 GB of room to grow that onnxruntime asks
// for ("RangeError: Out of memory": every out-of-memory failed read on iPhones
// and iPads, v307-v319). The reader then asks for less and reads the page all
// the same. Here anything over 1 GB is refused (the test switch
// partsong-memory-max, in 64 KB pages).
// Run against http://127.0.0.1:8765/index.html?exact=1 for a page that is
// cross-origin isolated after its first load, or localhost for one thread.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label + " | " + $("status").textContent); };
const $ = (id) => document.getElementById(id);
localStorage.setItem("partsong-memory-max", "16384");
const lines = [];
const log = console.log;
console.log = (...a) => { lines.push(a.join(" ")); log(...a); };
await sleep(500);
$("new-scan").click();
await waitFor(() => !$("scan").hidden, 10000, "scan");
const blob = await (await fetch("/testdata/huron_1.png")).blob();
const dt = new DataTransfer(); dt.items.add(new File([blob], "huron_1.png", { type: "image/png" }));
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
await waitFor(() => !$("recognise").disabled, 30000, "page added");
$("recognise").click();
await waitFor(() => !$("check-done").hidden || /Couldn't/.test($("status").textContent), 600000, "systems found");
const failed = /Couldn't/.test($("status").textContent) ? $("status").textContent : null;
if (!failed) {
  $("check-done").click();
  await waitFor(() => !$("practice").hidden || /Couldn't/.test($("status").textContent), 900000, "read");
}
localStorage.removeItem("partsong-memory-max");
const refused = lines.filter((l) => /Memory: .* was refused/.test(l)).map((l) => l.replace(/^.*Memory: /, ""));
window.result = { isolated: crossOriginIsolated, refused, failed, status: $("status").textContent, read: !$("practice").hidden, bars: $("to-bar")?.value, ok: !$("practice").hidden && (!crossOriginIsolated || refused.length > 0) };
