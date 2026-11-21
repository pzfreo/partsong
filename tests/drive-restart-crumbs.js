// A read the phone closed leaves breadcrumbs in storage (the reader's last
// messages, with when the read started and when the page last ran); the
// restart's record in the problem log carries them, so it says what the
// reader was doing when the page went.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seed = (resumes, images = []) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); const s = tx.objectStore("scores"); s.clear(); if (resumes != null) s.put({ id: "cut", title: "Cut off", created: 1, images, pages: images.map(() => null), pending: true, resumes }); tx.oncomplete = () => { q.result.close(); res(); }; }; });
const now = Date.now();
// As a read left it: started 40 s ago, last message 12 s ago, page last ran 10 s ago.
localStorage.setItem("partsong-read-crumbs", JSON.stringify({ start: now - 40000, alive: now - 10000, lines: [[now - 30000, "reading the notes: page 1 of 1"], [now - 12000, "Running TrOmr inference on staff image 3"]] }));
localStorage.setItem("partsong.relay", "http://localhost:9"); // nothing there: the records are caught below
await seed(0);
const f = document.createElement("iframe");
f.src = "/index.html";
document.body.append(f);
const sent = [];
const Reader = class { postMessage() {} terminate() {} };
const stub = setInterval(() => { try { const w = f.contentWindow; w.Worker = Reader; if (!w.fetchStubbed) { w.fetchStubbed = true; const real = w.fetch.bind(w); w.fetch = (url, init) => (String(url).endsWith("/log") ? (sent.push(JSON.parse(init.body)), Promise.resolve(new Response(null, { status: 201 }))) : real(url, init)); } } catch {} }, 2);
await sleep(5000);
clearInterval(stub);
f.remove();
localStorage.removeItem("partsong.relay"); localStorage.removeItem("partsong-read-crumbs");
const rec = sent.find((s) => s.kind === "read-restarted");
window.result = { record: rec && { kind: rec.kind, message: rec.message, stage: rec.stage, reader: rec.reader, detail: rec.detail }, ok: !!rec && /staff image 3$/.test(rec.reader) && rec.reader.split("\n").length === 2 && rec.detail.ranSecs === 28 && rec.detail.quietSecs === 2 && rec.detail.goneSecs >= 10 && rec.detail.goneSecs < 30 };
