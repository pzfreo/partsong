// A worker enters only allocation-free encoder_work, with its private stack/TLS.
const isNode = typeof process !== 'undefined' && !!process.versions?.node;
const port = isNode ? (await import('node:worker_threads')).parentPort : self;
const post = message => port.postMessage(message);
async function start({module, memory, control, rank, threads, stackTop, tlsBase}) {
  const c = new Int32Array(control);
  try {
    const {exports: e} = await WebAssembly.instantiate(module, {
      env: {memory}, encoder_threads: {dispatch() {throw Error('recursive worker dispatch');}},
    });
    e.__stack_pointer.value = stackTop;
    if (tlsBase) e.__wasm_init_tls(tlsBase);
    post({ready: rank});
    let previous = 0;
    while (true) {
      let epoch = Atomics.load(c, 8 + rank);
      while (epoch === previous) {Atomics.wait(c, 8 + rank, previous); epoch = Atomics.load(c, 8 + rank);}
      if (epoch === -1) break;
      try {
        if (e.encoder_work(Atomics.load(c, 0), rank, threads) !== 1) throw Error('rank rejected');
      } catch (error) {Atomics.store(c, 2, rank); post({error: String(error.stack || error)});}
      previous = epoch;
      Atomics.add(c, 8 + threads + rank, 1);
      Atomics.sub(c, 1, 1); Atomics.notify(c, 1);
    }
    if (isNode) port.close(); else self.close();
  } catch (error) {Atomics.store(c, 2, rank); post({error: String(error.stack || error)});}
}
if (isNode) port.once('message', start); else self.onmessage = event => start(event.data);
