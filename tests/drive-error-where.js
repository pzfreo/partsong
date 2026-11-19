// Uncaught errors are counted with where they were thrown ("@ app.js:N"), and
// the sliders and Share buttons do nothing before any score is open.
const events = []; window.goatcounter = { count: (e) => events.push(e.path) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
await sleep(500);
for (const id of ["others", "tempo"]) { $(id).dispatchEvent(new Event("input")); $(id).dispatchEvent(new Event("change")); }
$("share").click(); $("share-score").click();
await sleep(300);
const before = events.filter((p) => p.startsWith("error"));
// The lock switch with no score open still throws (nothing calls it then): an
// uncaught error from app.js's handler, as an event listener's error is.
$("lock").dispatchEvent(new Event("change"));
await sleep(300);
const after = events.filter((p) => p.startsWith("error ("));
window.result = { before, after, ok: before.length === 0 && after.some((p) => /TypeError: .* @ app\.js:\d+$/.test(p)) };
