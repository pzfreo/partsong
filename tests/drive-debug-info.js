// Debug info in shared scores: a read records which Partsong read it and on
// what (readBy), and a .partsong.pdf carries that plus the version that made
// the file, also after it's opened and shared on. Reads the Tallis sample
// (samples/), then makes its score file. Its last page's lines naming the
// app link to it. Run against /index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(500); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const r = {};
await sleep(500);
const dt = new DataTransfer(); dt.items.add(new File([await (await fetch("/samples/tallis-if-ye-love-me.pdf")).blob()], "tallis.pdf", { type: "application/pdf" }));
$("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
await waitFor(() => /^Check the pages/.test($("status").textContent), 120000, "pages added");
$("recognise").click();
await waitFor(() => !$("practice").hidden, 600000, "read");
const entry = await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result.sort((a, b) => b.created - a.created)[0]); }; });
r.readBy = entry.readBy;
const { scoreFile, readScoreFile } = await import("/share.js");
const file = await scoreFile({ ...entry, images: [] });
const text = new TextDecoder("latin1").decode(await file.arrayBuffer());
r.producer = text.match(/\/Producer \(([^)]*)\)/)?.[1];
r.links = [...text.matchAll(/\/Subtype \/Link [^>]*\/URI \(([^)]*)\)/g)].map((m) => m[1]);
r.notePage = text.match(/\((Read by Partsong[^)]*)\)/)?.[1];
const back = await readScoreFile(file);
r.roundTrip = JSON.stringify(back.readBy) === JSON.stringify(entry.readBy);
const again = new TextDecoder("latin1").decode(await (await scoreFile({ ...back, images: [] })).arrayBuffer());
r.sharedOn = /Read by Partsong dev on \w+, /.test(again);
r.ok = r.readBy?.version === "dev" && !!r.readBy.device && r.readBy.browser === navigator.userAgent && r.producer === "Partsong dev" && /^Read by Partsong dev on \w+, \d{4}-\d\d-\d\d; this file from dev\.$/.test(r.notePage) && r.roundTrip && r.sharedOn && r.links.length === 2 && r.links.every((u) => u === location.origin + "/");
window.result = r;
