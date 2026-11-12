// A slow, steady connection still gets the reader: "stalled" means 30 s with
// no bytes, not a piece that takes longer than 30 s (v275 gave up on every
// piece: "the connection keeps dropping"). The server sends each model's
// first piece over about 35 s. Run with host page http://localhost:8769/testdata/
// served by: python3 scripts/flaky-server.py 8769 --slow
//   node scripts/headless-test.mjs http://localhost:8769/testdata/ out.json 120 tests/drive-download-slow.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await caches.delete("partscanner-models-v1");
const pieces = async () => (await (await caches.open("partscanner-models-v1")).keys()).filter((r) => r.url.includes("?piece=")).length;
const f = document.createElement("iframe");
f.src = "/tests/omr-test.html?page=huron_1.png&" + Math.random();
document.body.append(f);
const t0 = Date.now();
let got = 0;
while (Date.now() - t0 < 80000 && (got = await pieces()) < 2) await sleep(500);
const r = { pieces: got, seconds: Math.round((Date.now() - t0) / 1000) };
f.remove();
// The first piece takes about 35 s; the second follows at once.
r.ok = got >= 2 && r.seconds >= 30;
window.result = r;
