// The systems found on the "Of a Rose" photos (testdata/rose-photos/p01-p11.jpg)
// stay as v211 found them: staves per system, and the parts they give. A
// change to how staves are grouped (e.g. homr's repair_systems, tried and
// dropped) must not split these pages differently. Page 2's grouping is wrong
// in v211 too (it should be 6,6); fixing it means updating EXPECTED here.
// Run against http://localhost:8765/index.html.
const EXPECTED = {
  "p01.jpg": "6,6 parts [2,1,1,1,1,2]",
  "p02.jpg": "1,1,4,3,1,2,1 parts [1,1,2,1]",
  "p03.jpg": "6,6 parts [1,1,1,1,2]",
  "p04.jpg": "4,2,4,2 parts [2,2,1,1]",
  "p05.jpg": "6,4,2 parts [1,1,1,1,2]",
  "p06.jpg": "6,6 parts [1,1,1,1,2]",
  "p07.jpg": "6,6 parts [1,1,1,1,2]",
  "p08.jpg": "4,2,4,2 parts [1,1,1,1,2]",
  "p09.jpg": "6,6 parts [2,1,1,2]",
  "p10.jpg": "6,6 parts [1,1,1,1,2,2]",
  "p11.jpg": "4,2,6 parts [1,1,2,2]"
};
const w = new Worker("/omr-worker.js", { type: "module" });
let id = 0; const waiting = new Map();
const ready = new Promise((res) => { w.onmessage = ({ data }) => {
  if (data.type === "ready") res();
  if ((data.type === "result" || data.type === "error") && waiting.has(data.id)) { waiting.get(data.id)(data); waiting.delete(data.id); }
}; });
w.postMessage({ type: "init" });
await ready;
const layout = (buf) => new Promise((res) => { const i = ++id; waiting.set(i, res); w.postMessage({ type: "layout", id: i, image: buf, systems: "" }, [buf]); });
const out = {};
for (let p = 1; p <= 11; p++) {
  const n = `p${String(p).padStart(2, "0")}.jpg`;
  const r = await layout(await (await fetch("/testdata/rose-photos/" + n)).arrayBuffer());
  out[n] = r.type === "error" ? "ERROR " + String(r.msg).split("\n").pop() : (r.systems || []).map((s) => s.length).join(",") + " parts " + JSON.stringify(r.parts);
}
window.result = { out, differ: Object.keys(EXPECTED).filter((k) => out[k] !== EXPECTED[k]) };
window.result.ok = window.result.differ.length === 0;
