// Module worker: the music reader. homr's pipeline runs as WebAssembly
// (omr/partsong_omr.wasm, built from omr-rs/ and homr-rs), and its three ONNX
// models run on onnxruntime-web, driven from here: segnet on the page's tiles,
// then the encoder and the decoder loop for each staff the reader asks for.

const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
const MODEL_CACHE = "partscanner-models-v1";
const MODELS = [
  "segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f.onnx",
  "encoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx",
  "decoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx",
];
// Uncompressed total, for progress: servers may gzip, so content-length
// doesn't match the bytes received.
const MODELS_TOTAL_BYTES = 157482318;
// The decoder runs hundreds of tiny steps per staff, where WebGPU's per-call
// overhead loses to WASM; the big convolutional models gain from the GPU.
const GPU_MODELS = new Set([MODELS[0], MODELS[1]]);

let ort;

const post = (msg) => self.postMessage(msg);
const sessions = [];
const sessionNames = []; // id -> model name
const onGpu = new Set(); // ids of sessions created on WebGPU
const sessionIds = new Map();
let useGpu = false;

// Models download in 4 MB pieces (HTTP range requests), each stored as it
// arrives, so a dropped or crawling connection resumes where it stopped (even
// after the app is closed) instead of restarting a 57 MB file.
const PIECE = 4 * 1024 * 1024;
const STALL_MS = 30000;
const MODEL_SIZES = {
  [MODELS[0]]: 57311361,
  [MODELS[1]]: 52861122,
  [MODELS[2]]: 47309835,
};
const modelUrl = (name) => new URL("models/" + name, location.href).href;
const pieceKey = (name, i) => `${modelUrl(name)}?piece=${i}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPiece(url, start, end) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), STALL_MS);
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, cache: "no-store", signal: abort.signal });
    if (res.status === 200) return { whole: await res.arrayBuffer() }; // server ignores ranges
    if (res.status !== 206) throw new Error(`unexpected response ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength !== end - start + 1) throw new Error("short read");
    return { piece: buf };
  } finally {
    clearTimeout(timer);
  }
}

async function downloadModel(name) {
  const cache = await caches.open(MODEL_CACHE);
  if (await cache.match(modelUrl(name))) return; // stored whole by an earlier version
  const size = MODEL_SIZES[name];
  let loaded = 0;
  for (let i = 0; i * PIECE < size; i++) {
    const start = i * PIECE;
    const end = Math.min(size, start + PIECE) - 1;
    if (!(await cache.match(pieceKey(name, i)))) {
      for (let attempt = 1; ; attempt++) {
        try {
          const got = await fetchPiece(modelUrl(name), start, end);
          if (got.whole) {
            if (got.whole.byteLength !== size) throw new Error("short read");
            await cache.put(modelUrl(name), new Response(got.whole));
            post({ type: "progress", stage: "download", name, loaded: size, total: MODELS_TOTAL_BYTES });
            return;
          }
          await cache.put(pieceKey(name, i), new Response(got.piece));
          break;
        } catch (e) {
          if (attempt >= 8) {
            throw new Error(
              `the connection keeps dropping (${e.message}). What has downloaded is kept; try again on a better connection`,
            );
          }
          post({ type: "progress", stage: "retry", name, attempt });
          await sleep(Math.min(30000, 2000 * attempt * attempt));
        }
      }
    }
    loaded = end + 1;
    post({ type: "progress", stage: "download", name, loaded, total: MODELS_TOTAL_BYTES });
  }
}

async function modelBytes(name) {
  const cache = await caches.open(MODEL_CACHE);
  const whole = await cache.match(modelUrl(name));
  if (whole) return new Uint8Array(await whole.arrayBuffer());
  const size = MODEL_SIZES[name];
  const bytes = new Uint8Array(size);
  for (let i = 0; i * PIECE < size; i++) {
    const piece = await cache.match(pieceKey(name, i));
    if (!piece) throw new Error(`model piece missing: ${name} #${i}`);
    bytes.set(new Uint8Array(await piece.arrayBuffer()), i * PIECE);
  }
  return bytes;
}


async function newSession(id) {
  const name = sessionNames[id];
  const gpu = useGpu && GPU_MODELS.has(name);
  const eps = gpu ? ["webgpu", "wasm"] : ["wasm"];
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(await modelBytes(name), {
    executionProviders: eps,
    graphOptimizationLevel: "all",
  });
  if (gpu) onGpu.add(id);
  else onGpu.delete(id);
  post({ type: "log", msg: `Loaded ${name} on ${eps[0]} in ${Math.round(performance.now() - t0)} ms` });
  return session;
}

async function session(name) {
  if (!sessionIds.has(name)) {
    const id = sessions.length;
    sessionNames[id] = name;
    sessions[id] = await newSession(id);
    sessionIds.set(name, id);
  }
  return sessionIds.get(name);
}

