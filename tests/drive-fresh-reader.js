// Once the systems are found, a new reader is started for the notes (the
// staff finder's memory is never given back: WebAssembly memory can't
// shrink). Two pages read through: the reader starts twice, and the notes
// read are the same as before the change (EXPECT: the read by 8f6bad5, the
// commit before the new reader; a new model changes it, so it's re-recorded
// then).
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label + " | " + $("status").textContent); };
const EXPECT = { notes: "ebc887d3ca41e327", bars: "38", lines: 10 };
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
$("check-done").click();
await waitFor(() => !$("practice").hidden || /Couldn't/.test($("status").textContent), 900000, "read");
const lines = [...document.querySelectorAll("#lines .line-name, #lines label")].length;
// What was read: a digest of the saved pages' MusicXML.
const entry = await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result.sort((a, b) => b.created - a.created)[0]); }; });
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entry.pages.join("\n")));
const notes = [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
const bars = $("to-bar").value;
window.result = { order, read: !$("practice").hidden, notes, bars, lines, ok: !$("practice").hidden && order.join() === "reader started,systems found,systems found,reader started,page read,page read" && notes === EXPECT.notes && bars === EXPECT.bars && lines === EXPECT.lines };
