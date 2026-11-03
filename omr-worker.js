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
// The big convolutional models gain from the GPU; the decoder runs in homr-rs.
const GPU_MODELS = new Set([MODELS[0], MODELS[1]]);

let ort;

const post = (msg, transfer) => self.postMessage(msg, transfer);
const sessions = [];
const sessionNames = []; // id -> model name
const onGpu = new Set(); // ids of sessions created on WebGPU
const sessionIds = new Map();
let useGpu = false;
let noGpuSetting = false; // init(noGpu): every model on WASM, the exact encoder on the CPU

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


// On iPhones and iPads, segnet runs on the CPU: on WebGPU, onnxruntime makes
// about 900 MB of short-lived buffers a page that Safari frees late (Mac
// Safari, 3 pages: 4.3 GB at the peak, against 1.5 GB with segnet on the CPU),
// more than iOS lets a tab have.
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

async function newSession(id) {
  const name = sessionNames[id];
  const gpu = useGpu && GPU_MODELS.has(name) && !(IOS && name === MODELS[0]);
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

// homr's transformer decoder runs in homr-rs (Rust, in its own instance of
// the reader module, kept for the whole session so the 47 MB model is parsed
// once): homr's greedy loop (decoder_inference.py ScoreDecoder.generate) with
// the same results as onnxruntime, without a call per symbol.
let decoderInstance;
// Test switch: homr's encoder in homr-rs too (bit-exact with native homr, on
// the CPU) instead of onnxruntime-web (GPU where available, not exact).
let exactEncoder = false;
const IMAGE_VALUES = 256 * 1280;
// A module using relaxed SIMD's i32x4.relaxed_madd... (onnxruntime-web's check).
const RELAXED_SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 19, 1, 17, 0, 65, 1, 253, 15, 65, 2, 253, 15, 65, 3, 253, 15, 253, 147, 2, 11]);
// The relaxed-SIMD build is several times faster, and gives homr's exact
// results where the browser fuses multiply-adds (as onnxruntime does on ARM);
// it checks that itself. Otherwise the plain SIMD build, slower but exact.
async function decoderModule() {
  // The exact encoder shares its work across threads when the page is
  // cross-origin isolated (shared memory), with the same results. Threads
  // claim small pieces as they come free, so slower cores don't hold it up.
  // How many: what tune() measured on this device, else 4 (on an Android
  // phone 4 threads took 946 ms a staff and 8 took 1668 ms).
  const threads = encoderThreads || Math.min(4, navigator.hardwareConcurrency || 1);
  if (exactEncoder && self.crossOriginIsolated && threads > 1) {
    try {
      return await threadedModule(threads);
    } catch (e) {
      post({ type: "log", msg: `Threaded encoder unavailable (${e.message})` });
    }
  }
  if (WebAssembly.validate(RELAXED_SIMD)) {
    try {
      const mod = await WebAssembly.compileStreaming(fetch("omr/partsong_omr_fused.wasm" + location.search));
      const { exports: rs } = await WebAssembly.instantiate(mod, {});
      if (rs.decoder_fused_simd_supported() === 1) return { rs, build: "relaxed SIMD" };
    } catch (e) {
      post({ type: "log", msg: `Relaxed SIMD decoder unavailable (${e.message})` });
    }
  }
  const { exports: rs } = await WebAssembly.instantiate(wasmModule, {});
  return { rs, build: "SIMD" };
}
// The exact encoder's thread count: from the app (tuned once on this device).
let encoderThreads;
let encoderGpu; // from tune(): true/false; undefined (not tuned) tries the GPU
let tuning;

