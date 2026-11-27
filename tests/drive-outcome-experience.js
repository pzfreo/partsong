// Read outcomes counted by who the singer is ("read-outcome (new|experienced): ..."):
//   CHROME_FLAGS="--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND" node scripts/headless-test.mjs \
//     http://localhost:8765/index.html out.json 120 tests/drive-outcome-experience.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seed = (resumes, images = [], extra = {}) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); const s = tx.objectStore("scores"); s.clear(); if (resumes != null) s.put({ id: "cut", title: "Cut off", created: 1, images, pages: images.map(() => null), pending: true, resumes, ...extra }); tx.oncomplete = () => { q.result.close(); res(); }; }; });
// reader: a stand-in reader that only notes how it was started (init).
const inits = [];
const open = async (reader = false) => {
  const f = document.createElement("iframe");
  f.src = "/index.html";
  document.body.append(f);
  const events = [];
  const Reader = class { postMessage(m) { if (m.type === "init") inits.push(m); } terminate() {} };
  const stub = setInterval(() => { try { f.contentWindow.goatcounter = { count: (e) => events.push(e.path) }; if (reader) f.contentWindow.Worker = Reader; } catch {} }, 5);
  await sleep(5000);
  clearInterval(stub);
  f.remove();
  return events.filter((p) => /^read-/.test(p));
};
const r = {};
const outcome = (events) => events.filter((p) => p.startsWith("read-outcome")).join(",");
const set = (reads, played) => { reads == null ? localStorage.removeItem("partsong-reads") : localStorage.setItem("partsong-reads", reads); played ? localStorage.setItem("partsong-played", "1") : localStorage.removeItem("partsong-played"); };
const saved = [localStorage.getItem("partsong-reads"), localStorage.getItem("partsong-played")];
// A read cut off and carried on (a restart), and one given up, by who the singer is.
set(null, false); await seed(0); r.fresh = outcome(await open());
set(3, false); await seed(0); r.readNotPlayed = outcome(await open());
set(1, true); await seed(0); r.experienced = outcome(await open());
set(1, true); await seed(2); r.gaveUp = outcome(await open());
// The sample isn't counted.
set(null, false); await seed(0, [], { sample: true }); r.sample = outcome(await open());
// A page that can't be read: restarted, then the read fails.
set(null, false); await seed(0, [new Blob(["not an image"], { type: "image/png" })]); r.failed = outcome(await open());
await seed(null);
set(saved[0], saved[1] === "1");
// (The seeded scan has no pages, so after its restart it "reads" at once: ok.)
r.ok = r.sample === "" && r.fresh === "read-outcome (new): restarted,read-outcome (new): ok" && r.readNotPlayed === "read-outcome (new): restarted,read-outcome (new): ok"
  && r.experienced === "read-outcome (experienced): restarted,read-outcome (experienced): ok" && /^read-outcome \(new\): restarted,read-outcome \(new\): (failed|no music)$/.test(r.failed) && r.gaveUp === "read-outcome (experienced): gave up";
window.result = r;
