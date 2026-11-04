// A reading cut off by the phone (Safari closing the page) carries on at the
// next launch; that's counted by kind of device, as is giving up after two
// tries (once). GoatCounter is kept out so the stand-in counts:
//   CHROME_FLAGS="--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND" node scripts/headless-test.mjs \
//     http://localhost:8765/index.html out.json 120 tests/drive-restart-count.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seed = (resumes) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); const s = tx.objectStore("scores"); s.clear(); if (resumes != null) s.put({ id: "cut", title: "Cut off", created: 1, images: [], pages: [], pending: true, resumes }); tx.oncomplete = () => { q.result.close(); res(); }; }; });
const open = async () => {
  const f = document.createElement("iframe");
  f.src = "/index.html";
  document.body.append(f);
  const events = [];
  const stub = setInterval(() => { try { f.contentWindow.goatcounter = { count: (e) => events.push(e.path) }; } catch {} }, 20);
  await sleep(5000);
  clearInterval(stub);
  f.remove();
  return events.filter((p) => /^read-/.test(p));
};
const r = {};
await seed(0); r.restarted = await open();
await seed(2); r.gaveUp = await open(); r.gaveUpAgain = await open();
await seed(null);
r.ok = r.restarted.some((p) => /^read-restarted \(\w+\)$/.test(p)) && /^read-gave-up \(\w+\)$/.test(r.gaveUp.join()) && r.gaveUpAgain.length === 0;
window.result = r;