// Times the exact encoder at 2, 3 and 4 threads (as the device allows), twice
// (in order, then reversed, so a phone warming up doesn't favour one end),
// keeps each count's faster time and picks the fewest threads within 10% of
// the fastest. Results are the same whatever the count, so this only chooses
// speed. About 20 s on a phone, once.
async function tune() {
  // At most 4: timed alone, 6 and 8 threads looked fastest on an Android
  // phone, but over a whole read they were slower (10 pages: 3 threads
  // 3 min 57 s, 8 threads 4 min 22 s, 6 threads 4 min 59 s).
  const counts = [2, 3, 4].filter((n) => n <= (navigator.hardwareConcurrency || 1));
  if (!self.crossOriginIsolated || !counts.length) return { threads: null };
  const { EncoderPool } = await import("./omr/encoder_pool.mjs");
  const bytes = await modelBytes(MODELS[1]);
  const image = new Float32Array(IMAGE_VALUES);
  for (let i = 0; i < image.length; i++) image[i] = ((i * 2654435761) >>> 0) / 4294967296; // fixed pseudo-random pixels
  let fused = WebAssembly.validate(RELAXED_SIMD);
  const file = () => (fused ? "omr/partsong_omr_threads_fused.wasm" : "omr/partsong_omr_threads.wasm");
  let mod = await WebAssembly.compileStreaming(fetch(file() + location.search));
  const ms = {};
  const order = [...counts, ...[...counts].reverse()];
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    const pool = await EncoderPool.create(mod, { threads: n });
    try {
      const e = pool.exports;
      if (fused && e.encoder_fused_simd_supported() !== 1) {
        fused = false; // as decoderModule would: the plain SIMD build
        mod = await WebAssembly.compileStreaming(fetch(file() + location.search));
        i--;
        continue;
      }
      const p = e.decoder_alloc(bytes.byteLength);
      new Uint8Array(e.memory.buffer, p, bytes.byteLength).set(bytes);
      const encoder = e.encoder_load(p, bytes.byteLength);
      e.decoder_free(p, bytes.byteLength);
      if (!encoder) throw new Error("couldn't load the encoder");
      const img = e.decoder_alloc(IMAGE_VALUES * 4);
      const ctx = e.decoder_alloc(CONTEXT_POSITIONS * DECODER_DIM * 4);
      new Float32Array(e.memory.buffer, img, IMAGE_VALUES).set(image);
      if (i === 0) e.encoder_run(encoder, img, ctx); // warm-up, once
      const t0 = performance.now();
      if (!e.encoder_run(encoder, img, ctx)) throw new Error("the encoder failed");
      ms[n] = Math.min(ms[n] ?? Infinity, Math.round(performance.now() - t0));
      e.encoder_drop(encoder);
    } finally {
      await pool.close();
    }
  }
  const best = Math.min(...Object.values(ms));
  const threads = counts.find((n) => ms[n] <= best * 1.1);
  // The same encoder on the GPU (same results), if it passes its self-test:
  // used only where it beats the CPU (an Android phone's GPU took 1.5 s a
  // staff against 1.1 s on 3 threads).
  let gpuMs = null;
  if (self.navigator.gpu && !noGpuSetting) {
    const pool = await EncoderPool.create(mod, { threads });
    let gpu;
    try {
      const e = pool.exports;
      const p = e.decoder_alloc(bytes.byteLength);
      new Uint8Array(e.memory.buffer, p, bytes.byteLength).set(bytes);
      const encoder = e.encoder_load(p, bytes.byteLength);
      e.decoder_free(p, bytes.byteLength);
      const img = e.decoder_alloc(IMAGE_VALUES * 4);
      const ctx = e.decoder_alloc(CONTEXT_POSITIONS * DECODER_DIM * 4);
      new Float32Array(e.memory.buffer, img, IMAGE_VALUES).set(image);
      const { EncoderGPU } = await import("./omr/encoder_gpu.mjs");
      gpu = await EncoderGPU.create({ exports: e, encoder });
      if (gpu.status.backend === "gpu") {
        await gpu.encode(img, ctx); // warm-up
        for (let i = 0; i < 2; i++) {
          const t0 = performance.now();
          const r = await gpu.encode(img, ctx);
          if (r.backend === "gpu") gpuMs = Math.min(gpuMs ?? Infinity, Math.round(performance.now() - t0));
        }
      }
    } catch (e) {
      post({ type: "log", msg: `Tuning: the GPU encoder failed (${e.message})` });
    } finally {
      gpu?.destroy();
      await pool.close();
    }
  }
  const useGpu = gpuMs != null && gpuMs < ms[threads] * 0.9;
  const times = counts.map((n) => `${n}: ${ms[n]} ms`).join(" · ") + ` · GPU: ${gpuMs == null ? "unavailable" : gpuMs + " ms"}`;
  post({ type: "log", msg: `Tuned encoder: ${useGpu ? "GPU" : `${threads} threads`} (${fused ? "relaxed SIMD" : "SIMD"}; ${times})` });
  return { threads, gpu: useGpu, ms: { ...ms, gpu: gpuMs } };
}

