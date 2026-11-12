// Opening the scan screen runs a quick check that the reader can start (SIMD,
// and the memory onnxruntime reserves); a failure shows what to do, counted by
// device. The real check here, then a stand-in worker that reports a memory
// refusal and one an old browser. GoatCounter is kept out so the stand-in counts.
// Run with a Windows user agent (the harness emulates touch, so a Mac looks
// like an iPad, which gets the iPad note and wording):
//   USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" \
//   CHROME_FLAGS="--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND" node scripts/headless-test.mjs \
//     http://localhost:8765/index.html out.json 60 tests/drive-device-check.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const events = [];
window.goatcounter = { count: (e) => events.push(e.path) };
await sleep(800);
const open = async () => { $("new-scan").click(); await sleep(600); const n = $("device-note"); return n.hidden ? null : n.textContent; };
const r = {};
r.real = await open();
const RealWorker = window.Worker;
const fake = (answer) => class { constructor() { setTimeout(() => this.onmessage?.({ data: answer }), 10); } terminate() {} };
window.Worker = fake("memory");
r.memory = await open();
window.Worker = fake("no SIMD");
r.old = await open();
window.Worker = RealWorker;
r.recovered = await open();
r.events = events.filter((p) => p.startsWith("device-check"));
r.ok = r.real === null && /^This computer couldn.t set aside enough memory/.test(r.memory) && /too old/.test(r.old) && r.recovered === null &&
  r.events.length === 1 && /^device-check \(\w+ \S+\): ok$/.test(r.events[0]);
window.result = r;
