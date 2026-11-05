// Opens a page in headless Chrome, streams its console, and waits until
// `window.result` is set (or times out). Writes the result JSON to argv[3].
// Usage: node scripts/headless-test.mjs <url> <out.json> [timeoutSec] [drive.js] [screenshot-prefix]
// drive.js (optional) is evaluated in the page after load; it may call
// `await shot()` to request a screenshot and must set window.result.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, timeoutSec = "900", driveFile, shotPrefix] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = +(process.env.CDP_PORT || 9333);
// CDP_HOST: drive a browser already running there (e.g. Edge in a Windows VM,
// started with --remote-debugging-port) instead of starting Chrome here.
const host = process.env.CDP_HOST || "127.0.0.1";
const chrome = process.env.CDP_HOST ? null : spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "chrome-"))}`,
  "--enable-unsafe-webgpu",
  "--autoplay-policy=no-user-gesture-required",
  ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(/\s+(?=--)/) : []),
  "about:blank",
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    const tabs = await (await fetch(`http://${host}:${port}/json`)).json();
    wsUrl = tabs.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const t0 = Date.now();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result);
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = msg.params.args.map((a) => a.value ?? a.description).join(" ");
    if (text.startsWith("__EXEC__ ")) {
      spawn("sh", ["-c", text.slice(9)]).on("exit", (code) => console.log("exec exit", code));
      return;
    }
    // A real touch tap (through Chrome's input pipeline, unlike a synthetic
    // click): touchTap(x, y) in the page.
    if (text.startsWith("__TAP__ ")) {
      const [x, y] = text.slice(8).split(" ").map(Number);
      (async () => {
        await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        await sleep(60);
        await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        send("Runtime.evaluate", { expression: "window.__tapDone?.()" });
      })();
      return;
    }
    if (text === "__SHOT__" || text === "__SHOTVIEW__") {
      send("Page.captureScreenshot", { format: "png", captureBeyondViewport: text === "__SHOT__" }).then((r) => {
        const file = `${shotPrefix}-${++shots}.png`;
        writeFileSync(file, Buffer.from(r.data, "base64"));
        console.log("screenshot", file);
        send("Runtime.evaluate", { expression: "window.__shotDone()" });
      });
      return;
    }
    console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, text.slice(0, 400));
  }
  if (msg.method === "Runtime.exceptionThrown") console.log("EXCEPTION", JSON.stringify(msg.params.exceptionDetails).slice(0, 800));
};
await send("Runtime.enable");
await send("Page.enable");
// DESKTOP=1: a desktop-sized window without touch, as on a computer.
if (process.env.DESKTOP) await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 911, deviceScaleFactor: 1, mobile: false });
else {
  await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
}
// CPU_THROTTLE=4 slows the page down to roughly phone speed.
if (process.env.USER_AGENT) await send("Emulation.setUserAgentOverride", { userAgent: process.env.USER_AGENT });
if (process.env.CPU_THROTTLE) await send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CPU_THROTTLE) });
const nav = await send("Page.navigate", { url });
console.log("navigated", JSON.stringify(nav));
let shots = 0;
if (driveFile) {
  await sleep(1500);
  const { readFileSync } = await import("node:fs");
  const code = readFileSync(driveFile, "utf8");
  send("Runtime.evaluate", {
    // Reading stops at the systems check until Read music there is tapped:
    // tap it, unless the drive checks the systems itself (window.manualCheck).
    expression: `setInterval(() => { if (window.manualCheck) return; for (const d of [document, ...[...document.querySelectorAll("iframe")].map((f) => { try { return f.contentDocument; } catch {} })]) { const b = d?.getElementById("check-done"); if (b && !d.getElementById("systems-check").hidden) b.click(); } }, 500); window.touchTap = (x, y) => new Promise(r => { window.__tapDone = r; console.log("__TAP__ " + x + " " + y); }); window.shot = (full = true) => new Promise(r => { window.__shotDone = r; console.log(full ? "__SHOT__" : "__SHOTVIEW__"); }); (async () => { ${code} })().catch(e => { window.result = { error: String(e.stack || e) }; });`,
  });
}

const deadline = Date.now() + Number(timeoutSec) * 1000;
let result = null;
while (Date.now() < deadline) {
  await sleep(2000);
  const r = await send("Runtime.evaluate", { expression: "JSON.stringify(window.result ?? null)", returnByValue: true });
  if (r?.result?.value && r.result.value !== "null") {
    result = r.result.value;
    break;
  }
}
if (result) writeFileSync(out, result);
console.log(result ? `DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}` : "TIMEOUT");
ws.close();
chrome?.kill();
process.exit(result ? 0 : 1);
