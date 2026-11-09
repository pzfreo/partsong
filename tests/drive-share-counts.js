// Scores shared to this device are counted from arrival to first play: a file
// opened counts "receive: file" and "receive-added", its first play counts
// "play-received (<device>)" once (not on later plays, nor after reopening);
// a shared file declined counts "receive-cancelled"; a link the relay can't
// supply counts "receive-failed". GoatCounter is kept out so the stand-in counts:
//   CHROME_FLAGS="--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND" node scripts/headless-test.mjs \
//     http://localhost:8765/index.html out.json 120 tests/drive-share-counts.js
const share = await import("/share.js");
const events = [];
const stub = { count: (e) => events.push(e.path) };
setInterval(() => (window.goatcounter = stub), 20);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(150); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const since = (n) => events.slice(n);
const r = {};
try {
  const pages = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((x) => x.text())));
  const file = await share.scoreFile({ id: "shared-count", title: "Shared count", created: 1, pages, images: [] });

  // 1. Opened with Open file: added straight away, then played.
  let n = events.length;
  const input = $("open-xml");
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change"));
  await waitFor(() => !$("practice").hidden, 20000, "practice");
  await sleep(500);
  $("play").click(); await sleep(400); $("play").click(); await sleep(200);
  $("play").click(); await sleep(400); $("play").click(); await sleep(200);
  r.openFile = since(n);
  // Reopened from the library and played again: not counted again.
  n = events.length;
  $("back").click();
  await waitFor(() => document.querySelector("#library button"), 10000, "library");
  [...document.querySelectorAll("#library button")].find((b) => b.textContent.includes("Shared count")).click();
  await waitFor(() => !$("practice").hidden, 20000, "practice again");
  await sleep(500);
  $("play").click(); await sleep(400); $("play").click();
  r.reopened = since(n).filter((p) => p.startsWith("play-received"));

  // 2. Shared to the installed app (inbox) and declined.
  $("back").click(); await sleep(300);
  n = events.length;
  const inbox = await caches.open("partscanner-inbox");
  await inbox.put(new Request("/inbox/1"), new Response(file, { headers: { "content-type": "application/pdf", "x-name": encodeURIComponent(file.name) } }));
  document.dispatchEvent(new Event("visibilitychange"));
  await waitFor(() => !$("import-offer").hidden, 10000, "offer");
  $("import-no").click();
  await sleep(300);
  r.declined = since(n);

  // 3. A link the relay can't supply (malformed, so nothing is fetched).
  n = events.length;
  location.hash = "#s=nothing";
  await waitFor(() => since(n).some((p) => p.startsWith("receive-failed")), 15000, "failure");
  r.badLink = since(n);
  $("import-no").click();
} catch (e) {
  r.error = String(e);
}
const one = (list, p) => list?.filter((x) => x === p).length === 1;
r.ok =
  one(r.openFile, "receive: file") && one(r.openFile, "receive-added") &&
  r.openFile.filter((p) => /^play-received \(\w+\)$/.test(p)).length === 1 &&
  r.reopened?.length === 0 &&
  one(r.declined, "receive: file") && one(r.declined, "receive-cancelled") && !r.declined.includes("receive-added") &&
  one(r.badLink, "receive: link") && r.badLink.some((p) => /^receive-failed \(\w+ \w+\): couldn't fetch$/.test(p));
window.result = r;