async function threadedModule(threads) {
  const { EncoderPool } = await import("./omr/encoder_pool.mjs");
  const pick = async (file) => {
    const mod = await WebAssembly.compileStreaming(fetch(file + location.search));
    const pool = await EncoderPool.create(mod, { threads });
    return pool;
  };
  if (WebAssembly.validate(RELAXED_SIMD)) {
    try {
      const pool = await pick("omr/partsong_omr_threads_fused.wasm");
      if (pool.exports.decoder_fused_simd_supported() === 1 && pool.exports.encoder_fused_simd_supported() === 1) {
        return { rs: pool.exports, build: `relaxed SIMD, ${threads} threads` };
      }
      await pool.close();
    } catch (e) {
      post({ type: "log", msg: `Relaxed SIMD threaded encoder unavailable (${e.message})` });
    }
  }
  const pool = await pick("omr/partsong_omr_threads.wasm");
  return { rs: pool.exports, build: `SIMD, ${threads} threads` };
}
async function rustDecoder() {
  if (decoderInstance) return decoderInstance;
  const t0 = performance.now();
  const { rs, build } = await decoderModule();
  const bytes = await modelBytes(MODELS[2]);
  const p = rs.decoder_alloc(bytes.byteLength);
  new Uint8Array(rs.memory.buffer, p, bytes.byteLength).set(bytes);
  const model = rs.decoder_load(p, bytes.byteLength);
  rs.decoder_free(p, bytes.byteLength);
  if (!model) throw new Error("the music reader couldn't load homr's decoder");
  const contextBytes = CONTEXT_POSITIONS * DECODER_DIM * 4;
  decoderInstance = { rs, model, context: rs.decoder_alloc(contextBytes), out: rs.decoder_alloc(MAX_SEQ_LEN * 32) };
  post({ type: "log", msg: `Loaded ${MODELS[2]} in homr-rs (${build}) in ${Math.round(performance.now() - t0)} ms` });
  if (exactEncoder) {
    const t1 = performance.now();
    const eb = await modelBytes(MODELS[1]);
    const ep = rs.decoder_alloc(eb.byteLength);
    new Uint8Array(rs.memory.buffer, ep, eb.byteLength).set(eb);
    decoderInstance.encoder = rs.encoder_load(ep, eb.byteLength);
    rs.decoder_free(ep, eb.byteLength);
    if (!decoderInstance.encoder) throw new Error("the music reader couldn't load homr's encoder");
    decoderInstance.image = rs.decoder_alloc(IMAGE_VALUES * 4);
    post({ type: "log", msg: `Loaded ${MODELS[1]} in homr-rs (${build}, exact) in ${Math.round(performance.now() - t1)} ms` });
    // The same encoder on the GPU, with the same results: it tests itself
    // first and otherwise (or if a staff trips its checks) uses the CPU one.
    if (self.navigator.gpu && !noGpuSetting && encoderGpu !== false) {
      const t2 = performance.now();
      try {
        const { EncoderGPU } = await import("./omr/encoder_gpu.mjs");
        const gpu = await EncoderGPU.create({ exports: rs, encoder: decoderInstance.encoder });
        const st = gpu.status;
        if (st.backend === "gpu") decoderInstance.gpu = gpu;
        else gpu.destroy();
        post({
          type: "log",
          msg: st.backend === "gpu"
            ? `Exact encoder on WebGPU: self-test passed, ready in ${Math.round(performance.now() - t2)} ms`
            : `Exact encoder on WebGPU unavailable (${String(st.reason ?? "self-test failed").slice(0, 120)}); using the CPU`,
        });
      } catch (e) {
        post({ type: "log", msg: `Exact encoder on WebGPU unavailable (${e.message}); using the CPU` });
      }
    }
  }
  return decoderInstance;
}

