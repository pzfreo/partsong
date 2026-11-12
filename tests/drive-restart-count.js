// A reading cut off by the phone (Safari closing the page) carries on at the
// next launch; that's counted by kind of device, as is giving up after two
// tries (once), each with where the reading had got to. GoatCounter is kept out so the stand-in counts:
//   CHROME_FLAGS="--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND" node scripts/headless-test.mjs \
//     http://localhost:8765/index.html out.json 120 tests/drive-restart-count.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seed = (resumes, images = []) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); const s = tx.objectStore("scores"); s.clear(); if (resumes != null) s.put({ id: "cut", title: "Cut off", created: 1, images, pages: images.map(() => null), pending: true, resumes }); tx.oncomplete = () => { q.result.close(); res(); }; }; });
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
await seed(0); r.restarted = await open();
await seed(2); r.gaveUp = await open(); r.gaveUpAgain = await open();
// Through the real path: the launch resumes the scan (readScan saves it again),
// and the count survives that save. A page that can't be read: the read fails
// with an error, which isn't the phone closing the page, so it's marked
// stopped and later launches neither restart it nor count it.
await seed(0, [new Blob(["not an image"], { type: "image/png" })]);
r.launches = [];
for (let i = 0; i < 4; i++) r.launches.push((await open()).filter((p) => /^read-(restarted|gave-up) \(/.test(p)).map((p) => p.split(" ")[0] + (p.endsWith(": finding systems, 1 page") ? "" : "?")).join(",") || "-");
r.afterError = await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").get("cut"); g.onsuccess = () => { q.result.close(); res({ stopped: g.result?.stopped, resumes: g.result?.resumes }); }; }; });
// A read carried on after the page was closed starts the reader in its
// low-memory form: homr-rs's encoder on the CPU, nothing on the GPU.
const page = await (await fetch("/icon-192.png")).blob();
await seed(0, [page]);
await open(true);
r.lowMemoryInit = inits.map((m) => ({ exact: m.exact, noGpu: m.noGpu }));
await seed(null);
r.ok = JSON.stringify(r.lowMemoryInit) === JSON.stringify([{ exact: true, noGpu: true }]) && r.restarted.some((p) => /^read-restarted \(\w+ \w+\): finding systems, 0 pages$/.test(p)) && /^read-gave-up \(\w+ \w+\): finding systems, 0 pages$/.test(r.gaveUp.join()) && r.gaveUpAgain.length === 0
  && r.launches.join(" ") === "read-restarted - - -" && r.afterError.stopped === true && r.afterError.resumes === 1;
window.result = r;
