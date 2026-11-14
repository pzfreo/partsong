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
const Real = Worker;
window.Worker = class extends Real {
  postMessage(m, t) {
    if (m?.type === "init") inits.push(`exact ${m.exact}, noGpu ${m.noGpu}`);
    if (m?.type === "recognise" && failures > 0) {
      failures--;
      setTimeout(() => this.onmessage({ data: { type: "error", id: m.id, msg: "RuntimeError: Unreachable code should not be executed (evaluating 'rs.page_step()')" } }));
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

// Out of memory once: carried on in low memory, and read.
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

r.ok = r.once.carriedOn && r.once.inits.at(-1) === "exact true, noGpu true" && r.once.inits.length === 2 &&
  r.once.counted.includes("read-out-of-memory (iPad dev): carried on in low memory") && r.once.counted.includes("read-ok (iPad dev): low memory") &&
  !r.once.counted.some((p) => p.startsWith("read-failed")) &&
  r.twice.status === "Couldn't read page 1: there wasn't enough memory.\nClose other apps and browser tabs, then tap Read music to carry on from this page." &&
  r.twice.counted.some((p) => /^read-failed \(iPad dev\): .*Unreachable code.* \(low memory\)$/.test(p)) &&
  !r.twice.counted.some((p) => p.startsWith("read-out-of-memory")) && r.twice.thenRead.includes("read-ok (iPad dev): low memory");
window.result = r;
