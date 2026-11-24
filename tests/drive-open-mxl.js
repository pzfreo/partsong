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
const counted = [];
window.goatcounter = { count: (o) => counted.push(o.path) };
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
// The score named in container.xml, whose name has "&" (written "&amp;"), not another .xml in the zip.
open(new File([await (await fetch("testdata/corpus/ave-amp-name.mxl")).arrayBuffer()], "ave.mxl"));
await waitFor(() => !$("practice").hidden && partNames().length, 20000, "ave");
r.ampName = partNames().join();
$("back").click(); await sleep(500);
// A piano whose left hand alone is hidden keeps its printed right hand.
const note = '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>';
const pianoXml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Hidden left hand</work-title></work><part-list><score-part id="P1"><part-name>Melody</part-name></score-part><score-part id="P2"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${note}</measure></part>
<part id="P2"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef><staff-details number="2" print-object="no"/></attributes>${note.replace("<voice>", "<staff>1</staff><voice>")}</measure></part></score-partwise>`;
open(new File([pianoXml], "piano.musicxml"));
await waitFor(() => !$("practice").hidden, 20000, "piano");
r.pianoParts = ((await idb("readonly", (s) => s.getAll())).at(-1).pages[0].match(/<part id=/g) ?? []).length;
$("back").click(); await sleep(500);
open(new File([new Uint8Array(bytes).slice(0, 2000)], "broken.mxl"));
await sleep(1500);
r.broken = $("library-status").textContent;
r.counted = counted.filter((p) => p.startsWith("open: musicxml"));
r.ok = /Bleak/i.test(r.title) && r.pages === 1 && r.staves === 2 && !r.doubt && r.parts.join() === "Soprano,Alto,Tenor,Bass" &&
  r.pontio.join() === "Cantus (G2),Altus (C2),Quintus (C3),Tenor (C3),Bassus (F3)" && !r.fontSymbols && r.ampName === "Soprano,Alto,Tenor,Bass" && r.pianoParts === 2 && /isn't a Partsong score/.test(r.broken) &&
  r.counted.filter((p) => p === "open: musicxml").length === 5 && r.counted.some((p) => /^open: musicxml \(.+\): mxl$/.test(p)) && r.counted.some((p) => /: xml$/.test(p));
window.result = r;
