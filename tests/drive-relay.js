// Sharing by link through the relay, and falling back to the PDF alone.
// Needs the relay running locally: in relay/,
//   npx wrangler dev --port 8787 --var "ORIGINS:http://localhost:8765"
// then run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const idb = (mode, fn) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out?.result ?? out); }; });
const pages = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
await idb("readwrite", (s) => s.put({ id: "rel-1", title: "Relay test", created: 5, pages, images, manual: { 1: 2 }, octave: -1, tempo: 80 }));
localStorage.setItem("partsong.relay", "http://localhost:8787");
const r = {};

// Share on a phone: capture what the share sheet would get.
let shared;
Object.defineProperty(navigator, "userAgentData", { value: { mobile: true }, configurable: true });
navigator.canShare = () => true;
navigator.share = async (data) => { shared = data; };
const share = async (button = "share", statusId = "share-status") => {
  shared = null;
  $("new-scan").click(); history.back(); await sleep(400);
  await waitFor(() => document.querySelector('#library li[data-id="rel-1"] button'), 5000, "library").then((b) => b.click());
  await sleep(500);
  $("settings").click(); await sleep(300);
  $(button).click();
  await waitFor(() => shared, 90000, "share");
  return { status: await waitFor(() => $(statusId).textContent, 5000, "status"), shared };
};
// A share link (#s=...) in the PDF; its last page also links to the app itself.
const pdfHasLink = async (file) => (await file.text()).includes("#s=");
// No link could be made: the reason, with Try again and Send as a PDF instead.
const sendPdf = async (statusId) => {
  const b = await waitFor(() => [...$(statusId).querySelectorAll("button")].find((x) => x.textContent === "Send as a PDF instead"), 90000, "PDF choice");
  const offered = $(statusId).textContent;
  b.click();
  return offered;
};

