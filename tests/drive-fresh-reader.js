// Once the systems are found, a new reader is started for the notes (the
// staff finder's memory is never given back: WebAssembly memory can't
// shrink). Two pages read through: the reader starts twice, and the read
// is the same as ever.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label + " | " + $("status").textContent); };
const $ = (id) => document.getElementById(id);
const order = [];
const log = console.log;
console.log = (...a) => { const t = a.join(" "); if (/WASM threads/.test(t)) order.push("reader started"); else if (/Systems in/.test(t)) order.push("systems found"); else if (/Page in/.test(t)) order.push("page read"); log(...a); };
await sleep(500);
$("new-scan").click();
await waitFor(() => !$("scan").hidden, 10000, "scan");
const dt = new DataTransfer();
for (const f of ["cam_0_exif1.jpg", "cam_1_exif1.jpg"]) dt.items.add(new File([await (await fetch("/testdata/" + f)).blob()], f, { type: "image/jpeg" }));
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
await waitFor(() => !$("recognise").disabled, 60000, "pages added");
$("recognise").click();
await waitFor(() => !$("check-done").hidden, 600000, "systems found");
order.push("check screen");
$("check-done").click();
await waitFor(() => !$("practice").hidden || /Couldn't/.test($("status").textContent), 900000, "read");
const lines = [...document.querySelectorAll("#lines .line-name, #lines label")].length;
window.result = { order, read: !$("practice").hidden, bars: $("to-bar").value, ok: !$("practice").hidden && order.join() === "reader started,systems found,systems found,reader started,check screen,page read,page read" };
