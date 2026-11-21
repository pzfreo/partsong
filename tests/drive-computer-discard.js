// A computer's browser puts an idle background tab to sleep (Chrome's Memory
// Saver); the read carries on when the tab is opened again. That isn't a
// memory problem, so it carries on at full speed: only a page closed on
// screen (or any page a phone closed) carries on in low memory.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seed = (resumes, images = []) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); const s = tx.objectStore("scores"); s.clear(); if (resumes != null) s.put({ id: "cut", title: "Cut off", created: 1, images, pages: images.map(() => null), pending: true, resumes }); tx.oncomplete = () => { q.result.close(); res(); }; }; });
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const page = await (await fetch("/icon-192.png")).blob();
// How the reader was started when the app opens on an unfinished read.
const open = async (ua, hidden) => {
  hidden ? localStorage.setItem("partsong-read-hidden", "1") : localStorage.removeItem("partsong-read-hidden");
  await seed(0, [page]);
  const f = document.createElement("iframe");
  f.src = "/index.html";
  document.body.append(f);
  const inits = [];
  const Reader = class { postMessage(m) { if (m.type === "init") inits.push(m); } terminate() {} };
  const stub = setInterval(() => { try { const w = f.contentWindow; w.Worker = Reader; Object.defineProperty(w.navigator, "userAgent", { get: () => ua, configurable: true }); Object.defineProperty(w.navigator, "maxTouchPoints", { get: () => 0, configurable: true }); } catch {} }, 1);
  await sleep(4000);
  clearInterval(stub);
  const kind = f.contentDocument.getElementById("header-version") && f.contentWindow.navigator.userAgent === ua;
  f.remove();
  const last = inits.at(-1);
  return { uaSet: kind, lowMemory: last ? !!(last.noGpu && last.exact) : null };
};
const r = {};
r.windowsBackground = await open(WINDOWS, true);
r.windowsOnScreen = await open(WINDOWS, false);
r.iPhoneBackground = await open(IPHONE, true);
localStorage.removeItem("partsong-read-hidden");
r.ok = r.windowsBackground.lowMemory === false && r.windowsOnScreen.lowMemory === true && r.iPhoneBackground.lowMemory === true;
window.result = r;