// Runs a session; if its GPU has gone away (e.g. the phone's, under memory
// pressure), onnxruntime's WebGPU backend fails every run: carry on without it.
async function run(id, feeds, names) {
  const t0 = performance.now();
  let out;
  try {
    out = await sessions[id].run(feeds, names);
  } catch (e) {
    if (!onGpu.has(id)) throw e;
    post({ type: "log", msg: `WebGPU run failed (${e.message}); using WASM from now on` });
    useGpu = false;
    for (const other of [...onGpu]) {
      const old = sessions[other];
      Promise.resolve().then(() => old.release()).catch(() => {});
      sessions[other] = await newSession(other);
    }
    out = await sessions[id].run(feeds, names);
  }
  const t = (runTimes[id] ??= { calls: 0, ms: 0 });
  t.calls++;
  t.ms += performance.now() - t0;
  return out;
}

// homr's greedy decoding loop for one staff (homr/transformer/
// decoder_inference.py ScoreDecoder.generate). Returns, per step, the chosen
// token of each head (rhythm, pitch, lift, position, articulation, slur) and
// the attention output; the step whose rhythm is EOS isn't included.
async function generate(id, context, start, nonote, eos, maxLen, heads, headDim, caches) {
  const t0 = performance.now();
  const session = sessions[id];
  const contextDims = context.dims;
  // After the first step homr passes only the context's first position.
  const reduced = new ort.Tensor("float32", context.data.slice(0, contextDims[2]), [contextDims[0], 1, contextDims[2]]);
  const token = (v) => new ort.Tensor("int64", BigInt64Array.of(BigInt(v)), [1, 1]);
  const heads6 = ["out_rhythms", "out_pitchs", "out_lifts", "out_positions", "out_articulations", "out_slurs"];
  const names = [...heads6, "attention", ...Array.from({ length: caches }, (_, i) => `cache_out${i}`)];
  let cache = Array.from({ length: caches }, () => new ort.Tensor("float32", new Float32Array(0), [1, heads, 0, headDim]));
  let last = { rhythm: start, pitch: nonote, lift: nonote, articulation: nonote, slur: nonote };
  const tokens = [];
  const attention = [];
  let steps = 0;
  for (let step = 0; step < maxLen; step++) {
    const feeds = {
      rhythms: token(last.rhythm),
      pitchs: token(last.pitch),
      lifts: token(last.lift),
      articulations: token(last.articulation),
      slurs: token(last.slur),
      context: step === 0 ? context : reduced,
      cache_len: new ort.Tensor("int64", BigInt64Array.of(BigInt(step)), [1]),
    };
    cache.forEach((t, i) => (feeds[`cache_in${i}`] = t));
    const out = await session.run(feeds, names);
    steps++;
    cache = names.slice(7).map((n) => out[n]);
    // Greedy: the most likely token at the last position of each head
    // (the first, on a tie, as numpy's argmax).
    const pick = (n) => {
      const t = out[n];
      const size = t.dims.at(-1);
      const d = t.data;
      let best = d.length - size;
      for (let k = best + 1; k < d.length; k++) if (d[k] > d[best]) best = k;
      return best - (d.length - size);
    };
    const chosen = heads6.map(pick);
    if (chosen[0] === eos) break;
    tokens.push(...chosen);
    attention.push(Float32Array.from(out.attention.data));
    last = { rhythm: chosen[0], pitch: chosen[1], lift: chosen[2], articulation: chosen[4], slur: chosen[5] };
  }
  const t = (runTimes[id] ??= { calls: 0, ms: 0 });
  t.calls += steps;
  t.ms += performance.now() - t0;
  const flat = new Float32Array(attention.reduce((n, a) => n + a.length, 0));
  attention.reduce((at, a) => (flat.set(a, at), at + a.length), 0);
  return { tokens: Int32Array.from(tokens), attention: flat };
}

// homr's transformer settings (homr/transformer/configs.py)
const START_TOKEN = 1;
const NONOTE_TOKEN = 0;
const EOS_TOKEN = 2;
const MAX_SEQ_LEN = 608;
const DECODER_HEADS = 8;
const DECODER_DIM = 512;
const DECODER_DEPTH = 8;
const SEGNET_BATCH = 8; // homr's batch size (kept: the GPU's results can depend on it)
const WIN = 320;

let wasmModule;
let runTimes = [];

