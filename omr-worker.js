// Module worker: the music reader. homr's pipeline runs as WebAssembly
// (omr/partsong_omr.wasm, built from omr-rs/ and homr-rs), and its three ONNX
// models run on onnxruntime-web, driven from here: segnet on the page's tiles,
// then the encoder and the decoder loop for each staff the reader asks for.

// Served from partsong.app itself (scripts/fetch-libs.sh), not a CDN.
const ORT_URL = new URL("lib/onnxruntime-web@1.30.0/dist/", import.meta.url).href;
const MODEL_CACHE = "partscanner-models-v1";
const MODELS = [
  "segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f.onnx",
  "encoder_pytorch_model_509-2293bba14bfea47d9d28411339362af15fce4c31.onnx",
  "decoder_pytorch_model_509-2293bba14bfea47d9d28411339362af15fce4c31.onnx",
];
// Uncompressed total, for progress: servers may gzip, so content-length
// doesn't match the bytes received.
const MODELS_TOTAL_BYTES = 157528486;
// The big convolutional models gain from the GPU; the decoder runs in homr-rs.
const GPU_MODELS = new Set([MODELS[0], MODELS[1]]);

let ort;

const post = (msg, transfer) => self.postMessage(msg, transfer);

// onnxruntime starts by asking for a shared block of memory that can grow to
// 4 GB. The whole 4 GB is set aside (not used) at once, and iPhones and iPads
// sometimes refuse it: "RangeError: Out of memory", which was every
// out-of-memory failed read there (GoatCounter, v307-v319: 13, all in low
// memory, where a read has already been cut short once). Refused, it's asked
// for again with less room to grow, down to 512 MB (segnet, the one model
// always on onnxruntime, takes about 230 MB). The same for the reader's own
// threads' memory (encoder_pool.mjs). Nothing changes where 4 GB is given.
const MEMORY_STEPS = [32768, 16384, 12288, 8192]; // 64 KB pages: 2 GB, 1 GB, 768 MB, 512 MB
let refuseAbove = Infinity; // test switch (init's memoryMax): refuse more pages than this, as an iPhone might
{
  const Memory = WebAssembly.Memory;
  WebAssembly.Memory = function (d) {
    const sizes = d?.shared && d.maximum > MEMORY_STEPS.at(-1) ? [d.maximum, ...MEMORY_STEPS.filter((pages) => pages < d.maximum)] : [d?.maximum];
    for (const [i, maximum] of sizes.entries()) {
      try {
        if (maximum > refuseAbove) throw new RangeError("Out of memory");
        const memory = new Memory(i ? { ...d, maximum } : d);
        if (i) post({ type: "log", msg: `Memory: ${d.maximum / 16} MB to grow into was refused, got ${maximum / 16} MB` });
        return memory;
      } catch (e) {
        if (!(e instanceof RangeError) || i === sizes.length - 1) throw e;
      }
    }
  };
  WebAssembly.Memory.prototype = Memory.prototype;
}
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
  [MODELS[2]]: 47356003,
};
const modelUrl = (name) => new URL("models/" + name, location.href).href;
const pieceKey = (name, i) => `${modelUrl(name)}?piece=${i}`;
class NoRoom extends Error {} // the browser wouldn't store a downloaded piece (storage full)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The reader's own WebAssembly (path + this version's ?v=…). A connection that
// drops while it downloads fails the read ("WebAssembly compilation aborted:
// Network error: Response body loading was aborted", Android, v260): try again.
async function compileWasm(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await WebAssembly.compileStreaming(fetch(path + location.search));
    } catch (e) {
      if (e instanceof WebAssembly.CompileError || attempt >= 4) throw e;
      post({ type: "progress", stage: "retry", name: path, attempt, why: e.message || e.name });
      await sleep(1000 * attempt * attempt);
    }
  }
}

