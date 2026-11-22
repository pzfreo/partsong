// The reader running out of memory without the phone closing the page (Safari:
// "Unreachable code should not be executed", Chrome: "unreachable"): the read
// carries on in low memory (exact encoder, no GPU) from where it stopped, and
// is counted. Out of memory again, already in low memory: a plain message, the
// failure counted with "(low memory)", and Read music carries on.
// Run against http://localhost:8765/index.html.
//   CHROME_FLAGS="--mute-audio --host-resolver-rules=MAP gc.zgo.at ~NOTFOUND" \
//     node scripts/headless-test.mjs http://localhost:8765/index.html out.json 600 tests/drive-out-of-memory.js
const events = []; window.goatcounter = { count: (e) => events.push(e.path) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label + " | status: " + document.getElementById("status").textContent); };
const $ = (id) => document.getElementById(id);
// The reader's first page fails as Safari's does when WebAssembly runs out of memory.
const inits = [];
let failures = 0;
let panics = 0; // a panic in the reader: it traps as "unreachable" too, but isn't memory
const Real = Worker;
window.Worker = class extends Real {
  postMessage(m, t) {
    if (m?.type === "init") inits.push(`exact ${m.exact}, noGpu ${m.noGpu}`);
    if (m?.type === "recognise" && failures > 0) {
      failures--;
      setTimeout(() => this.onmessage({ data: { type: "error", id: m.id, msg: "RuntimeError: Unreachable code should not be executed (evaluating 'rs.page_step()')" } }));
      return;
    }
    if (m?.type === "recognise" && panics > 0) {
      panics--;
      setTimeout(() => this.onmessage({ data: { type: "error", id: m.id, panic: true, msg: "the music reader failed: panicked at homr-rs/src/staff.rs:1:1:\ninternal error: entered unreachable code" } }));
      return;
    }
    super.postMessage(m, t);
  }
};
const statuses = [];
new MutationObserver(() => statuses.push($("status").textContent)).observe($("status"), { childList: true, characterData: true, subtree: true });
await sleep(500);
$("new-scan").click();
await waitFor(() => !$("scan").hidden, 10000, "scan screen");
const png = await (await fetch("/testdata/huron_0.png")).blob();
const addPage = () => { const dt = new DataTransfer(); dt.items.add(new File([png], "p0.png", { type: "image/png" })); $("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change")); };
addPage();
await waitFor(() => !$("recognise").disabled, 20000, "page added");
const r = {};

// A panic in the reader: not taken for memory (no low memory, no read-out-of-memory),
// a plain message, the reader started again, and Read music carries on.
// (A real panic's message: tests/panic-message.mjs.)
panics = 1;
$("recognise").click();
r.panic = { status: await waitFor(() => { if (!$("systems-check").hidden && !$("check-done").hidden) $("check-done").click(); return /Couldn't read/.test($("status").textContent) && $("status").textContent; }, 300000, "panic message") };
r.panic.counted = events.filter((p) => /^read-(ok|failed|out-of-memory)/.test(p));
$("recognise").click();
await waitFor(() => !$("practice").hidden, 300000, "practice 3");
r.panic.thenRead = events.filter((p) => /^read-ok \(/.test(p));
r.panic.inits = [...inits];

// Out of memory once (low memory from here on): carried on in low memory, and read.
events.length = 0; inits.length = 0; statuses.length = 0;
$("back").click(); await sleep(500);
$("new-scan").click();
await waitFor(() => !$("scan").hidden && $("pages").children.length === 0, 10000, "new scan 1");
addPage();
await waitFor(() => !$("recognise").disabled, 20000, "page added 1");
failures = 1;
$("recognise").click();
await waitFor(() => { if (!$("systems-check").hidden && !$("check-done").hidden) $("check-done").click(); return !$("practice").hidden; }, 300000, "practice");
r.once = {
  carriedOn: statuses.some((s) => s.includes("Running short of memory: carrying on more slowly")),
  inits: [...inits],
  counted: events.filter((p) => /^read-(ok|failed|out-of-memory)/.test(p)),
};

// Out of memory twice: the second time, already in low memory, a plain message.
events.length = 0; inits.length = 0; statuses.length = 0;
$("back").click(); await sleep(500);
$("new-scan").click();
await waitFor(() => !$("scan").hidden && $("pages").children.length === 0, 10000, "new scan");
addPage();
await waitFor(() => !$("recognise").disabled, 20000, "page added");
failures = 1;
$("recognise").click();
r.twice = { status: await waitFor(() => { if (!$("systems-check").hidden && !$("check-done").hidden) $("check-done").click(); return /Couldn't read/.test($("status").textContent) && $("status").textContent; }, 300000, "message") };
r.twice.counted = events.filter((p) => /^read-(ok|failed|out-of-memory)/.test(p));
r.twice.inits = [...inits];
// Read music carries on (the systems as checked).
$("recognise").click();
await waitFor(() => !$("practice").hidden, 300000, "practice 2");
r.twice.thenRead = events.filter((p) => /^read-ok \(/.test(p));

r.ok = r.once.carriedOn && r.once.inits.join("; ") === "exact false, noGpu false; exact false, noGpu false; exact true, noGpu true" &&
  r.once.counted.includes("read-out-of-memory (iPad dev): carried on in low memory") && r.once.counted.includes("read-ok (iPad dev): low memory") &&
  !r.once.counted.some((p) => p.startsWith("read-failed")) &&
  r.twice.status === "Couldn't read page 1: there wasn't enough memory.\nClose other apps and browser tabs, then tap Read music to carry on from this page." &&
  r.twice.counted.some((p) => /^read-failed \(iPad dev\): .*Unreachable code.* \(low memory\)$/.test(p)) &&
  !r.twice.counted.some((p) => p.startsWith("read-out-of-memory")) && r.twice.thenRead.includes("read-ok (iPad dev): low memory") &&
  r.panic.status === "Couldn't read page 1: the music reader went wrong on it, and it's been reported.\nRetaking the photo may get round it." &&
  r.panic.counted.includes("read-failed (iPad dev): internal error: entered unreachable code") &&
  !r.panic.counted.some((p) => p.startsWith("read-out-of-memory") || p.endsWith("(low memory)")) &&
  r.panic.inits.every((i) => i === "exact false, noGpu false") && r.panic.inits.length >= 2 &&
  r.panic.thenRead.length > 0;
window.result = r;
