// The red line in an imported score moves smoothly forward from note to note:
// never back along a line, and over each note as it sounds (it moved evenly
// through the bar, so it ran ahead of short notes, fell behind and jumped).
// The audio clock here moves in 50 ms steps, as Android's does: the line must
// still move every frame, not stall and jump, all the way through (on a phone
// it froze after a dozen bars while the music played on).
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 90 tests/drive-playhead.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
const bytes = await (await fetch("testdata/corpus/In_the_Bleak_Midwinter_Cranham.mxl")).arrayBuffer();
const dt = new DataTransfer(); dt.items.add(new File([bytes], "b.mxl")); $("open-musicxml").files = dt.files; $("open-musicxml").dispatchEvent(new Event("change"));
await waitFor(() => !$("practice").hidden && document.querySelector("#osmd svg"), 20000, "drawn");
await sleep(1500);
$("panel-close")?.click(); await sleep(500);
const clock = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "currentTime");
Object.defineProperty(BaseAudioContext.prototype, "currentTime", { configurable: true, get() { return Math.floor(clock.get.call(this) * 20) / 20; } });
const head = document.querySelector(".read-playhead");
const samples = [];
let on = true;
const frame = () => { if (!on) return; if (!head.hidden) samples.push([performance.now(), parseFloat(head.style.left), parseFloat(head.style.top), $("position").textContent]); requestAnimationFrame(frame); };
$("play").click();
requestAnimationFrame(frame);
await sleep(45000);
on = false;
$("play").click();
// Back along the same line (same top) by more than a pixel is a jerk.
let backs = 0, bigJumps = 0, stalls = 0, still = 0, froze = null;
for (let i = 1; i < samples.length; i++) {
  const [, x0, y0] = samples[i - 1], [, x1, y1] = samples[i];
  if (y0 === y1 && x1 < x0 - 1) backs++;
  if (y0 === y1 && x1 - x0 > 40) bigJumps++;
  if (y0 === y1 && x1 === x0) stalls++;
  still = x1 === x0 && y1 === y0 ? still + 1 : 0;
  if (still > 30 && !froze) froze = samples[i][3]; // half a second without moving
}
window.result = {
  frames: samples.length, bars: [...new Set(samples.map((s) => s[3]))], backs, bigJumps, stalls, froze,
  ok: samples.length > 100 && backs === 0 && bigJumps === 0 && stalls < samples.length / 20 && !froze && new Set(samples.map((s) => s[3])).size >= 16,
};
