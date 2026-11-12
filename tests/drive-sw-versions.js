// The service worker never mixes versions: on a slow connection a versioned
// file (?v=…, the app's scripts and the music reader) comes from the cache
// only at that same version; a newer version waits for the network (an old
// cached music reader once ran with a new app). Needs the hanging server:
// python3 scripts/hang-server.py 8766, then run against
// http://127.0.0.1:8766/index.html (the service worker is skipped on localhost).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const file = "/testdata/sw-version.txt";
const put = async (text) => { console.log(`__EXEC__ printf ${text} > testdata/sw-version.txt`); await sleep(500); };
const get = (v, ms) => Promise.race([fetch(`${file}?v=${v}`).then((r) => r.text()), sleep(ms).then(() => "(still waiting)")]);
const r = {};
await waitFor(() => navigator.serviceWorker.controller, 30000, "service worker");
await put("one");
r.v1Online = await get(1, 5000);
await put("two");
await fetch("/__hang?on");
r.v1Slow = await get(1, 8000); // its own version, from the cache: quick
r.v2Slow = await get(2, 8000); // a new version: not the old copy
await fetch("/__hang?off");
r.v2Later = await get(2, 40000);
// Old versions and update checks aren't kept: once v2 has arrived, v1's copy
// is gone, and a ?check=… fetch (the app's update check) leaves no copy of
// its own (and doesn't take the current version's).
await sleep(500);
const kept = async () => (await (await caches.open("partscanner-shell-v1")).keys()).map((k) => new URL(k.url)).filter((u) => u.pathname === file).map((u) => u.search).sort();
r.keptAfterV2 = await kept();
for (let i = 0; i < 3; i++) await fetch(`${file}?check=${Date.now() + i}`).then((x) => x.text());
await sleep(500);
r.keptAfterChecks = await kept();
r.ok = r.v1Online === "one" && r.v1Slow === "one" && r.v2Slow !== "one" && r.v2Later === "two" &&
  JSON.stringify(r.keptAfterV2) === JSON.stringify(["", "?v=2"]) && JSON.stringify(r.keptAfterChecks) === JSON.stringify(["", "?v=2"]);
window.result = r;
