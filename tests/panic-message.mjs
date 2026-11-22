// A panic in the reader traps as "unreachable", the same as running out of
// memory; its hook keeps the message and place for the worker (panicText in
// omr-worker.js). Here a real panic (tile() with no page open) in each
// single-thread build. Usage: node tests/panic-message.mjs   Prints JSON.
import { readFileSync } from "node:fs";
const out = {};
for (const f of ["partsong_omr", "partsong_omr_fused"]) {
  const rs = (await WebAssembly.instantiate(readFileSync(new URL(`../omr/${f}.wasm`, import.meta.url)), {})).instance.exports;
  const before = rs.panic_len();
  rs.panic_hook();
  try {
    rs.tile(0);
    out[f] = "no trap";
  } catch (e) {
    out[f] = { trap: e.message, before, panic: new TextDecoder().decode(new Uint8Array(rs.memory.buffer, rs.panic_ptr(), rs.panic_len()).slice()) };
  }
}
out.ok = Object.values(out).every((r) => r.trap === "unreachable" && r.before === 0 && /^panicked at src\/lib\.rs:\d+:\d+:\ncalled `Option::unwrap\(\)` on a `None` value$/.test(r.panic));
console.log(JSON.stringify(out, null, 1));
process.exit(out.ok ? 0 : 1);
