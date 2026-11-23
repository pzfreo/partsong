// A .mxl file (compressed MusicXML, as CPDL offers) opens straight into
// practice with no reading: CPDL's In the Bleak Midwinter, from testdata.
// A broken zip says it isn't a score file.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-open-mxl.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const idb = (mode, fn) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out?.result ?? out); }; });
const open = (file) => { const dt = new DataTransfer(); dt.items.add(file); $("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change")); };
await sleep(500);
const bytes = await (await fetch("testdata/corpus/In_the_Bleak_Midwinter_Cranham.mxl")).arrayBuffer();
open(new File([bytes], "In_the_Bleak_Midwinter_Cranham.mxl"));
await waitFor(() => !$("practice").hidden, 20000, "practice");
const got = (await idb("readonly", (s) => s.getAll())).at(-1);
const r = { title: got.title, pages: got.pages.length, starts: got.pages[0].slice(0, 60), parts: [...document.querySelectorAll("#parts input, #parts button, .part-name")].length };
$("back").click(); await sleep(500);
open(new File([new Uint8Array(bytes).slice(0, 2000)], "broken.mxl"));
await sleep(1500);
r.broken = $("library-status").textContent;
r.ok = /Bleak/i.test(r.title) && r.pages === 1 && r.starts.includes("<?xml") && /isn't a Partsong score/.test(r.broken);
window.result = r;
