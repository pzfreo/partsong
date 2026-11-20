// The problem log: an uncaught error and a failed read each send one record
// to the relay's POST /log, with where it happened and the reader's last
// messages, never a score or a page; the same error again sends nothing.
// Needs the relay running locally: in relay/,
//   npx wrangler d1 execute partsong-log --local --file schema.sql
//   npx wrangler dev --port 8787 --var "ORIGINS:http://localhost:8765"
// then run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
localStorage.setItem("partsong.relay", "http://localhost:8787");
const sent = [];
const realFetch = window.fetch;
window.fetch = async (url, init) => {
  const res = await realFetch(url, init);
  if (String(url).endsWith("/log")) sent.push({ status: res.status, record: JSON.parse(init.body) });
  return res;
};
await sleep(500);
// An uncaught error from the app's own code (the lock switch with no score open), twice.
$("lock").dispatchEvent(new Event("change")); await sleep(300);
$("lock").dispatchEvent(new Event("change")); await sleep(700);
// A page with no music: plain paper with lines of words.
const c = Object.assign(document.createElement("canvas"), { width: 1500, height: 2000 });
const g = c.getContext("2d");
g.fillStyle = "#f4f1ea"; g.fillRect(0, 0, c.width, c.height);
g.fillStyle = "#333"; g.font = "48px serif";
for (let y = 200; y < 1800; y += 90) g.fillText("Words only, no music on this page at all.", 120, y);
const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
$("new-scan").click(); await sleep(500);
$("scan-name").value = "A private title";
const dt = new DataTransfer(); dt.items.add(new File([blob], "words.jpg", { type: "image/jpeg" }));
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
await waitFor(() => !$("recognise").disabled, 10000, "page added");
$("recognise").click();
await waitFor(() => /doesn't look like sheet music/.test($("status").textContent), 180000, "no-music message");
await sleep(1500);
window.fetch = realFetch;
const errors = sent.filter((s) => s.record.kind === "error");
const noMusic = sent.find((s) => s.record.kind === "no-music")?.record;
const all = JSON.stringify(sent);
window.result = {
  sent: sent.map((s) => ({ status: s.status, kind: s.record.kind, stage: s.record.stage, message: s.record.message.slice(0, 80), place: (s.record.place ?? "").slice(0, 90), detail: s.record.detail, readerLines: s.record.reader.split("\n").filter(Boolean).length })),
  ok: errors.length === 1 && errors[0].status === 201 && /app\.js:\d+/.test(errors[0].record.place) &&
    !!noMusic && /^(finding systems|reading the notes), page 1 of 1$/.test(noMusic.stage) && noMusic.detail.seen?.staff != null && noMusic.detail.shape && noMusic.reader.includes("Seen on the page") &&
    new Set(sent.map((s) => s.record.visit)).size === 1 && !all.includes("A private title") && !all.includes("words.jpg"),
};