async function fetchPiece(url, start, end) {
  const abort = new AbortController();
  // Stalled means no bytes for STALL_MS, not a piece that takes longer than
  // that: the timer starts again with each chunk (a 4 MiB piece in 30 s needs
  // over 1 Mbit/s; a slower, steady connection never got the reader).
  let timer;
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => abort.abort(), STALL_MS);
  };
  alive();
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, cache: "no-store", signal: abort.signal });
    if (res.status !== 200 && res.status !== 206) throw new Error(`unexpected response ${res.status}`);
    const chunks = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      alive();
      chunks.push(value);
      size += value.byteLength;
    }
    const buf = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      buf.set(c, at);
      at += c.byteLength;
    }
    if (res.status === 200) return { whole: buf.buffer }; // server ignores ranges
    if (size !== end - start + 1) throw new Error("short read");
    return { piece: buf.buffer };
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
            await cache.put(modelUrl(name), new Response(got.whole)).catch((e) => {
              throw new NoRoom(e.name || e.message);
            });
            post({ type: "progress", stage: "download", name, loaded: size, total: MODELS_TOTAL_BYTES });
            return;
          }
          await cache.put(pieceKey(name, i), new Response(got.piece)).catch((e) => {
            throw new NoRoom(e.name || e.message);
          });
          break;
        } catch (e) {
          // Not the connection: downloading it again wouldn't help.
          if (e instanceof NoRoom) throw new Error(`the music reader couldn't be kept on this device (${e.message}). Free some storage space and try again`);
          if (attempt >= 8) {
            throw new Error(
              `the connection keeps dropping (${e.message}). What has downloaded is kept; try again on a better connection`,
            );
          }
          post({ type: "progress", stage: "retry", name, attempt, why: e.name === "AbortError" ? "stalled" : e.message || e.name });
          await sleep(Math.min(30000, 2000 * attempt * attempt));
        }
      }
    }
    loaded = end + 1;
    post({ type: "progress", stage: "download", name, loaded, total: MODELS_TOTAL_BYTES });
  }
}

// Models from earlier versions (e.g. the 465 pair, about 100 MB) would stay in
// Cache Storage for good, and phones are short of quota: remove what MODELS
// doesn't name once the current ones are stored. Best effort.
async function dropOldModels() {
  try {
    const cache = await caches.open(MODEL_CACHE);
    const current = MODELS.map((name) => modelUrl(name));
    for (const req of await cache.keys()) {
      if (!current.some((u) => req.url === u || req.url.startsWith(u + "?"))) await cache.delete(req);
    }
  } catch {}
}

// A stored piece can vanish between the download check and here (seen on
// iPhones, after Safari reloaded the page under memory pressure): fetch the
// missing pieces again, once, rather than fail the read.
// into(size): where to put the bytes (default a new array), e.g. straight
// into the reader's memory, so a phone doesn't hold a second copy.
async function modelBytes(name, again, into = (n) => new Uint8Array(n)) {
  const cache = await caches.open(MODEL_CACHE);
  const whole = await cache.match(modelUrl(name));
  if (whole) {
    const got = new Uint8Array(await whole.arrayBuffer());
    const bytes = into(got.byteLength);
    if (bytes.byteLength !== got.byteLength) throw new Error(`model ${name} has the wrong size`);
    bytes.set(got);
    return bytes;
  }
  const size = MODEL_SIZES[name];
  let bytes;
  for (let i = 0; i * PIECE < size; i++) {
    const piece = await cache.match(pieceKey(name, i));
    if (!piece) {
      if (again) throw new Error(`model piece missing: ${name} #${i}`);
      post({ type: "refetch", name, piece: i });
      await downloadModel(name);
      // The space already given (if any) is used again, not given twice.
      const given = bytes;
      return modelBytes(name, true, (n) => given ?? into(n));
    }
    const got = new Uint8Array(await piece.arrayBuffer());
    bytes ??= into(size);
    bytes.set(got, i * PIECE);
  }
  return bytes;
}


// On iPhones and iPads, segnet runs on the CPU: on WebGPU, onnxruntime makes
// about 900 MB of short-lived buffers a page that Safari frees late (Mac
// Safari, 3 pages: 4.3 GB at the peak, against 1.5 GB with segnet on the CPU),
// more than iOS lets a tab have.
// The app says so in init (an iPad's Safari calls itself a Mac, and a worker
// can't tell them apart by touch); the user agent until then.
let IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

