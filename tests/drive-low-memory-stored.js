// A device that ran out of memory keeps reading in low memory (stored), and one that
// hasn't doesn't. A stand-in reader notes how it was started (init.lowMemory):
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-low-memory-stored.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async () => {
  const inits = [];
  const f = document.createElement("iframe");
  f.src = "/index.html";
  document.body.append(f);
  const Reader = class { postMessage(m) { if (m.type === "init") inits.push(!!m.lowMemory); } terminate() {} addEventListener() {} };
  const stub = setInterval(() => { try { f.contentWindow.Worker = Reader; } catch {} }, 5);
  await sleep(2500);
  f.contentDocument.getElementById("new-scan")?.click(); // opens the scan screen: the reader starts ahead
  await sleep(2500);
  clearInterval(stub);
  f.remove();
  return inits;
};
const r = {};
localStorage.removeItem("partsong-low-memory");
r.fresh = await open();
localStorage.setItem("partsong-low-memory", "1");
r.stored = await open();
// ?lowmem=0 forgets it.
const f = document.createElement("iframe"); f.src = "/index.html?lowmem=0"; document.body.append(f); await sleep(2500); f.remove();
r.forgotten = localStorage.getItem("partsong-low-memory");
localStorage.removeItem("partsong-low-memory");
// What gets stored (the app's own function): by default, yes; not once the usual reader has finished a read here.
const src = await (await fetch("/app.js")).text();
const fn = new Function("localStorage", src.match(/const LOW_MEMORY_KEY[\s\S]*?function rememberLowMemory\(\)[^\n]*/)[0] + "; return rememberLowMemory;")(localStorage);
fn(); r.remembered = localStorage.getItem("partsong-low-memory");
localStorage.removeItem("partsong-low-memory");
localStorage.setItem("partsong-usual-reader-ok", "1");
fn(); r.rememberedAfterUsualOk = localStorage.getItem("partsong-low-memory");
localStorage.removeItem("partsong-usual-reader-ok");
window.result = { ...r, ok: r.remembered === "1" && r.forgotten === null && r.rememberedAfterUsualOk === null && r.fresh.length > 0 && r.fresh.every((x) => !x) && r.stored.length > 0 && r.stored.every((x) => x) };
