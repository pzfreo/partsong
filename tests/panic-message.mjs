// A panic in the reader traps as "unreachable", the same as running out of
// memory; its hook keeps the message and place for the worker (panicText in
// omr-worker.js, run here as the worker has it), read once and then cleared.
// A real panic (tile() with no page open) in each single-thread build; the
// threaded builds checked for the same exports. rustFrames (the panic's Rust
// functions for the problem log) on a real stack, and on Chrome's and
// Safari's frame formats. Usage: node tests/panic-message.mjs   Prints JSON.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../omr-worker.js", import.meta.url), "utf8");
const from = src.indexOf("let loadingDecoder = null;");
const to = src.indexOf("\n}\n", src.indexOf("function rustFrames")) + 3;
const load = (file) => readFileSync(new URL(`../omr/${file}.wasm`, import.meta.url));
const out = {};
for (const f of ["partsong_omr", "partsong_omr_fused"]) {
  const rs = (await WebAssembly.instantiate(load(f), {})).instance.exports;
  rs.panic_hook();
  const { panicText, rustFrames } = new Function("pageReader", "decoderInstance", src.slice(from, to) + "; return { panicText, rustFrames };")(rs, null);
  try {
    rs.tile(0);
    out[f] = "no trap";
  } catch (e) {
    out[f] = { trap: e.message, panic: panicText(), again: panicText(), frames: rustFrames(e, "page reader") };
  }
}
for (const f of ["partsong_omr_threads", "partsong_omr_threads_fused"]) {
  out[f] = WebAssembly.Module.exports(new WebAssembly.Module(load(f))).map((e) => e.name).filter((n) => /^panic_/.test(n)).sort().join(",");
}
const { rustFrames } = new Function("pageReader", "decoderInstance", src.slice(from, to) + "; return { rustFrames };")(null, null);
const panicTextOf = (text) => {
  const bytes = new TextEncoder().encode(text);
  const memory = { buffer: new ArrayBuffer(bytes.length) };
  new Uint8Array(memory.buffer).set(bytes);
  const rs = { memory, panic_len: () => bytes.length, panic_ptr: () => 0, panic_clear: () => {} };
  return new Function("pageReader", "decoderInstance", src.slice(from, to) + "; return panicText;")(rs, null)().text;
};
out.paths = panicTextOf("panicked at /Users/x/.cargo/git/checkouts/homr-rs-1a2b/f630910/src/staff.rs:1:2: a; /rustc/abc/library/alloc/src/raw_vec/mod.rs:28:5; /Users/x/.cargo/registry/src/index.crates.io-6f17/serde-1.0.1/src/de.rs:3:4");
out.chrome = rustFrames({ stack: "RuntimeError: unreachable\n    at partsong_omr.wasm._RNvNtCs1_4core9panicking9panic_fmt (https://partsong.app/omr/partsong_omr.wasm?v=331:wasm-function[783]:0xe041d)\n    at partsong_omr.wasm._RNvCs2_12partsong_omr4tile (https://partsong.app/omr/partsong_omr.wasm?v=331:wasm-function[111]:0x1234)\n    at openPage (https://partsong.app/omr-worker.js?v=331:600:5)" }, "page reader");
out.safari = rustFrames({ stack: "<?>.wasm-function[_RNvNtCs1_4core9panicking9panic_fmt]@[wasm code]\n<?>.wasm-function[_RNvCs2_12partsong_omr4tile]@[wasm code]\nwasm-stub@[wasm code]\nopenPage@https://partsong.app/omr-worker.js?v=331:600:5" }, "page reader");
const single = ["partsong_omr", "partsong_omr_fused"].map((f) => out[f]);
out.ok =
  single.every((r) => r.trap === "unreachable" && /^panicked at src\/lib\.rs:\d+:\d+:\ncalled `Option::unwrap\(\)` on a `None` value$/.test(r.panic?.text) && r.again === null && /^page reader build:\ntile \[\d+\]$/.test(r.frames)) &&
  ["partsong_omr_threads", "partsong_omr_threads_fused"].every((f) => out[f] === "panic_clear,panic_hook,panic_len,panic_ptr") &&
  out.paths === "panicked at homr-rs/src/staff.rs:1:2: a; alloc/src/raw_vec/mod.rs:28:5; serde-1.0.1/src/de.rs:3:4" &&
  out.chrome === "page reader build:\n_RNvCs2_12partsong_omr4tile [111]" &&
  out.safari === "page reader build:\n_RNvCs2_12partsong_omr4tile";
console.log(JSON.stringify(out, null, 1));
process.exit(out.ok ? 0 : 1);