// 1. Relay up: just the link (WhatsApp drops text that comes with a file).
let s = await share();
const link = s.shared.text?.match(/https?:\S+#s=\S+/)?.[0];
r.relayUp = { status: s.status, text: s.shared.text?.replace(/#s=\S+/, "#s=…"), files: s.shared.files?.length ?? 0 };
// Share part with score in settings: the same link share, and since nothing
// has changed, the same link again, at once (no "Preparing…").
const sameAgain = async () => {
  shared = null;
  $("settings").click(); await sleep(300);
  const ready = $("share-score").classList.contains("ready");
  $("share-score").click();
  await sleep(50);
  const label = $("share-score").textContent;
  await waitFor(() => shared, 30000, "share again");
  $("panel-close").click(); await sleep(200);
  return { ready, labelJustAfterTap: label, link: shared.text?.match(/#s=\S+/)?.[0] };
};
s = await share("share-score", "share-score");
r.settingsButton = { status: s.status, isLink: /#s=/.test(s.shared.text ?? ""), files: s.shared.files?.length ?? 0 };
const again = await sameAgain();
r.unchangedReuses = { ready: again.ready, labelJustAfterTap: again.labelJustAfterTap, sameLink: again.link === link.match(/#s=\S+/)[0] };
// A change (tempo) means a new link, and the button isn't ready.
$("settings").click(); await sleep(300);
$("tempo").value = 90; $("tempo").dispatchEvent(new Event("input", { bubbles: true })); $("tempo").dispatchEvent(new Event("change", { bubbles: true })); await sleep(600);
r.changedNotReady = !$("share-score").classList.contains("ready");
$("panel-close").click(); await sleep(200);
s = await share("share-score", "share-score");
r.changedNewLink = !!s.shared.text && !s.shared.text.includes(link.match(/#s=\S+/)[0]);

// 2. The link opened elsewhere: the whole score is offered and added.
const frame = (src) => { const f = document.createElement("iframe"); f.src = src; document.body.append(f); return f; };
const offerIn = (f, label) => waitFor(() => !f.contentDocument.getElementById("import-offer").hidden && f.contentDocument.getElementById("import-question").textContent, 20000, label);
const before = (await idb("readonly", (st) => st.getAll())).length;
let f = frame(link);
r.linkOffer = await offerIn(f, "link offer");
f.contentDocument.getElementById("import-yes").click();
await waitFor(async () => (await idb("readonly", (st) => st.getAll())).length === before + 1, 10000, "added");
const got = (await idb("readonly", (st) => st.getAll())).find((e) => e.title === "Relay test (2)");
r.viaLink = { images: got.images.length, pages: got.pages.length, manual: got.manual, octave: got.octave, tempo: got.tempo };

// 3. Tapped while Partsong is already open: only the fragment changes.
f = frame("/index.html");
await waitFor(() => f.contentDocument?.getElementById("library"), 10000, "app open");
await sleep(1000);
f.contentWindow.location.hash = link.split("#")[1];
r.whileOpenOffer = await offerIn(f, "offer while open");

// 4. An unknown or expired link: says where the full score is.
f = frame(link.replace(/#s=[\w-]{22}/, "#s=ZZZZZZZZZZZZZZZZZZZZZZ"));
r.expiredNotice = await offerIn(f, "expired notice");

// 5. Relay down when sharing: nothing is sent; it says why and offers Try
// again or the PDF, and the PDF has no share link.
localStorage.setItem("partsong.relay", "http://localhost:9");
// (A change first, or the kept link would be shared without uploading.)
$("settings").click(); await sleep(300);
$("tempo").value = 100; $("tempo").dispatchEvent(new Event("input", { bubbles: true })); $("tempo").dispatchEvent(new Event("change", { bubbles: true })); await sleep(600);
$("panel-close").click(); await sleep(200);
shared = null;
$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector('#library li[data-id="rel-1"] button'), 5000, "library").then((b) => b.click());
await sleep(500);
$("share").click();
const offered = await sendPdf("share-status");
await waitFor(() => shared, 30000, "PDF shared");
r.relayDown = { offered, status: await waitFor(() => $("share-status").textContent, 5000, "status"), text: shared.text ?? null, file: shared.files[0].name, pdfHasLink: await pdfHasLink(shared.files[0]) };

// 6. The same on a computer, from Send a link in the panel: the reason and
// the choice under the button; the PDF is downloaded.
Object.defineProperty(navigator, "userAgentData", { value: { mobile: false }, configurable: true });
let downloaded = null;
const click = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () { if (this.download) downloaded = this.download; else click.call(this); };
$("settings").click(); await sleep(300);
$("tempo").value = 110; $("tempo").dispatchEvent(new Event("input", { bubbles: true })); $("tempo").dispatchEvent(new Event("change", { bubbles: true })); await sleep(600);
$("share-score").click();
const offeredDesktop = await sendPdf("panel-share-status");
await waitFor(() => downloaded, 30000, "desktop download");
await sleep(100);
r.desktopRelayDown = { downloaded, offered: offeredDesktop, label: $("share-score").textContent, says: $("panel-share-status").textContent };
HTMLAnchorElement.prototype.click = click;

// 7. Try again once the relay is back: the link is shared.
Object.defineProperty(navigator, "userAgentData", { value: { mobile: true }, configurable: true });
$("tempo").value = 120; $("tempo").dispatchEvent(new Event("input", { bubbles: true })); $("tempo").dispatchEvent(new Event("change", { bubbles: true })); await sleep(600);
$("panel-close").click(); await sleep(200);
shared = null;
$("share").click();
const retry = await waitFor(() => [...$("share-status").querySelectorAll("button")].find((x) => x.textContent === "Try again"), 90000, "Try again");
localStorage.setItem("partsong.relay", "http://localhost:8787");
retry.click();
await waitFor(() => shared, 90000, "link shared");
r.tryAgain = { isLink: /#s=/.test(shared.text ?? ""), files: shared.files?.length ?? 0 };
localStorage.removeItem("partsong.relay");
window.result = r;
