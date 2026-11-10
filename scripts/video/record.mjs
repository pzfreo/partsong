// Records a drive of the app as frames: node record.mjs <url> <drive.js> <outDir>
// The drive calls rec(true|false) to start/pause recording, and sets window.result when done.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [url, driveFile, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--remote-debugging-port=9344", `--user-data-dir=${mkdtempSync(join(tmpdir(), "chrome-"))}`,
  "--enable-unsafe-webgpu", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--mute-audio", "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch("http://127.0.0.1:9344/json")).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {} }
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
let nextId = 1; const pending = new Map();
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const marks = {};
let recording = false, n = 0, last = null; const frames = []; const t0 = Date.now();
// Time only runs while recording: paused stretches are cut.
let clock = 0, since = null;
const now = () => clock + (recording && since ? (Date.now() - since) / 1000 : 0);
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result);
  if (msg.method === "Page.screencastFrame") {
    send("Page.screencastFrameAck", { sessionId: msg.params.sessionId });
    if (!recording) return;
    const file = `f${String(++n).padStart(5, "0")}.jpg`;
    writeFileSync(join(outDir, file), Buffer.from(msg.params.data, "base64"));
    frames.push({ file, t: now() });
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = msg.params.args.map((a) => a.value ?? a.description).join(" ");
    if (text.startsWith("__MARK__ ")) { marks[text.slice(9)] = now(); return; }
    if (text === "__REC__ on") { recording = true; since = Date.now(); return; }
    if (text === "__REC__ off") { clock = now(); recording = false; since = null; return; }
    console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, text.slice(0, 200));
  }
  if (msg.method === "Runtime.exceptionThrown") console.log("EXCEPTION", JSON.stringify(msg.params.exceptionDetails).slice(0, 600));
};
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36" });
await send("Page.navigate", { url });
await sleep(1500);
await send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
send("Runtime.evaluate", { expression: `window.rec = (on) => console.log(on ? "__REC__ on" : "__REC__ off"); (async () => { ${readFileSync(driveFile, "utf8")} })().catch(e => { window.result = { error: String(e.stack || e) }; });` });
let result = null;
for (const end = Date.now() + 900000; Date.now() < end && !result; ) {
  await sleep(1000);
  const r = await send("Runtime.evaluate", { expression: "JSON.stringify(window.result ?? null)", returnByValue: true });
  if (r?.result?.value && r.result.value !== "null") result = r.result.value;
}
clock = now();
writeFileSync(join(outDir, "frames.json"), JSON.stringify({ frames, end: clock, marks }));
const len = (await send("Runtime.evaluate", { expression: "window.audioB64?.length ?? 0", returnByValue: true })).result.value;
if (len) {
  let b64 = "";
  for (let i = 0; i < len; i += 1e6) b64 += (await send("Runtime.evaluate", { expression: `window.audioB64.slice(${i}, ${i + 1e6})`, returnByValue: true })).result.value;
  writeFileSync(join(outDir, "audio.bin"), Buffer.from(b64, "base64"));
}
console.log(result ?? "TIMEOUT", `${frames.length} frames, ${clock.toFixed(1)} s`);
ws.close(); chrome.kill(); process.exit(0);
