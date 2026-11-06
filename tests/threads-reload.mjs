// First visit: the page isn't cross-origin isolated yet, so the reader would
// run on one thread. Read music reloads once (the service worker then makes the
// page isolated) and the read carries on by itself, on several threads.
// Usage: node tests/threads-reload.mjs [url]  (default http://127.0.0.1:8765/index.html;
// 127.0.0.1, not localhost, so the service worker runs). Prints JSON.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://127.0.0.1:8765/index.html";
const port = 9333;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--mute-audio", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "chrome-"))}`,
  "--enable-unsafe-webgpu", "--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND", "about:blank",
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
let loads = 0;
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id) pending.get(m.id)?.(m.result);
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Page.loadEventFired") loads++;
};
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
const waitFor = async (expr, ms, label) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ev(expr).catch(() => false)) return; await sleep(500); }
  throw new Error("timeout waiting for " + label);
};
const r = {};
try {
  await send("Runtime.enable");
  await send("Page.enable");
  // Counts on every load (GoatCounter itself is blocked), kept across the reload.
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.goatcounter = { count: (e) => { const k = "test-events"; sessionStorage.setItem(k, JSON.stringify([...JSON.parse(sessionStorage.getItem(k) || "[]"), e.path])); } };` });
  await send("Page.navigate", { url });
  await waitFor("!!navigator.serviceWorker.controller && document.readyState === 'complete'", 30000, "service worker");
  r.firstLoad = { isolated: await ev("self.crossOriginIsolated") };
  // An older unfinished scan whose id sorts first: the reload must carry on
  // with the scan that was tapped, not this one.
  await ev(`new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "00000000-old", title: "Older unfinished", created: 1, images: [new Blob(["x"], { type: "image/png" })], pages: [null], pending: true, resumes: 0 }); tx.oncomplete = res; }; })`);
  await sleep(500);
  await ev(`document.querySelector("#library-empty .try-sample").click()`);
  await waitFor(`document.querySelectorAll("#pages img").length === 3 && !document.getElementById("recognise").disabled`, 30000, "sample pages");
  const before = loads;
  await ev(`document.getElementById("recognise").click()`);
  const end = Date.now() + 20000;
  while (loads === before && Date.now() < end) await sleep(300);
  r.reloaded = loads > before;
  // Step 2 (check the systems) waits for its Read music button.
  await waitFor(`(() => { const b = document.getElementById("check-done"); if (b && !b.hidden && !document.getElementById("systems-check").hidden) b.click(); return !document.getElementById("practice").hidden; })()`, 900000, "read after reload");
  r.after = await ev(`({ isolated: self.crossOriginIsolated, bars: document.getElementById("to-bar").value, title: document.getElementById("title").value })`);
  r.threads = logs.filter((l) => l.includes("WASM threads")).map((l) => l.replace(/^.*WASM threads: /, ""));
  r.events = (await ev(`JSON.parse(sessionStorage.getItem("test-events") || "[]")`)).filter((e) => /^read-/.test(e));
  r.library = await ev(`new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result.map((e) => ({ title: e.title, pending: !!e.pending, resumes: e.resumes ?? 0 }))); }; })`);
  r.flag = await ev(`sessionStorage.getItem("partsong-threads-reload")`);
} catch (e) {
  r.error = String(e.message);
}
r.ok = r.reloaded && r.after?.isolated && r.after.title === "If ye love me (sample)" && r.threads?.at(-1) !== "1"
  && r.events?.some((e) => e.startsWith("read-reloaded-for-threads")) && !r.events?.some((e) => e.startsWith("read-restarted"))
  && r.library?.some((e) => e.title === "Older unfinished" && e.pending && e.resumes === 0);
console.log(JSON.stringify(r));
chrome.kill();
process.exit(r.ok ? 0 : 1);
