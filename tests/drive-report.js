// Report a problem: the score goes up to the share relay (encrypted, as a link)
// and an email to bugs@partsong.app opens with the description, the link and
// the technical details; nothing to attach or address. Unticking Include the
// score sends the report without it. From home, no upload.
// After a slow upload the email opens on the next tap (Send email). If the
// upload fails: try again, or untick the score. Technical details expand; Back, ✕ and tapping outside close it.
// Needs the relay running locally: in relay/,
//   npx wrangler dev --port 8787 --var "ORIGINS:http://localhost:8765"
// then run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label + " | status: " + document.getElementById("report-status").textContent); };
const $ = (id) => document.getElementById(id);
const setPhone = (on) => Object.defineProperty(navigator, "userAgentData", { value: { mobile: on }, configurable: true });
const setActive = (on) => Object.defineProperty(navigator, "userActivation", { value: { isActive: on }, configurable: true });
localStorage.setItem("partsong.relay", "http://localhost:8787");
setActive(true); // a script's clicks aren't taps: say the tap is still fresh (see "A slow upload")
const { entryFromRelay } = await import("/share.js");
const pages = [await (await fetch("/testdata/huron_0.musicxml")).text()];
const images = [await (await fetch("/testdata/huron_0.png")).blob()];
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "h", title: "Huron", created: 1, pages, images, mine: 2 }); tx.oncomplete = res; }; });
// Neither a download nor a mailto: link goes anywhere (a mailto: would open
// this machine's mail app with a test report to bugs@partsong.app).
let mailto = null, downloaded = null;
const origClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () { if (this.download) downloaded = this.download; else if (this.href.startsWith("mailto:")) mailto = this.href; else origClick.call(this); };
let shared = null;
navigator.canShare = () => true;
navigator.share = async (d) => { shared = d; };
const mail = () => { const u = new URL(mailto); const body = u.searchParams.get("body"); return { to: u.pathname, subject: u.searchParams.get("subject"), body, link: /#(s=[\w-]+\.[\w-]+)/.exec(body)?.[1] ?? null }; };

$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await sleep(500);
$("from-bar").value = 7; $("from-bar").onchange();
const openFromSettings = async () => {
  if ($("panel").hidden) { $("settings").click(); await sleep(300); }
  document.querySelector("#panel .report-open").click(); await sleep(200);
};
const steps = () => [...$("report-steps").children].map((li) => li.textContent);
const r = {};

// Phone with a score: uploaded, and the email opens with the link.
setPhone(true);
await openFromSettings();
r.buttons = [...$("report").querySelectorAll("button")].filter((b) => !b.hidden).map((b) => b.id); // send + ✕
$("report").querySelector("summary").click(); await sleep(100);
r.detailsOpen = $("report").querySelector("details").open && !$("report").hidden;
$("report").querySelector("details").open = false;
r.phone = { button: $("report-share").textContent, steps: steps() };
$("report-text").value = "Altos get the soprano run in bar 20";
await shot(false);
$("report-share").click();
await waitFor(() => mailto, 30000, "mailto");
const m = mail();
const got = await entryFromRelay(m.link);
r.phone.mail = { to: m.to, subject: m.subject, startsWithText: m.body.startsWith("Altos get"), hasDetails: m.body.includes("Position: Bar 7"), link: !!m.link, status: $("report-status").textContent };
r.phone.uploaded = { title: got.title, pages: got.pages.length, photos: got.images.length, mine: got.mine };
await shot(false);
$("report-close").click(); await sleep(300);
r.closeX = $("report").hidden && !$("practice").hidden;

// A slow upload (the tap has expired): the next tap opens the email.
mailto = null;
setActive(false);
await openFromSettings();
$("report-share").click();
await waitFor(() => $("report-share").textContent === "Send email", 30000, "ready");
r.slow = { mailtoBeforeTap: mailto, status: $("report-status").textContent };
$("report-share").click();
r.slow.opened = !!mailto;
// Changing the description makes a new email.
$("report-text").value += " (and bar 21)";
$("report-text").dispatchEvent(new Event("input"));
r.slow.resetOnEdit = $("report-share").textContent === "Send report with score";
setActive(true);
$("report-close").click(); await sleep(300);

// Without the score: untick it, and the email goes without a link.
mailto = null;
await openFromSettings();
r.untick = { shown: !$("report-include-row").hidden, label: $("report-include-row").textContent.trim(), ticked: $("report-include").checked };
$("report-include").click();
r.untick.button = $("report-share").textContent;
r.untick.step = steps()[1];
await shot(false);
$("report-share").click();
await waitFor(() => mailto, 10000, "mailto without score");
r.untick.link = mail().link;
$("report-close").click(); await sleep(300);
await openFromSettings();
r.untick.tickedAgainNextTime = $("report-include").checked && $("report-share").textContent === "Send report with score";
$("report-close").click(); await sleep(300);

// The upload fails: try again, or untick the score. No share sheet, no email.
localStorage.setItem("partsong.relay", "http://localhost:9");
shared = null; mailto = null;
await openFromSettings();
$("report-share").click();
r.failed = { status: await waitFor(() => /Couldn't upload/.test($("report-status").textContent) && $("report-status").textContent, 30000, "failed") };
r.failed.shared = shared; r.failed.mailto = mailto;
$("report-close").click(); await sleep(300);
localStorage.setItem("partsong.relay", "http://localhost:8787");

// Desktop with a score: the same email, nothing downloaded.
setPhone(false);
mailto = null;
await openFromSettings();
r.desktop = { steps: steps() };
$("report-share").click();
await waitFor(() => mailto, 30000, "desktop mailto");
r.desktop.result = { link: !!mail().link, downloaded, to: mail().to };
$("report").dispatchEvent(new MouseEvent("click", { bubbles: true })); await sleep(300);
r.tapOutsideCloses = $("report").hidden;

// From home: text only, no upload.
$("panel-close").click(); await sleep(400);
$("back").click(); await sleep(500);
r.wentHome = !$("home").hidden;
setPhone(true);
mailto = null;
document.querySelector("#home .report-open").click(); await sleep(200);
r.home = { button: $("report-share").textContent, steps: steps(), includeShown: !$("report-include-row").hidden };
$("report-share").click();
await waitFor(() => mailto, 10000, "home mailto");
r.home.link = mail().link;
history.back(); await sleep(300);
r.backCloses = $("report").hidden && !$("home").hidden;
HTMLAnchorElement.prototype.click = origClick;

r.ok = r.buttons.join() === "report-close,report-share" && r.detailsOpen && r.phone.button === "Send report with score" &&
  r.phone.mail.to === "bugs@partsong.app" && r.phone.mail.subject === "Partsong problem: Altos get the soprano run in bar 20" &&
  r.phone.mail.startsWithText && r.phone.mail.hasDetails && r.phone.mail.link &&
  r.phone.uploaded.title === "Huron" && r.phone.uploaded.pages === 1 && r.phone.uploaded.photos === 1 && r.phone.uploaded.mine === 2 &&
  r.closeX &&
  r.slow.mailtoBeforeTap === null && r.slow.opened && r.slow.resetOnEdit &&
  r.untick.shown && r.untick.label === "Include the score" && r.untick.ticked && r.untick.button === "Send report" &&
  r.untick.step === "Tap Send report: an email to bugs@partsong.app opens." && r.untick.link === null && r.untick.tickedAgainNextTime &&
  r.failed.status === "Couldn't upload the score (couldn't reach the link service). Try again, or untick Include the score to send the report without it." && r.failed.shared === null && r.failed.mailto === null &&
  r.desktop.result.link && r.desktop.result.downloaded === null && r.tapOutsideCloses &&
  r.wentHome && r.home.button === "Send report" && !r.home.includeShown && r.home.link === null && r.backCloses;
window.result = r;
