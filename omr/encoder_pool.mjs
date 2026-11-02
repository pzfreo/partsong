// Host-managed synchronous encoder pool. Works in Node or a browser Web Worker.
// Normal nonshared artifacts keep their existing ABI and need no pool.
const isNode = typeof process !== 'undefined' && !!process.versions?.node;

export class EncoderPool {
  static async create(module, {threads = 1, maximumPages = 16384, stackBytes = 1048576} = {}) {
    if (!Number.isInteger(threads) || threads < 1 || threads > 32) throw Error('threads must be 1..32');
    if (!isNode && threads > 1 && typeof Window !== 'undefined') throw Error('Run the encoder coordinator in a Web Worker: Atomics.wait is forbidden on Window');
    const pool = new EncoderPool();
    pool.threads = threads; pool.workers = []; pool.allocations = []; pool.jobs = 0; pool.failed = false; pool.closed = false;
    pool.control = new Int32Array(new SharedArrayBuffer((8 + threads * 2) * 4));
    pool.memory = new WebAssembly.Memory({initial: 32, maximum: maximumPages, shared: true});
    pool.instance = await WebAssembly.instantiate(module, {
      env: {memory: pool.memory}, encoder_threads: {dispatch: (job, units) => pool.dispatch(job, units)},
    });
    pool.exports = pool.instance.exports;
    const e = pool.exports;
    if (!e.encoder_work || !e.__stack_pointer || e.memory !== pool.memory) throw Error('Not an encoder-threads shared-memory artifact');
    const tlsSize = e.__tls_size?.value || 0, tlsAlign = e.__tls_align?.value || 1;
    const allocate = bytes => {const p = e.decoder_alloc(bytes); pool.allocations.push([p, bytes]); return p;};
    const tls = () => {const p = allocate(tlsSize + tlsAlign); return Math.ceil(p / tlsAlign) * tlsAlign;};
    if (tlsSize) e.__wasm_init_tls(tls());
    try {
      const Worker = isNode ? (await import('node:worker_threads')).Worker : globalThis.Worker;
      // Instantiate serially while the coordinator is outside WASM. Each
      // instance has a private stack/global TLS base; static data initializes
      // once via LLD's shared-memory atomic initialization guard.
      for (let rank = 1; rank < threads; rank++) {
        const stack = allocate(stackBytes), tlsBase = tlsSize ? tls() : 0;
        const worker = new Worker(new URL('./encoder_worker.mjs', import.meta.url), {type: 'module'});
        pool.workers.push(worker);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error(`encoder worker ${rank} startup timeout`)), 30000);
          const ready = value => {clearTimeout(timeout); value.error ? reject(Error(value.error)) : resolve();};
          const failed = error => {clearTimeout(timeout); reject(error);};
          if (isNode) {worker.once('message', ready); worker.once('error', failed);}
          else {worker.onmessage = event => ready(event.data); worker.onerror = failed;}
          worker.postMessage({module, memory: pool.memory, control: pool.control.buffer, rank, threads, stackTop: stack + stackBytes, tlsBase});
        });
      }
      return pool;
    } catch (error) {pool.failed = true; await pool.close(); throw error;}
  }

  dispatch(job, units) {
    if (this.failed || this.closed) throw Error('encoder pool is poisoned or closed');
    this.jobs++;
    if (this.threads === 1) {
      if (this.exports.encoder_work(job, 0, 1) !== 1) throw Error('encoder rank rejected');
      return;
    }
    const c = this.control;
    Atomics.store(c, 0, job); Atomics.store(c, 1, this.threads - 1); Atomics.store(c, 2, 0);
    this.epoch = ((this.epoch || 0) + 1) & 0x7fffffff;
    if (!this.epoch) this.epoch = 1;
    for (let rank = 1; rank < this.threads; rank++) {
      Atomics.store(c, 8 + rank, this.epoch); Atomics.notify(c, 8 + rank);
    }
    try {
      if (this.exports.encoder_work(job, 0, this.threads) !== 1) throw Error('encoder coordinator rank rejected');
      const deadline = performance.now() + 30000;
      let remaining;
      while ((remaining = Atomics.load(c, 1)) !== 0) {
        if (performance.now() > deadline) throw Error('encoder worker did not join within 30s');
        Atomics.wait(c, 1, remaining, 1000);
      }
      if (Atomics.load(c, 2)) throw Error(`encoder worker ${Atomics.load(c, 2)} failed`);
    } catch (error) {
      // The Rust stack job may no longer be live after an exception. Never
      // reuse this instance or free graph buffers until workers are terminated.
      this.failed = true;
      throw error;
    }
    void units;
  }

  executions() {
    return [this.jobs, ...Array.from({length: this.threads - 1}, (_, i) => Atomics.load(this.control, 8 + this.threads + i + 1))];
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (let rank = 1; rank < this.threads; rank++) {Atomics.store(this.control, 8 + rank, -1); Atomics.notify(this.control, 8 + rank);}
    await Promise.all(this.workers.map(worker => worker.terminate()));
    if (!this.failed) for (const [p, bytes] of this.allocations.reverse()) this.exports.decoder_free(p, bytes);
  }
}
