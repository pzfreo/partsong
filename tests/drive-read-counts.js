// Each new score read is counted with how many this device has read and on
// which of its days of use ("read-ok: score 2, day 2"); the sample isn't.
// A one-page scan left unfinished is carried on at launch, as after the
// phone closed the app. GoatCounter is kept out so the stand-in counts:
//   CHROME_FLAGS="--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND" node scripts/headless-test.mjs \
//     http://localhost:8765/index.html out.json 600 tests/drive-read-counts.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const png = await (await fetch("/testdata/huron_0.png")).blob();
const seed = (extra) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); const s = tx.objectStore("scores"); s.clear(); if (extra) s.put({ id: "count", title: "Count", created: 1, images: [png], pages: [null], pending: true, resumes: 0, ...extra }); tx.oncomplete = () => { q.result.close(); res(); }; }; });
const yesterday = new Date(Date.now() - 864e5).toLocaleDateString("en-CA");
const launch = async () => {
  const f = document.createElement("iframe");
  f.src = "/index.html";
  document.body.append(f);
  const events = [];
  const stub = setInterval(() => { try { f.contentWindow.goatcounter = { count: (e) => events.push(e.path) }; } catch {} }, 20);
  const end = Date.now() + 240000;
  while (Date.now() < end && !events.some((p) => /^read-(ok|failed)$/.test(p))) await sleep(500);
  await sleep(1000);
  clearInterval(stub);
  f.remove();
  return events.filter((p) => /^read-ok/.test(p) || p === "read-failed");
};
const r = {};
try {
  localStorage.setItem("partsong-reads", "1"); // one score read before
  localStorage.setItem("partsong-use-days", JSON.stringify({ first: yesterday, last: yesterday, days: 1 }));
  await seed({});
  r.second = await launch(); // day 2, second score
  await seed({ sample: true, repeats: { 26: 14 } });
  r.sample = await launch(); // not counted, tally unchanged
  r.tally = localStorage.getItem("partsong-reads");
} catch (e) {
  r.error = String(e);
}
await seed(null);
localStorage.removeItem("partsong-reads");
localStorage.removeItem("partsong-use-days");
r.ok = r.second?.includes("read-ok: score 2, day 2") && r.sample?.includes("read-ok") && !r.sample.some((p) => p.startsWith("read-ok: ")) && r.tally === "2";
window.result = r;
