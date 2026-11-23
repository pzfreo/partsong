// A .mxl file (compressed MusicXML, as CPDL offers) opens straight into
// practice with no reading. CPDL's In the Bleak Midwinter keeps a hidden staff
// for each voice besides the SA/TB staves printed: only the printed two are
// drawn, and the four voices sorted. Pontio's five voices keep the names the
// file gives them; a Finale export's font symbols in its words are left out.
// A broken zip says it isn't a score file.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-open-mxl.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const idb = (mode, fn) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out?.result ?? out); }; });
const open = (file) => { const dt = new DataTransfer(); dt.items.add(file); $("open-musicxml").files = dt.files; $("open-musicxml").dispatchEvent(new Event("change")); };
await sleep(500);
const bytes = await (await fetch("testdata/corpus/In_the_Bleak_Midwinter_Cranham.mxl")).arrayBuffer();
open(new File([bytes], "In_the_Bleak_Midwinter_Cranham.mxl"));
await waitFor(() => !$("practice").hidden, 20000, "practice");
const got = (await idb("readonly", (s) => s.getAll())).at(-1);
const partNames = () => [...$("parts-list").innerText.matchAll(/^(.+)\n[A-G][#b]?\d–/gm)].map((m) => m[1].trim());
await waitFor(() => partNames().length, 10000, "parts");
const r = { title: got.title, pages: got.pages.length, staves: (got.pages[0].match(/<part id=/g) ?? []).length, doubt: !$("parts-doubt").hidden, parts: partNames() };
$("back").click(); await sleep(500);
open(new File([await (await fetch("testdata/corpus/Pontio_Surrexit_pastor_bonus_a5.mxl")).arrayBuffer()], "Pontio.mxl"));
await waitFor(() => !$("practice").hidden && partNames().length, 20000, "Pontio");
r.pontio = partNames();
$("back").click(); await sleep(500);
// A Finale export's lyric marks in its font's private symbols (boxes) are left out.
open(new File([await (await fetch("testdata/corpus/RiberaFaig.ABetlemMEnVullAnar.mxl")).arrayBuffer()], "Ribera.mxl"));
await waitFor(() => !$("practice").hidden && partNames().length, 20000, "Ribera");
r.fontSymbols = /[\uE000-\uF8FF]/.test((await idb("readonly", (s) => s.getAll())).at(-1).pages.join(""));
$("back").click(); await sleep(500);
open(new File([new Uint8Array(bytes).slice(0, 2000)], "broken.mxl"));
await sleep(1500);
r.broken = $("library-status").textContent;
r.ok = /Bleak/i.test(r.title) && r.pages === 1 && r.staves === 2 && !r.doubt && r.parts.join() === "Soprano,Alto,Tenor,Bass" &&
  r.pontio.join() === "Cantus (G2),Altus (C2),Quintus (C3),Tenor (C3),Bassus (F3)" && !r.fontSymbols && /isn't a Partsong score/.test(r.broken);
window.result = r;
