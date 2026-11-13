// A scan where the reader finds no music ("doesn't look like sheet music"):
// counted as read-no-music with where the page came from (camera, photo,
// PDF), its size, how many systems were found and how many scores this
// device has read before. A device that has read a score before is asked,
// politely, whether it's sheet music and they'd send it: Send it to us opens
// the report with the page attached; No thanks puts the question away.
//   CHROME_FLAGS="--mute-audio --host-resolver-rules=MAP gc.zgo.at ~NOTFOUND" \
//     node scripts/headless-test.mjs http://localhost:8765/index.html out.json 240 tests/drive-no-music.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const events = [];
window.goatcounter = { count: (e) => events.push(e.path) };
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").clear(); tx.oncomplete = res; }; });
localStorage.setItem("partsong-reads", "0"); // never read a score (yet)
// A page with no music: a photo of plain paper with a line of "text".
const c = Object.assign(document.createElement("canvas"), { width: 1500, height: 2000 });
const g = c.getContext("2d");
g.fillStyle = "#f4f1ea"; g.fillRect(0, 0, c.width, c.height);
g.fillStyle = "#333"; g.font = "48px serif";
for (let y = 200; y < 1800; y += 90) g.fillText("Words only, no music on this page at all.", 120, y);
const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
const pick = (input) => { const dt = new DataTransfer(); dt.items.add(new File([blob], "words.jpg", { type: "image/jpeg" })); input.files = dt.files; input.dispatchEvent(new Event("change")); };
location.hash = ""; $("new-scan").click(); await sleep(500);
pick($("camera"));
await waitFor(() => !$("recognise").disabled, 10000, "page added");
const r = { hiddenBefore: $("no-music-send").hidden };
const read = async () => {
  $("status").textContent = "";
  $("recognise").click();
  const status = await waitFor(() => /doesn't look like sheet music/.test($("status").textContent) && $("status").textContent, 180000, "no-music message");
  await sleep(1500); // the count waits for the page's size
  return status;
};
// Never read a score: counted, but not asked.
await read();
r.newcomerAsked = !$("no-music-send").hidden;
// Has read two: asked.
localStorage.setItem("partsong-reads", "2");
r.status = await read();
r.sendShown = !$("no-music-send").hidden;
r.counted = events.filter((p) => p.startsWith("read-no-music"));

// Send it to us: the report, with the page.
let shared = null;
Object.defineProperty(navigator, "userAgentData", { value: { mobile: true }, configurable: true });
navigator.canShare = () => true;
navigator.share = async (d) => { shared = d; };
r.ask = $("no-music-send").textContent.replace(/\s+/g, " ").trim();
$("no-music-yes").click();
await sleep(300);
r.report = { open: !$("report").hidden, button: $("report-share").textContent, text: $("report-text").value };
$("report-share").click();
await waitFor(() => shared, 10000, "shared");
r.sent = { files: shared.files.map((f) => `${f.name} ${f.type} ${f.size > 1000}`), mentionsAddress: shared.text.includes("bugs@partsong.app") };
r.reportCounted = events.filter((p) => /^(report|no-music-ask)/.test(p));
$("report-close").click(); await sleep(200);

// Adding another page hides the offer (the scan has changed).
pick($("gallery"));
await waitFor(() => $("pages").children.length === 2, 10000, "second page");
r.hiddenAfterChange = $("no-music-send").hidden;
// Read again (both pages have no music): asked again; No thanks puts it away.
await read();
r.askedAgain = !$("no-music-send").hidden;
$("no-music-no").click();
r.noThanks = { hidden: $("no-music-send").hidden, counted: events.includes("no-music-ask: no thanks") };

r.ok = r.hiddenBefore && !r.newcomerAsked && r.sendShown &&
  JSON.stringify(r.counted.slice(0, 2)) === JSON.stringify(["read-no-music (iPad dev): camera, 3 MP, 0 systems, reads before 0", "read-no-music (iPad dev): camera, 3 MP, 0 systems, reads before 2"]) &&
  r.report.open && r.report.button === "Share report with the page" && /isn't sheet music, but it is/.test(r.report.text) &&
  JSON.stringify(r.sent.files) === JSON.stringify(["page-1.jpg image/jpeg true"]) && r.sent.mentionsAddress &&
  ["no-music-ask: shown", "no-music-ask: send", "report", "report-with-pages"].every((p) => r.reportCounted.includes(p)) && r.hiddenAfterChange &&
  r.askedAgain && r.noThanks.hidden && r.noThanks.counted;
window.result = r;