// The page's pixels as homr's cv2.imread sees them (RGBA, no colour conversion).
async function pixels(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function recognise(imageBytes, systemsJson) {
  // A fresh instance per page: its memory is returned afterwards (WebAssembly
  // memory never shrinks), and a failure can't leave state behind.
  const { exports: rs } = await WebAssembly.instantiate(wasmModule, {});
  const mem = () => rs.memory.buffer;
  const copyIn = (typed) => {
    const p = rs.alloc(typed.byteLength);
    new Uint8Array(mem(), p, typed.byteLength).set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
    return p;
  };
  const message = () => new TextDecoder().decode(new Uint8Array(mem(), rs.msg_ptr(), rs.msg_len()));

  const img = await pixels(imageBytes);
  const ranges = systemsJson ? JSON.parse(systemsJson).flat() : [];
  const rgba = copyIn(img.data);
  const sys = copyIn(Float64Array.from(ranges));
  const tiles = rs.page_open(rgba, img.width, img.height, sys, ranges.length / 2);
  rs.dealloc(rgba, img.data.byteLength);

  // Segmentation, SEGNET_BATCH tiles at a time; each tile's class map is the
  // argmax over the classes (first on a tie, as numpy).
  const segnet = await session(MODELS[0]);
  const classes = new Uint8Array(tiles * WIN * WIN);
  const tileSize = 3 * WIN * WIN;
  for (let b = 0; b < tiles; b += SEGNET_BATCH) {
    const n = Math.min(SEGNET_BATCH, tiles - b);
    const input = new Float32Array(n * tileSize);
    for (let k = 0; k < n; k++) input.set(new Float32Array(mem(), rs.tile(b + k), tileSize), k * tileSize);
    const s = sessions[segnet];
    const out = (await run(segnet, { [s.inputNames[0]]: new ort.Tensor("float32", input, [n, 3, WIN, WIN]) }, [s.outputNames[0]]))[s.outputNames[0]];
    const c = out.dims[1];
    const d = out.data;
    const plane = WIN * WIN;
    for (let k = 0; k < n; k++) {
      const base = k * c * plane;
      const dst = (b + k) * plane;
      for (let i = 0; i < plane; i++) {
        let best = 0;
        let v = d[base + i];
        for (let ch = 1; ch < c; ch++) {
          const x = d[base + ch * plane + i];
          if (x > v) (v = x), (best = ch);
        }
        classes[dst + i] = best;
      }
    }
  }
  const cp = copyIn(classes);
  if (rs.page_segment(cp) !== 0) throw new Error(message());
  rs.dealloc(cp, classes.byteLength);

  const encoder = await session(MODELS[1]);
  const decoder = await session(MODELS[2]);
  let staff = 0;
  for (;;) {
    const state = rs.page_step();
    if (state === 0) return message();
    if (state < 0) throw new Error(message());
    if (staff === 0) post({ type: "log", msg: "Found the staffs" });
    post({ type: "log", msg: `Running TrOmr inference on staff image ${staff++}` });
    const h = rs.staff_input_h();
    const w = rs.staff_input_w();
    const input = new Float32Array(mem(), rs.buf_ptr(), h * w).slice();
    const e = sessions[encoder];
    const context = (await run(encoder, { [e.inputNames[0]]: new ort.Tensor("float32", input, [1, 1, h, w]) }, [e.outputNames[0]]))[e.outputNames[0]];
    const ctx = context.location === "cpu" || !context.location ? context : new ort.Tensor("float32", await context.getData(), context.dims);
    const r = await generate(decoder, ctx, START_TOKEN, NONOTE_TOKEN, EOS_TOKEN, MAX_SEQ_LEN, DECODER_HEADS, DECODER_DIM / DECODER_HEADS, DECODER_DEPTH * 4);
    const tp = copyIn(r.tokens);
    const ap = copyIn(r.attention);
    rs.staff_result(tp, r.tokens.length, ap, r.attention.length);
    rs.dealloc(tp, r.tokens.byteLength);
    rs.dealloc(ap, r.attention.byteLength);
  }
}

async function init() {
  ort = await import(ORT_URL + "ort.webgpu.min.mjs");
  ort.env.wasm.wasmPaths = ORT_URL;
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1;
  post({ type: "log", msg: `WASM threads: ${ort.env.wasm.numThreads}` });
  useGpu = !!(self.navigator.gpu && (await navigator.gpu.requestAdapter().catch(() => null)));
  // Same deploy version as this worker (?v=… from scripts/stamp-version.mjs).
  wasmModule = await WebAssembly.compileStreaming(fetch("omr/partsong_omr.wasm" + location.search));
  for (const name of MODELS) {
    await downloadModel(name);
  }
  post({ type: "ready", gpu: useGpu });
}

let ready;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      ready ??= init();
      await ready;
    } else if (data.type === "recognise") {
      await ready;
      const t0 = performance.now();
      runTimes = [];
      const xml = await recognise(data.image, data.systems ?? "");
      const ms = Math.round(performance.now() - t0);
      const names = [...sessionIds.keys()];
      const parts = names.map((n) => `${n.split("_")[0]} ${Math.round(runTimes[sessionIds.get(n)]?.ms ?? 0)} ms/${runTimes[sessionIds.get(n)]?.calls ?? 0} calls`);
      const inModels = runTimes.reduce((sum, t) => sum + (t?.ms ?? 0), 0);
      post({ type: "log", msg: `Page in ${ms} ms: ${parts.join(", ")}; reader ${Math.round(ms - inModels)} ms` });
      post({ type: "result", id: data.id, xml, ms });
    }
  } catch (e) {
    post({ type: "error", id: data.id, msg: String(e && e.message ? e.message : e) });
  }
};
