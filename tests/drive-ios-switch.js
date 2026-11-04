// On iPhone, released builds don't read music unless ?ios=1 turned it on
// (remembered until ?ios=0). Run with an iPhone user agent:
//   USER_AGENT="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" \
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 120 tests/drive-ios-switch.js
// Against a copy of the site stamped like a release (dev and NNN_test builds
// always read): node scripts/stamp-version.mjs <copy> 999, served on its own.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const blocked = async (query) => {
  const f = document.createElement("iframe");
  f.src = "/index.html" + query;
  document.body.append(f);
  await waitFor(() => f.contentDocument?.getElementById("library"), 20000, "frame " + query);
  await sleep(1500);
  const out = f.contentDocument.body.classList.contains("no-reader-device");
  f.remove();
  return out;
};
const r = { iPhone: /iPhone/.test(navigator.userAgent) };
r.plain = await blocked("");
r.on = await blocked("?ios=1");
r.remembered = await blocked("");
r.off = await blocked("?ios=0");
r.offRemembered = await blocked("");
r.ok = r.iPhone && r.plain && !r.on && !r.remembered && r.off && r.offRemembered;
window.result = r;
