// Looping: the position stays in the pass that's sounding until the next one
// starts. The next pass is scheduled a second ahead, and position() used to
// jump to the start for that second (the bar shown, the playhead, and where
// Pause left off). A fake audio clock; no browser needed.
//   node tests/loop-position.mjs
import assert from "node:assert/strict";
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
const { Player } = await import("../player.js");
const p = new Player({ lines: [{ notes: [] }] });
let now = 0;
p.ctx = { get currentTime() { return now; }, resume() {} };
p.ensureContext = () => {};
p.bpm = 60; // a beat a second
p.play([{ from: 0, to: 8 }], 0, true); // an 8-beat loop, starting at 0.1 s
const at = (t) => { now = t; p.schedule(); return p.position(); };
for (let t = 0.2; t < 8.05; t += 0.05) assert.ok(Math.abs(at(t) - (t - 0.1)) < 1e-6, `first pass at ${t.toFixed(2)} s: ${p.position()}`);
for (let t = 8.15; t < 16.05; t += 0.05) assert.ok(Math.abs(at(t) - (t - 8.1)) < 1e-6, `second pass at ${t.toFixed(2)} s: ${p.position()}`);
// Paused in the last second of a pass: it resumes from there, not from the start.
at(23.9);
p.stop(false);
assert.ok(Math.abs(p.offset() - 7.8) < 1e-6, `paused at ${p.offset()}`);
console.log("Loop position checks passed");
