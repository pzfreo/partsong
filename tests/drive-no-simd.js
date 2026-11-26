// A browser without WebAssembly SIMD (an old processor, a locked-down work
// computer, iOS before 16.4; one Windows Chrome 157 on 26 Nov, three failed
// reads with "Wasm SIMD unsupported" and the module's function name): the device
// check says so in plain words for the device (an iPhone: update to iOS 16.4; a
// computer: updating may not help), and a read that fails with it shows the same
// and is counted as "no SIMD", not as the compile error.
// Run once per kind of device, with USER_AGENT set to an iPhone's, an Android phone's and a Windows computer's
// (the test browser's own looks like a touch-screen Mac, an iPad); it reports which it saw.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const events = []; window.goatcounter = { count: (e) => events.push(e.path) };
const Real = Worker;
window.Worker = class extends Real {
  constructor(url, o) {
    // The device check's throwaway worker (a blob): it says there's no SIMD.
    if (String(url).startsWith("blob:")) return { terminate() {}, set onmessage(f) { setTimeout(() => f({ data: "no SIMD" }), 20); }, set onerror(f) {} };
    super(url, o);
  }
  postMessage(m, t) {
    // The reader's first step, as Chrome fails it without SIMD.
    if (m?.type === "layout") {
      setTimeout(() => this.onmessage({ data: { type: "error", id: m.id, msg: `WebAssembly.compileStreaming(): Compiling function #0:"_RINvMs6_NtCsdCVyFovGmnz_9hashbrown3rawINtB6_8R..." failed: Wasm SIMD unsupported @+2427` } }));
      return;
    }
    super.postMessage(m, t);
  }
};
await sleep(500);
$("new-scan").click();
await waitFor(() => !$("scan").hidden, 10000, "scan screen");
await waitFor(() => /too old|can't run/.test($("device-note").textContent) && !$("device-note").hidden, 5000, "the no-SIMD note"); // (an iPhone's usual note is there first)
const r = { ua: navigator.userAgent.slice(0, 40), note: $("device-note").textContent };
const png = await (await fetch("/testdata/huron_0.png")).blob();
const dt = new DataTransfer(); dt.items.add(new File([png], "p0.png", { type: "image/png" }));
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
await waitFor(() => !$("recognise").disabled, 20000, "page added");
$("recognise").click();
await waitFor(() => /Couldn't read page/.test($("status").textContent), 20000, "failure shown");
r.status = $("status").textContent;
r.counted = events.filter((e) => /^read-failed.*: /.test(e));
const kind = /iPhone/.test(navigator.userAgent) ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : "computer";
const want = { iPhone: /iOS 16\.4/, Android: /Update Chrome/, computer: /may be too old \(before about 2011\)/ }[kind];
r.kind = kind;
r.ok = want.test(r.note) && want.test(r.status) && !/compileStreaming|hashbrown/.test(r.status) && r.counted.some((e) => /: no SIMD$/.test(e)) && !r.counted.some((e) => /hashbrown|compileStreaming/.test(e));
window.result = r;