// One staff: per symbol its six tokens (rhythm, pitch, lift, position,
// articulation, slur) and two attention values; the EOS step left out.
function decode({ rs, model, context, out }, ctx) {
  const t0 = performance.now();
  if (ctx.dims[1] !== CONTEXT_POSITIONS || ctx.dims[2] !== DECODER_DIM) throw new Error(`unexpected encoder output ${ctx.dims}`);
  new Float32Array(rs.memory.buffer, context, CONTEXT_POSITIONS * DECODER_DIM).set(ctx.data);
  return steps(rs, out, rs.decoder_run(model, context, out, MAX_SEQ_LEN, 0), t0);
}

// The exact path: encoder and decoder both in homr-rs, the context never
// leaving its memory.
async function encodeDecode({ rs, model, encoder, image, context, out, gpu }, input) {
  const t0 = performance.now();
  if (input.length !== IMAGE_VALUES) throw new Error(`unexpected staff image size ${input.length}`);
  new Float32Array(rs.memory.buffer, image, IMAGE_VALUES).set(input);
  if (!gpu) return steps(rs, out, rs.encoder_decode(encoder, model, image, out, MAX_SEQ_LEN), t0);
  const r = await gpu.encode(image, context);
  if (r.backend !== "gpu") runTimes.gpuFallbacks = (runTimes.gpuFallbacks ?? 0) + 1;
  runTimes.encoderMs = (runTimes.encoderMs ?? 0) + performance.now() - t0;
  return steps(rs, out, rs.decoder_run(model, context, out, MAX_SEQ_LEN, 0), t0);
}

function steps(rs, out, n, t0) {
  if (!n) throw new Error("the music reader's decoder failed");
  const words = new DataView(rs.memory.buffer, out, n * 32);
  if (words.getUint32((n - 1) * 32, true) === EOS_TOKEN) n--;
  const tokens = new Int32Array(n * 6);
  const attention = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 6; j++) tokens[i * 6 + j] = words.getUint32(i * 32 + j * 4, true);
    for (let j = 0; j < 2; j++) attention[i * 2 + j] = words.getFloat32(i * 32 + 24 + j * 4, true);
  }
  const t = (runTimes.decoder ??= { calls: 0, ms: 0 });
  t.calls += n + 1;
  t.ms += performance.now() - t0;
  return { tokens, attention };
}

// homr's transformer settings (homr/transformer/configs.py)
const EOS_TOKEN = 2;
const MAX_SEQ_LEN = 608;
const DECODER_DIM = 512;
const CONTEXT_POSITIONS = 1280;
// homr's batch size, kept on the GPU, where results can depend on it. On the
// CPU each tile's result is the same whatever the batch, and one tile at a
// time halves onnxruntime's memory (Safari: 338 MB to 161 MB), which iPhones
// are short of.
const SEGNET_BATCH = 8;
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

// Deflated (a page's class maps are mostly background: a few MB to tens of KB).
const squeeze = async (bytes, fmt, Stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream(fmt))).arrayBuffer());

// A fresh reader instance with the page open and its staffs found. classes:
// the page's segmentation from an earlier layout (deflated), else segnet runs.
async function openPage(imageBytes, systemsJson, packed) {
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

  let classes = packed ? await squeeze(packed, "deflate", DecompressionStream) : null;
  if (classes?.length !== tiles * WIN * WIN) classes = await segment(rs, tiles);
  const cp = copyIn(classes);
  if (rs.page_segment(cp) !== 0) throw new Error(message());
  rs.dealloc(cp, classes.byteLength);
  return { rs, mem, copyIn, message, classes };
}

