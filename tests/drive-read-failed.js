// A reading that fails counts "read-failed" and "read-failed: <why>", where the
// reason is the error's last line (no file paths, numbers as N) and never the
// score's name. Reads a blank page (no staves). Run against http://localhost:8765/index.html.
const events = []; window.goatcounter = { count: (e) => events.push(e) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
$("new-scan").click();
await waitFor(() => !$("scan").hidden, 10000, "scan screen");
$("scan-name").value = "Secret title";
const canvas = Object.assign(document.createElement("canvas"), { width: 1200, height: 1600 });
const ctx = canvas.getContext("2d");
ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1200, 1600);
ctx.fillStyle = "black"; ctx.font = "40px sans-serif"; ctx.fillText("Not music", 400, 800);
const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
const dt = new DataTransfer(); dt.items.add(new File([blob], "blank.png", { type: "image/png" }));
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
await waitFor(() => !$("recognise").disabled, 20000, "page added");
$("recognise").click();
await waitFor(() => events.some((e) => e.path.startsWith("read-failed:")), 600000, "read-failed");
window.result = {
  paths: events.map((e) => e.path),
  leaksTitle: JSON.stringify(events).includes("Secret title"),
};