async function newSession(id) {
  const name = sessionNames[id];
  const gpu = useGpu && GPU_MODELS.has(name) && !(IOS && name === MODELS[0]);
  let eps = gpu ? ["webgpu", "wasm"] : ["wasm"];
  const t0 = performance.now();
  const bytes = await modelBytes(name);
  const create = () => ort.InferenceSession.create(bytes, { executionProviders: eps, graphOptimizationLevel: "all" });
  let session;
  try {
    session = await create();
  } catch (e) {
    // A GPU that has gone (e.g. a phone's, under memory pressure) can fail
    // onnxruntime's WebGPU setup too ("Cannot read properties of undefined
    // (reading 'destroy')"), and that leaves it unable to set up another
    // WebGPU session ("another WebGPU EP inference session is being created";
    // Android, v238): carry on without the GPU, as run() does.
    if (!gpu) throw e;
    post({ type: "log", msg: `WebGPU setup failed (${e.message}); using WASM from now on` });
    useGpu = false;
    eps = ["wasm"];
    try {
      session = await create();
    } catch (e2) {
      // onnxruntime's WebAssembly itself didn't start: the WebGPU attempt
      // started it first, so its error says why ("[webgpu] …"); the WASM
      // attempt only says "previous call to 'initWasm()' failed" (iPhone, v258).
      throw /previous call to 'initWasm\(\)' failed/.test(e2.message) ? e : e2;
    }
  }
  if (eps[0] === "webgpu") onGpu.add(id);
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
      // Released before the next is made: onnxruntime sets up one session at
      // a time. (A failed release mustn't fail the read.)
      await Promise.resolve().then(() => old.release()).catch(() => {});
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
      const mod = await compileWasm("omr/partsong_omr_fused.wasm");
      const rs = hooked((await WebAssembly.instantiate(mod, {})).exports);
      if (rs.decoder_fused_simd_supported() === 1) return { rs, build: "relaxed SIMD" };
    } catch (e) {
      post({ type: "log", msg: `Relaxed SIMD decoder unavailable (${e.message})` });
    }
  }
  const rs = hooked((await WebAssembly.instantiate(wasmModule, {})).exports);
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
  let mod = await compileWasm(file());
  const ms = {};
  const order = [...counts, ...[...counts].reverse()];
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    const pool = await EncoderPool.create(mod, { threads: n });
    try {
      const e = pool.exports;
      if (fused && e.encoder_fused_simd_supported() !== 1) {
        fused = false; // as decoderModule would: the plain SIMD build
        mod = await compileWasm(file());
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
    const mod = await compileWasm(file);
    const pool = await EncoderPool.create(mod, { threads });
    return pool;
  };
  if (WebAssembly.validate(RELAXED_SIMD)) {
    try {
      const pool = await pick("omr/partsong_omr_threads_fused.wasm");
      if (pool.exports.decoder_fused_simd_supported() === 1 && pool.exports.encoder_fused_simd_supported() === 1) {
        return { rs: hooked(pool.exports), build: `relaxed SIMD, ${threads} threads` };
      }
      await pool.close();
    } catch (e) {
      post({ type: "log", msg: `Relaxed SIMD threaded encoder unavailable (${e.message})` });
    }
  }
  const pool = await pick("omr/partsong_omr_threads.wasm");
  return { rs: hooked(pool.exports), build: `SIMD, ${threads} threads` };
}
async function rustDecoder() {
  if (decoderInstance) return decoderInstance;
  const t0 = performance.now();
  const { rs, build } = (loadingDecoder = await decoderModule());
  let p, n;
  await modelBytes(MODELS[2], false, (size) => ((p = rs.decoder_alloc((n = size))), new Uint8Array(rs.memory.buffer, p, n)));
  const model = rs.decoder_load(p, n);
  rs.decoder_free(p, n);
  if (!model) throw new Error("the music reader couldn't load homr's decoder");
  const contextBytes = CONTEXT_POSITIONS * DECODER_DIM * 4;
  // Kept only once it's whole: one whose encoder failed to load was once used by the next read.
  const d = { rs, build, model, context: rs.decoder_alloc(contextBytes), out: rs.decoder_alloc(MAX_SEQ_LEN * 32) };
  post({ type: "log", msg: `Loaded ${MODELS[2]} in homr-rs (${build}) in ${Math.round(performance.now() - t0)} ms` });
  if (exactEncoder) {
    const t1 = performance.now();
    let ep, en;
    await modelBytes(MODELS[1], false, (size) => ((ep = rs.decoder_alloc((en = size))), new Uint8Array(rs.memory.buffer, ep, en)));
    d.encoder = rs.encoder_load(ep, en);
    rs.decoder_free(ep, en);
    if (!d.encoder) throw new Error("the music reader couldn't load homr's encoder");
    d.image = rs.decoder_alloc(IMAGE_VALUES * 4);
    post({ type: "log", msg: `Loaded ${MODELS[1]} in homr-rs (${build}, exact) in ${Math.round(performance.now() - t1)} ms` });
    // The same encoder on the GPU, with the same results: it tests itself
    // first and otherwise (or if a staff trips its checks) uses the CPU one.
    if (self.navigator.gpu && !noGpuSetting && encoderGpu !== false) {
      const t2 = performance.now();
      try {
        const { EncoderGPU } = await import("./omr/encoder_gpu.mjs");
        const gpu = await EncoderGPU.create({ exports: rs, encoder: d.encoder });
        const st = gpu.status;
        if (st.backend === "gpu") d.gpu = gpu;
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
  loadingDecoder = null;
  return (decoderInstance = d);
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

// A panic in the reader traps as "unreachable", like running out of memory;
// its hook keeps the panic's message (see panic_hook in omr-rs/src/lib.rs).
function hooked(rs) {
  rs.panic_hook?.();
  return rs;
}
// The decoder's reader while its models load (it's decoderInstance only once
// loaded): a panic there is a panic too, not memory.
let loadingDecoder = null;
// After a failure: the panic's message from whichever reader panicked (also
// on a thread of the encoder pool, which shares its memory), else null. Read
// once, then cleared.
function panicText() {
  const readers = [[pageReader, "page reader"], [decoderInstance?.rs ?? loadingDecoder?.rs, decoderInstance?.build ?? loadingDecoder?.build]];
  for (const [rs, build] of readers) {
    const n = rs?.panic_len?.();
    if (!n) continue;
    const text = new TextDecoder().decode(new Uint8Array(rs.memory.buffer, rs.panic_ptr(), n).slice());
    rs.panic_clear?.();
    // Its place without the build machine's folders: "homr-rs/src/....rs:12:5",
    // "alloc/src/...", "serde-1.0.0/src/...".
    return { build, text: text.replace(/\S*\/(homr-rs|omr-rs)\S*?\/src\//g, "$1/src/").replace(/\/(?:[^\s/:]+\/)*([^\s/:]+)\/src\//g, "$1/src/") };
  }
  return null;
}
// The Rust functions a panic came through, innermost first, for the problem
// log: a panic inside Rust's own code (e.g. "capacity overflow") names only
// that, not our call that led there. The panic's own machinery left out, and
// Chrome's frames shortened to "name [function index]". (Chrome keeps 10
// frames unless told otherwise, and the machinery alone is 10.)
Error.stackTraceLimit = 60;
const PANIC_MACHINERY = /panicking|panic_fmt|panic_handler|rust_begin_unwind|rust_start_panic|rust_abort|rust_panic|backtrace|unwrap_failed|expect_failed|capacity_overflow|handle_error|panic_bounds_check|core\d+panicking/;
function rustFrames(e, build) {
  const frames = String(e.stack ?? "")
    .split("\n")
    .filter((l) => /wasm/.test(l) && !/wasm-stub/.test(l) && !PANIC_MACHINERY.test(l))
    .map((l) =>
      l
        .trim()
        // Chrome: "at partsong_omr.wasm.NAME (URL:wasm-function[N]:0x...)"
        .replace(/^at (?:[\w.]+?\.wasm\.)?/, "")
        .replace(/\s*\([^()]*wasm-function\[(\d+)\][^()]*\)$/, " [$1]")
        // Safari: "<?>.wasm-function[NAME]@[wasm code]"
        .replace(/^<\?>\.wasm-function\[(.*)\]@\[wasm code\]$/, "$1"),
    );
  return `${build ?? "?"} build:\n${frames.join("\n")}`.slice(0, 2000);
}

// The page's pixels as homr's cv2.imread sees them (RGBA, no colour conversion).
async function pixels(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0; // its memory back now, not when collected (see pdf-pages.js)
  return data;
}

// Deflated (a page's class maps are mostly background: a few MB to tens of KB).
const squeeze = async (bytes, fmt, Stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream(fmt))).arrayBuffer());

// The reader with the page open and its staffs found. classes: the page's
// segmentation from an earlier layout (deflated), else segnet runs.
// One reader instance for every page, the last page closed before the next
// opens, so its memory is reused: with a fresh instance per page, the old one
// (~140 MB) waited for Safari to free it while the next page opened on top
// (iPhone simulator, sample: about 1 GB for a moment on each page). The page
// is closed again once read, so its data isn't kept while the score plays.
// An error the reader reports (e.g. no music on a cover page) leaves it
// usable; only a trap (WebAssembly.RuntimeError) drops it, as its state may
// be broken. Requests come one at a time (app.js awaits each).
let pageReader = null;
// page.image, and its pixels, are let go once they're in the reader, so they
// aren't kept while segnet runs (a phone's photo: about 50 MB).
async function openPage(page, systemsJson, packed) {
  const rs = (pageReader ??= hooked((await WebAssembly.instantiate(wasmModule, {})).exports));
  rs.page_close();
  const mem = () => rs.memory.buffer;
  const copyIn = (typed) => {
    const p = rs.alloc(typed.byteLength);
    new Uint8Array(mem(), p, typed.byteLength).set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
    return p;
  };
  const message = () => new TextDecoder().decode(new Uint8Array(mem(), rs.msg_ptr(), rs.msg_len()));

  const ms = {};
  let t = performance.now();
  const lap = (k) => { const n = performance.now(); ms[k] = n - t; t = n; };
  let img = await pixels(page.image);
  page.image = null;
  lap("decode");
  const ranges = systemsJson ? JSON.parse(systemsJson).flat() : [];
  const rgba = copyIn(img.data);
  const { width, height } = img;
  const bytes = img.data.byteLength;
  img = null;
  const sys = copyIn(Float64Array.from(ranges));
  const tiles = rs.page_open(rgba, width, height, sys, ranges.length / 2);
  rs.dealloc(rgba, bytes);
  rs.dealloc(sys, ranges.length * 8);
  lap("tiles");

  let classes = packed ? await squeeze(packed, "deflate", DecompressionStream) : null;
  if (classes?.length !== tiles * WIN * WIN) classes = await segment(rs, tiles);
  lap("segnet");
  lastSeen = seen(classes);
  post({ type: "log", msg: `Seen on the page: staff lines ${lastSeen.staff.toFixed(1)}%, noteheads ${lastSeen.heads.toFixed(1)}%` });
  const cp = copyIn(classes);
  const segmented = rs.page_segment(cp);
  rs.dealloc(cp, classes.byteLength); // also when the page has no music (it throws below)
  if (segmented !== 0) throw new Error(message());
  lap("segment");
  return { rs, mem, copyIn, message, classes, ms };
}

// What segnet made of the last page opened: the share of it (per cent) it took
// for staff lines and for noteheads (homr's classes 4 and 2). Sent with an
// error, so "no music found" says whether none was seen (not music, or too
// faint) or it was seen and not made into staves (ours to fix). Never the page.
let lastSeen = null;
function seen(classes) {
  let staff = 0, heads = 0;
  for (let i = 0; i < classes.length; i++) {
    if (classes[i] === 4) staff++;
    else if (classes[i] === 2) heads++;
  }
  return { staff: (100 * staff) / classes.length, heads: (100 * heads) / classes.length };
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
async function layout(page, systemsJson) {
  const t = performance.now();
  // segnet first, then the page, as recognise() does: loading it makes
  // short-lived copies, and on top of the page's picture opening that was the
  // peak of finding systems (Chrome, a phone photo: about 950 MB).
  await session(MODELS[0]);
  const { rs, message, classes, ms: open } = await openPage(page, systemsJson);
  const t1 = performance.now();
  rs.page_layout();
  const t2 = performance.now();
  const systems = JSON.parse(message());
  rs.page_close();
  const out = { ...systems, classes: await squeeze(classes, "deflate", CompressionStream) };
  const t3 = performance.now();
  out.timing = `decode ${Math.round(open.decode)} ms, tiles ${Math.round(open.tiles)} ms, segnet+argmax ${Math.round(open.segnet)} ms, segment ${Math.round(open.segment)} ms, layout ${Math.round(t2 - t1)} ms, pack ${Math.round(t3 - t2)} ms (total open ${Math.round(t1 - t)})`;
  return out;
}

async function recognise(page, systemsJson, packed) {
  // The models first, then the page: loading them makes short-lived copies,
  // and with the page's picture open as well that was the read's peak
  // (iPhone simulator, sample: 1.23 GB for a moment, now 0.99 GB; 0.79 GB
  // while reading).
  // On iPhones and iPads (segnet on the CPU) the staff finder is let go first
  // when the page's segmentation comes with it: its memory goes to the
  // encoder (simulator, sample: about 50 MB less while reading); it's loaded
  // again if another layout needs it. (Without it, as after a resume, segnet
  // runs for each page, so it stays.)
  if (IOS && packed && sessionIds.has(MODELS[0])) {
    const id = sessionIds.get(MODELS[0]);
    sessionIds.delete(MODELS[0]);
    const old = sessions[id];
    sessions[id] = null;
    await Promise.resolve().then(() => old.release()).catch(() => {}); // a failed release mustn't fail the read
  }
  const decoder = await rustDecoder();
  const encoder = exactEncoder ? null : await session(MODELS[1]);
  const { rs, mem, copyIn, message } = await openPage(page, systemsJson, packed);

  let staff = 0;
  for (;;) {
    const state = rs.page_step();
    if (state === 0) {
      const xml = message();
      rs.page_close();
      return xml;
    }
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
  wasmModule = await compileWasm("omr/partsong_omr.wasm");
  for (const name of MODELS) {
    await downloadModel(name);
  }
  await dropOldModels();
  post({ type: "ready", gpu: useGpu });
}

let ready;
self.onmessage = async ({ data }) => {
  lastSeen = null;
  try {
    if (data.type === "init") {
      if (typeof data.ios === "boolean") IOS = data.ios;
      if (data.memoryMax > 0) refuseAbove = data.memoryMax;
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
      const t0 = performance.now();
      runTimes = [];
      const page = { image: data.image };
      data.image = null;
      const r = await layout(page, data.systems ?? "");
      const ms = Math.round(performance.now() - t0);
      const seg = runTimes[sessionIds.get(MODELS[0])] ?? { ms: 0, calls: 0 };
      post({ type: "log", msg: `Systems in ${ms} ms: segnet ${Math.round(seg.ms)} ms/${seg.calls} calls; ${r.timing}` });
      delete r.timing;
      post({ type: "result", id: data.id, ...r }, [r.classes.buffer]);
    } else if (data.type === "recognise") {
      await ready;
      await tuning;
      const t0 = performance.now();
      runTimes = [];
      const page = { image: data.image };
      data.image = null;
      const xml = await recognise(page, data.systems ?? "", data.classes);
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
    // A panic is a bug in the reader, not memory: say where (see panicText).
    // Any failure, not only a trap: a panic on an encoder pool thread comes
    // back as the pool's own error ("encoder worker N failed").
    const panic = panicText();
    if (e instanceof WebAssembly.RuntimeError) pageReader = null;
    const msg = String(e && e.message ? e.message : e);
    post({ type: "error", id: data.id, msg: panic ? `the music reader failed: ${panic.text}` : msg, panic: !!panic, stack: panic ? rustFrames(e, panic.build) : undefined, seen: lastSeen });
  }
};