// Segmentation, a batch of tiles at a time; each tile's class map is the
// argmax over the classes (first on a tie, as numpy).
async function segment(rs, tiles) {
  const mem = () => rs.memory.buffer;
  const segnet = await session(MODELS[0]);
  const classes = new Uint8Array(tiles * WIN * WIN);
  const tileSize = 3 * WIN * WIN;
  const batch = onGpu.has(segnet) ? SEGNET_BATCH : 1;
  for (let b = 0; b < tiles; b += batch) {
    const n = Math.min(batch, tiles - b);
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
  return classes;
}

// The page's systems before reading any staff (see page_layout), and its
// segmentation to read it with later.
async function layout(imageBytes, systemsJson) {
  const { rs, message, classes } = await openPage(imageBytes, systemsJson);
  rs.page_layout();
  return { ...JSON.parse(message()), classes: await squeeze(classes, "deflate", CompressionStream) };
}

async function recognise(imageBytes, systemsJson, packed) {
  const { rs, mem, copyIn, message } = await openPage(imageBytes, systemsJson, packed);

  const decoder = await rustDecoder();
  const encoder = exactEncoder ? null : await session(MODELS[1]);
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
    let r;
    if (exactEncoder) r = await encodeDecode(decoder, input);
    else {
      const e = sessions[encoder];
      const context = (await run(encoder, { [e.inputNames[0]]: new ort.Tensor("float32", input, [1, 1, h, w]) }, [e.outputNames[0]]))[e.outputNames[0]];
      const ctx = context.location === "cpu" || !context.location ? context : new ort.Tensor("float32", await context.getData(), context.dims);
      r = decode(decoder, ctx);
    }
    const tp = copyIn(r.tokens);
    const ap = copyIn(r.attention);
    rs.staff_result(tp, r.tokens.length, ap, r.attention.length);
    rs.dealloc(tp, r.tokens.byteLength);
    rs.dealloc(ap, r.attention.byteLength);
  }
}

// noGpu (tests, comparisons): run every model on WASM.
async function init(noGpu, exact) {
  noGpuSetting = noGpu;
  exactEncoder = !!exact;
  ort = await import(ORT_URL + "ort.webgpu.min.mjs");
  ort.env.wasm.wasmPaths = ORT_URL;
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1;
  post({ type: "log", msg: `WASM threads: ${ort.env.wasm.numThreads}` });
  useGpu = !noGpu && !!(self.navigator.gpu && (await navigator.gpu.requestAdapter().catch(() => null)));
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
      if (Number.isInteger(data.threads) && data.threads > 0) encoderThreads = data.threads;
      if (typeof data.gpu === "boolean") encoderGpu = data.gpu;
      ready ??= init(!!data.noGpu, !!data.exact);
      await ready;
    } else if (data.type === "tune") {
      await ready;
      tuning = tune().then(
        (r) => {
          if (r.threads) encoderThreads = r.threads;
          if (r.threads) encoderGpu = r.gpu;
          post({ type: "tuned", ...r });
        },
        (e) => post({ type: "tuned", threads: null, error: String(e && e.message ? e.message : e) }),
      );
      await tuning;
    } else if (data.type === "layout") {
      await ready;
      await tuning;
      const r = await layout(data.image, data.systems ?? "");
      post({ type: "result", id: data.id, ...r }, [r.classes.buffer]);
    } else if (data.type === "recognise") {
      await ready;
      await tuning;
      const t0 = performance.now();
      runTimes = [];
      const xml = await recognise(data.image, data.systems ?? "", data.classes);
      const ms = Math.round(performance.now() - t0);
      const names = [...sessionIds.keys()];
      const parts = names.map((n) => `${n.split("_")[0]} ${Math.round(runTimes[sessionIds.get(n)]?.ms ?? 0)} ms/${runTimes[sessionIds.get(n)]?.calls ?? 0} calls`);
      const exactLabel = `encoder+decoder (homr-rs, exact${decoderInstance?.gpu ? ", GPU encoder" : ""})`;
      if (runTimes.decoder) parts.push(`${exactEncoder ? exactLabel : "decoder"} ${Math.round(runTimes.decoder.ms)} ms/${runTimes.decoder.calls} calls`);
      if (runTimes.encoderMs) parts.push(`of which GPU encoder ${Math.round(runTimes.encoderMs)} ms`);
      if (runTimes.gpuFallbacks) parts.push(`${runTimes.gpuFallbacks} staffs on the CPU encoder after GPU checks`);
      const inModels = runTimes.reduce((sum, t) => sum + (t?.ms ?? 0), 0) + (runTimes.decoder?.ms ?? 0);
      post({ type: "log", msg: `Page in ${ms} ms: ${parts.join(", ")}; reader ${Math.round(ms - inModels)} ms` });
      post({ type: "result", id: data.id, xml, ms });
    }
  } catch (e) {
    post({ type: "error", id: data.id, msg: String(e && e.message ? e.message : e) });
  }
};
