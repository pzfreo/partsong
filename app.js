import { buildScore, parsePage, playOrder } from "./score.js";
import { Player } from "./player.js";
import { AUDIO_RATE, audioFile } from "./audio.js";
import * as db from "./db.js";
import { rotateBlob, uprightPhoto } from "./orient.js";
import { isPdf, pdfPages } from "./pdf-pages.js";
import { entryFromLink, entryFromRelay, isMobile, LINK_REUSE_MS, parseScoreFile, readScoreFile, scoreFile, shareableScore, shareFile, shareKey, shareLink } from "./share.js";

const $ = (id) => document.getElementById(id);

// Unexpected errors show briefly on screen, so a problem on the phone can be
// screenshotted rather than just looking like a freeze.
// Recent errors and reader log lines, for bug reports.
const recentErrors = [];
const readerLog = [];
// How the reader started (models loaded, which decoder build, threads, GPU
// fallbacks): kept apart so a long read doesn't push it out of the report.
const readerSetup = [];
const SETUP_LOG = /^(Loaded |WASM threads|WebGPU run failed|Relaxed SIMD|Tuned |Tuning |Exact encoder )/;
const remember = (list, item, max) => {
  list.push(`${new Date().toISOString().slice(11, 19)} ${item}`);
  if (list.length > max) list.shift();
};

// The kind of device, for counting errors by it (never anything finer).
// (iPadOS asks for desktop sites, so it looks like a Mac with a touch screen.)
const ua = navigator.userAgent;
const iDevice = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
// Apps' built-in browsers (Instagram, Facebook, Messenger) keep little storage
// and memory: the music reader is best downloaded in the phone's own browser.
const inAppBrowser = /Instagram|FBAN|FBAV|FB_IAB|Messenger/.test(ua);
const IN_APP_TIP = " This is Instagram's or Facebook's own browser: open partsong.app in Safari or Chrome instead (⋯ menu, Open in browser).";
const VERSION = new URL(import.meta.url).searchParams.get("v") || "dev";
// Deploys are numbered by how many commits main has (see pages.yml), so a
// newer version always has a bigger number.
const SHOWN_VERSION = /^\d+$/.test(VERSION) ? `v${VERSION}` : VERSION;
const deviceKind = /iPhone|iPod/.test(ua) ? "iPhone" : iDevice ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "other";
// Counts by device carry the version too, to see whether a fix worked.
const deviceTag = `${deviceKind} ${SHOWN_VERSION}`;

function showError(message) {
  remember(recentErrors, message, 10);
  // Counted once per kind of error a visit, as "error (Android): …".
  const reason = failureReason(message);
  showError.counted ??= new Set();
  if (!showError.counted.has(reason)) {
    showError.counted.add(reason);
    track(`error (${deviceTag})`);
    track(`error (${deviceTag}): ${reason}`);
  }
  const el = $("error-toast");
  el.textContent = `Something went wrong: ${message}`;
  el.hidden = false;
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => (el.hidden = true), 8000);
}
window.addEventListener("error", (e) => showError(e.message));
window.addEventListener("unhandledrejection", (e) => showError(e.reason?.message ?? String(e.reason)));
window.reportError ??= (e) => showError(e?.message ?? String(e));
const OSMD_URL = "lib/opensheetmusicdisplay@2.2.0/build/opensheetmusicdisplay.min.js"; // scripts/fetch-libs.sh
const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

// ---------- library (per-device, in IndexedDB; see db.js) ----------

const updateEntry = (id, changes) => db.update(id, changes).catch((e) => console.error("save failed", e));

// Object URLs for photos currently on screen, released when re-rendered.
const photoUrls = { library: [], practice: [] };
function photoUrl(group, blob) {
  const url = URL.createObjectURL(blob);
  photoUrls[group].push(url);
  return url;
}
function releasePhotos(group) {
  photoUrls[group].forEach((u) => URL.revokeObjectURL(u));
  photoUrls[group] = [];
}

// ---------- navigation ----------

const screens = ["home", "scan", "practice"];
// Each screen (and the open settings panel) is a history entry, so the phone's
// back button steps back through the app instead of leaving it.
// nav: "push" a new entry, "replace" the current one, or "none" (from popstate).
function show(name, nav = "push") {
  for (const s of screens) $(s).hidden = s !== name;
  $("back").hidden = name === "home";
  if (name !== "practice") {
    player?.stop();
    endMarkup(false);
    releasePhotos("practice");
    $("photo-list").replaceChildren();
    $("panel").hidden = $("panel-backdrop").hidden = true;
  }
  if (name === "home") renderLibrary();
  if (name !== "home" && nav === "push") history.pushState({ screen: name }, "");
  if (name !== "home" && nav === "replace") history.replaceState({ screen: name }, "");
  window.scrollTo(0, 0);
}

function goHome() {
  const depth = history.state?.panel || history.state?.markup ? 2 : history.state?.screen ? 1 : 0;
  if (depth) history.go(-depth);
  else show("home", "none");
}
$("back").onclick = goHome;

// Back/forward: make the screen match the history entry landed on (overlays,
// settings panel and mark-up mode are part of the entry), rather than closing
// things blindly, so they never get out of step with the history.
window.addEventListener("popstate", (e) => {
  const st = e.state ?? {};
  if (!st.report) closeReport(false);
  if (!st.about) closeAbout(false);
  if (!st.zoom) closeZoom(false);
  if (st.screen && !$(st.screen).hidden) {
    if (st.screen === "practice") {
      setPanel(!!st.panel, false);
      if (!st.markup) endMarkup(false);
    }
  } else show("home", "none");
});

// ---------- bug reports (emailed to bugs@partsong.app) ----------

const REPORT_TO = "bugs@partsong.app";
$("header-version").textContent = `beta · ${SHOWN_VERSION}`;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const duration = (secs) => (secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`);

function diagnostics() {
  const screen = ["home", "scan", "practice"].find((s) => !$(s).hidden) || "?";
  const lines = [
    `Partsong ${SHOWN_VERSION} · ${location.host}`,
    `Device: ${navigator.userAgent}`,
    `Screen: ${innerWidth}×${innerHeight} @${devicePixelRatio}x` +
      (navigator.deviceMemory ? ` · ${navigator.deviceMemory} GB RAM` : "") +
      ` · ${navigator.onLine ? "online" : "offline"}`,
    `On: ${screen}`,
  ];
  if (screen === "practice" && current && score) {
    const marks = Object.keys(current.manual ?? {}).length;
    lines.push(
      `Score: "${current.title}" · ${plural(current.pages.length, "page")} · ${plural(current.images?.length ?? 0, "photo")} · ${plural(score.measures.length, "bar")}`,
      `Position: ${$("position").textContent} · from bar ${$("from-bar").value} to ${$("to-bar").value}`,
      `Part: ${marks ? `${marks} of ${score.systems.length} systems marked` : score.lines[current.mine]?.label ?? "?"}` +
        ` · pitch ${current.octave} · sound ${$("instrument").value} · tempo ${$("tempo").value} · others ${$("others").value}%` +
        ` · view ${$("read-view").hidden ? "pages" : "as read"}`,
      `Parts: ${score.lines.map((l) => l.label).join(", ")}`,
    );
  }
  if (screen === "scan") lines.push(`Scan: ${pages.length} pages · status: ${$("status").textContent.replace(/\n/g, " | ")}`);
  if (recentErrors.length) lines.push("", "Recent errors:", ...recentErrors);
  const setup = [...(tunedResult() ? [`Tuned encoder (saved): ${tunedResult()}`] : []), ...readerSetup];
  if (setup.length) lines.push("", "Music reader setup:", ...setup);
  if (readerLog.length) lines.push("", "Music reader log:", ...readerLog.slice(-25));
  return lines.join("\n");
}

function openReport() {
  $("report-diag").textContent = diagnostics();
  const withScore = !$("practice").hidden && !!current;
  const phone = isMobile() && !!navigator.canShare;
  const button = withScore ? "Share report with score" : "Share report";
  $("report-share").textContent = button;
  $("report-status").textContent = "";
  const steps = phone
    ? [
        "Describe what happened above.",
        `Tap <b>${button}</b>.`,
        "Choose Gmail or your email app.",
        `In <b>To</b>, paste <b>${REPORT_TO}</b> (it's copied for you).`,
        "Send.",
      ]
    : [
        "Describe what happened above.",
        `Click <b>${button}</b>: an email to <b>${REPORT_TO}</b> opens${withScore ? " and the score file downloads" : ""}.`,
        ...(withScore ? ["Attach the downloaded file to the email."] : []),
        "Send.",
      ];
  $("report-steps").innerHTML = steps.map((s) => `<li>${s}</li>`).join("");
  $("report").hidden = false;
  history.pushState({ ...history.state, report: true }, "");
  $("report-text").focus();
}
for (const b of document.querySelectorAll(".report-open")) b.onclick = openReport;

function closeReport(nav = true) {
  $("report").hidden = true;
  if (nav && history.state?.report) history.back();
}
$("report-close").onclick = () => closeReport();
// A block body: an onclick returning false cancels the click, which stopped
// "Technical details" opening.
$("report").onclick = (e) => {
  if (e.target === $("report")) closeReport();
};

// About: version, privacy, licence (AGPL: the source link is the offer of
// source to network users) and third-party credits.
function openAbout() {
  $("about-version").textContent = SHOWN_VERSION;
  $("about").hidden = false;
  history.pushState({ ...history.state, about: true }, "");
}
for (const b of document.querySelectorAll(".about-open")) b.onclick = openAbout;
function closeAbout(nav = true) {
  $("about").hidden = true;
  if (nav && history.state?.about) history.back();
}
$("about-close").onclick = () => closeAbout();

function reportText() {
  return `${$("report-text").value.trim() || "(no description)"}\n\n---\n${$("report-diag").textContent}`;
}

// One button: the report (plus the open score as a file, when there is one).
// Phones: the share sheet; the address is copied to paste in, since a web app
// can't fill in the recipient. Desktop: an email opens (and the score file
// downloads, to attach).
let reportPrepared = null; // { id, file }
$("report-share").onclick = async () => {
  track("report");
  const button = $("report-share");
  const status = $("report-status");
  navigator.clipboard?.writeText(REPORT_TO).catch(() => {});
  const what = $("report-text").value.trim().split("\n")[0].slice(0, 60);
  const title = `Partsong problem${what ? `: ${what}` : ""}`;
  const withScore = !$("practice").hidden && !!current;
  button.disabled = true;
  try {
    let file = null;
    if (withScore) {
      if (reportPrepared?.id !== current.id) {
        status.textContent = "Preparing the score…";
        const entry = (await db.all()).find((e) => e.id === current.id) ?? current;
        reportPrepared = { id: current.id, file: await scoreFile(entry) };
      }
      file = reportPrepared.file;
    }
    const text = `To: ${REPORT_TO}\n\n${reportText()}`;
    const share = file ? { files: [file], title, text } : { title, text };
    if (isMobile() && navigator.canShare?.(share)) {
      try {
        await navigator.share(share);
        reportPrepared = null;
        status.textContent = `Thanks! Remember to paste ${REPORT_TO} into To.`;
      } catch (e) {
        status.textContent =
          e.name === "NotAllowedError" ? `Ready. Tap ${button.textContent} again.` : e.name === "AbortError" ? "" : `Couldn't share: ${e.message}`;
      }
    } else {
      if (file) await shareFile(file, title); // downloads on desktop
      reportPrepared = null;
      let body = reportText();
      if (body.length > 6000) body = body.slice(0, 6000) + "\n…(trimmed)";
      const url = `mailto:${REPORT_TO}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
      // A link click, like the download above (tests stub it so no mail app opens).
      Object.assign(document.createElement("a"), { href: url }).click();
      status.textContent = file
        ? `Attach ${file.name} (in your Downloads) to the email, then send.`
        : `If no email opened, write to ${REPORT_TO} and paste the details below.`;
    }
  } catch (e) {
    reportPrepared = null;
    status.textContent = `Couldn't prepare the report: ${e.message}`;
  } finally {
    button.disabled = false;
  }
};

// ---------- updates: tell people (installed apps rarely restart) ----------

// A deploy stamps its version into index.html (scripts/stamp-version.mjs).
// When the app comes back to the screen, or every 30 minutes, fetch the page
// fresh and compare; if it's newer, offer a reload rather than forcing one.
let lastUpdateCheck = 0;
async function checkForUpdate() {
  if (VERSION === "dev" || !navigator.onLine || Date.now() - lastUpdateCheck < 60000) return;
  lastUpdateCheck = Date.now();
  try {
    const html = await (await fetch(`./?check=${Date.now()}`, { cache: "no-store" })).text();
    const live = /app\.js\?v=(\w+)/.exec(html)?.[1];
    if (live && live !== VERSION) $("update-banner").hidden = false;
  } catch {}
}
$("update-now").onclick = () => location.reload();
$("update-later").onclick = () => ($("update-banner").hidden = true);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkForUpdate());
setInterval(checkForUpdate, 30 * 60000);
setTimeout(checkForUpdate, 10000);

// ---------- install prompt ----------

const INSTALL_SNOOZE_KEY = "partsong.install.snoozed";
const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const snoozed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(INSTALL_SNOOZE_KEY) || 0) < 30 * 864e5;
  } catch {
    return false;
  }
};
let installPrompt = null;
function showInstallCard() {
  if (installed() || snoozed()) return;
  $("install-card").hidden = false;
}
// Chrome/Edge (Android, desktop): use the browser's own install prompt.
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  showInstallCard();
});
// Not suggested on iPhone/iPad: a home-screen app there keeps a library
// separate from Safari's, so scores opened from shared files (which open in
// Safari) wouldn't show up in it.
$("install-now").onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  if (outcome === "accepted") {
    $("install-card").hidden = true;
    track("install");
  }
};
$("install-later").onclick = () => {
  $("install-card").hidden = true;
  try {
    localStorage.setItem(INSTALL_SNOOZE_KEY, String(Date.now()));
  } catch {}
};
addEventListener("appinstalled", () => ($("install-card").hidden = true));

const DELETE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

// Swaps a library row for a "are you sure?" check before deleting.
function confirmDelete(li, entry) {
  const box = document.createElement("div");
  box.className = "confirm-delete";
  box.setAttribute("role", "alertdialog");
  box.innerHTML = `<p></p><div class="actions"><button class="danger-solid">Delete</button><button>Cancel</button></div>`;
  box.querySelector("p").textContent = `Delete “${entry.title}”? This can't be undone.`;
  const [yes, no] = box.querySelectorAll("button");
  yes.onclick = async () => {
    await db.remove(entry.id);
    await renderLibrary();
    $("library-status").textContent = `Deleted “${entry.title}”.`;
    clearTimeout(shareScore.timer);
    shareScore.timer = setTimeout(() => ($("library-status").textContent = ""), 4000);
  };
  no.onclick = () => renderLibrary();
  li.replaceChildren(box);
  no.focus();
}

const COPY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';

// Search appears once the library is long enough to need it. Every word typed
// must appear in the title (ignoring case and accents).
const SEARCH_FROM = 6;
const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function filterLibrary() {
  const words = fold($("library-search").value).split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const li of $("library").children) {
    const match = words.every((w) => fold(li.dataset.title ?? "").includes(w));
    li.hidden = !match;
    shown += match;
  }
  $("library-none").hidden = shown > 0 || !$("library").children.length;
}
$("library-search").oninput = filterLibrary;

async function renderLibrary() {
  const lib = await db.all().catch(() => []);
  $("library-search").hidden = lib.length < SEARCH_FROM;
  if (lib.length < SEARCH_FROM) $("library-search").value = "";
  releasePhotos("library");
  $("library-empty").hidden = lib.length > 0;
  $("intro-more").hidden = lib.length > 0; // the explanation is for newcomers
  document.querySelector("#home .footer-sample").hidden = lib.length === 0; // the big button shows instead
  $("library").replaceChildren(
    ...lib
      .slice()
      .sort((a, b) => b.created - a.created)
      .map((entry) => {
        const li = document.createElement("li");
        li.dataset.id = entry.id;
        li.dataset.title = entry.title;
        const b = document.createElement("button");
        const n = entry.pages.length;
        const done = entry.pages.filter(Boolean).length;
        const marked = Object.keys(entry.manual ?? {}).length;
        const info = entry.pending
          ? `Reading… ${done} of ${n}`
          : `${n} page${n > 1 ? "s" : ""}${marked ? ` · ${marked} system${marked > 1 ? "s" : ""} marked` : ""}${entry.readSeconds ? ` · read in ${duration(entry.readSeconds)}` : ""}`;
        b.innerHTML = `<span class="thumb"></span><span class="meta"><span class="name"></span><small>${info}</small></span>`;
        b.querySelector(".name").textContent = (entry.locked ? "🔒 " : "") + entry.title;
        if (entry.images?.length) {
          const img = document.createElement("img");
          img.alt = "";
          img.src = photoUrl("library", entry.images[0]);
          b.querySelector(".thumb").append(img);
        }
        b.onclick = () => (entry.pending ? resumeScan(entry) : openScore(entry));
        li.append(b);
        if (!entry.pending) {
          const copy = document.createElement("button");
          copy.className = "share-btn";
          copy.setAttribute("aria-label", `Make a copy of ${entry.title}`);
          copy.title = "Make a copy";
          copy.innerHTML = COPY_ICON;
          copy.onclick = () => copyScore(entry.id);
          const share = document.createElement("button");
          share.className = "share-btn";
          share.setAttribute("aria-label", `Share ${entry.title}`);
          share.title = "Share";
          share.innerHTML = $("share").innerHTML;
          share.onclick = () => shareScore(entry.id, share, $("library-status"));
          li.append(copy, share);
        } else {
          for (let i = 0; i < 2; i++) li.append(Object.assign(document.createElement("span"), { className: "share-spacer" }));
        }
        const del = document.createElement("button");
        del.className = "share-btn delete-btn";
        del.setAttribute("aria-label", `Delete ${entry.title}`);
        del.title = entry.locked ? "Locked: unlock it to delete" : "Delete";
        del.innerHTML = DELETE_ICON;
        // Locked scores can't be deleted, nor the scan being read right now.
        del.disabled = !!entry.locked || (reading && entry.id === scanId);
        del.onclick = () => confirmDelete(li, entry);
        li.append(del);
        return li;
      }),
  );
  filterLibrary();
}

// ---------- scanning ----------

let pages = []; // { blob, url }
let worker;
let workerReady;
const pending = new Map();
const download = new Map();

function startWorker() {
  if (worker) return;
  worker = new Worker("omr-worker.js", { type: "module" });
  workerReady = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === "progress" && data.stage === "download") {
        download.set(data.name, data);
        const loaded = [...download.values()].reduce((s, d) => s + d.loaded, 0);
        const mb = loaded < 10e6 ? (loaded / 1e6).toFixed(1) : Math.round(loaded / 1e6);
        setEngineStatus(`Downloading music reader (once only): ${mb} / ${Math.round(data.total / 1e6)} MB`);
      } else if (data.type === "progress" && data.stage === "retry") {
        // Why, so a report shows it (a stored piece failing isn't the connection).
        const was = engineStatus.split(" · ")[0];
        setEngineStatus(`${was ? `${was} · ` : ""}Download failed (${data.why}), retrying (${data.attempt})…${inAppBrowser ? IN_APP_TIP : ""}`);
        remember(readerSetup, `Download retry ${data.attempt}: ${data.why}`, 10);
      } else if (data.type === "refetch") {
        remember(readerSetup, `Model piece ${data.name} #${data.piece} missing; downloading it again`, 10);
        track(`model-refetched (${deviceTag})`);
      } else if (data.type === "ready") {
        setEngineStatus("");
        try {
          localStorage.setItem(READER_FETCHED, "1");
        } catch {}
        resolve();
      } else if (data.type === "tuned") {
        if (data.threads) {
          try {
            localStorage.setItem(TUNED_THREADS, JSON.stringify({ threads: data.threads, gpu: data.gpu, ms: data.ms }));
          } catch {}
        } else if (data.error) {
          remember(readerSetup, `Tuning failed: ${data.error}`.slice(0, 200), 10);
        }
        tuned?.();
      } else if (data.type === "log") {
        console.log("[omr]", data.msg);
        if (SETUP_LOG.test(data.msg)) remember(readerSetup, String(data.msg).slice(0, 200), 10);
        else remember(readerLog, String(data.msg).slice(0, 200), 40);
        const m = /Running TrOmr inference on staff image (\d+)/.exec(data.msg);
        if (m) setPageStatus(`reading staff ${Number(m[1]) + 1}`);
        else if (/Found the staffs/.test(data.msg)) setPageStatus("found the staves");
      } else if (data.type === "result" || data.type === "error") {
        const p = pending.get(data.id);
        if (!p) {
          resetWorker();
          return reject(new Error(data.msg));
        }
        pending.delete(data.id);
        data.type === "result" ? p.resolve("xml" in data ? data.xml : data) : p.reject(new Error(data.msg));
      }
    };
    // A crashed worker (e.g. the phone ran out of memory) fails everything waiting
    // on it; the next attempt starts a fresh one (downloads resume, see worker).
    worker.onerror = (e) => {
      const err = new Error(e.message || "the music reader stopped (low memory?)");
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      resetWorker();
      reject(err);
    };
  });
  worker.postMessage({ type: "init", exact: exactEncoder(), threads: tunedThreads(), gpu: tunedGpu() });
}

// The exact encoder's thread count, measured once on this device (see tune()
// in omr-worker.js). Bump the key when the encoder's threading changes.
const TUNED_THREADS = "partsong-encoder-threads-v3"; // v2: also times the GPU encoder; v3: at most 4 threads
let tuned;
function tunedThreads() {
  try {
    if (new URLSearchParams(location.search).get("tune") === "1" && !tunedThreads.cleared) {
      tunedThreads.cleared = true; // ?tune=1: measure again on this open
      localStorage.removeItem(TUNED_THREADS);
    }
    return JSON.parse(localStorage.getItem(TUNED_THREADS))?.threads;
  } catch {
    return undefined;
  }
}
function tunedGpu() {
  try {
    const t = JSON.parse(localStorage.getItem(TUNED_THREADS));
    return typeof t?.gpu === "boolean" ? t.gpu : undefined;
  } catch {
    return undefined;
  }
}
function tunedResult() {
  try {
    const t = JSON.parse(localStorage.getItem(TUNED_THREADS));
    return t && `${t.gpu ? "GPU" : `${t.threads} threads`} (${Object.entries(t.ms ?? {}).map(([n, ms]) => `${n}: ${ms ?? "unavailable"}${ms == null ? "" : " ms"}`).join(" · ")})`;
  } catch {
    return "";
  }
}
function tuneReader() {
  return new Promise((resolve) => {
    tuned = resolve;
    worker.postMessage({ type: "tune" });
  });
}

// Test switch (?exact=1 / ?exact=0, remembered): homr's encoder in homr-rs,
// bit-exact with native homr but on the CPU, instead of onnxruntime-web.
function exactEncoder() {
  try {
    const q = new URLSearchParams(location.search).get("exact");
    if (q === "1") localStorage.setItem("partsong-exact", "1");
    if (q === "0") localStorage.removeItem("partsong-exact");
    return localStorage.getItem("partsong-exact") === "1";
  } catch {
    return false;
  }
}

function resetWorker() {
  worker?.terminate();
  worker = null;
  download.clear();
}

// The music reader's models (157 MB, once) download in the background soon
// after the app opens, so the first scan doesn't wait for them. Not on mobile
// data or data saver where the phone says so (Android Chrome); not on
// iPhone/iPad, which don't say, so the first scan fetches it there; not again
// once done. With the exact encoder, the reader then times it once at several
// thread counts (tune). Afterwards the reader is closed unless a scan is using it.
const READER_FETCHED = "partsong-reader-fetched";
function prefetchReader() {
  if (iDevice) return;
  let fetched = false;
  try {
    fetched = !!localStorage.getItem(READER_FETCHED);
  } catch {}
  const needTune = exactEncoder() && self.crossOriginIsolated && !tunedThreads();
  if (fetched && !needTune) return;
  const c = navigator.connection;
  if (!fetched && (c?.saveData || c?.type === "cellular")) return;
  setTimeout(() => {
    if (worker) return; // a scan has started it already
    startWorker();
    const started = worker;
    workerReady.then(
      async () => {
        if (needTune && worker === started) await tuneReader();
        if (worker === started && !reading && $("scan").hidden) resetWorker();
      },
      () => {},
    );
  }, 3000);
}

let engineStatus = "";
let pageStatus = "";
function setEngineStatus(s) {
  engineStatus = s;
  $("status").textContent = [engineStatus, pageStatus].filter(Boolean).join("\n");
}
let pageLabel = "";
function setPageStatus(s) {
  pageStatus = pageLabel ? `${pageLabel}: ${s}` : s;
  setEngineStatus(engineStatus);
}

// The scan being read is saved to the library page by page (pending: true),
// so if Android pauses or kills the tab, reading resumes from the next page.
let scanId = null;
let scanCreated = null;
let reading = false;
let readSeconds = null; // how long the last whole read took
let rereading = false; // reading a saved score's photos again: keep the old music until done

let scanSettings = {}; // settings to save with the scan (the sample's)
let scanResumes = 0; // launches that carried this scan on without progress (kept by readScan's save)

function loadScan(images = [], xmls = [], id = null, created = null, title = "") {
  pages.forEach((p) => URL.revokeObjectURL(p.url));
  pages = images.map((blob, i) => ({ blob, url: URL.createObjectURL(blob), xml: xmls[i] ?? undefined }));
  scanId = id;
  scanCreated = created;
  scanSettings = {};
  scanResumes = 0;
  rereading = false;
  pageStatus = "";
  $("scan-name").value = title;
  renderPages();
  show("scan");
  checkDevice();
  startWorker();
}

$("new-scan").onclick = () => (reading ? show("scan") : loadScan());

// Reading on iPhone/iPad is less reliable: Safari there is short of memory,
// so a long score can stop part-way (the read then resumes where it stopped).
const IOS_NOTE = `If reading music doesn't work on this ${/iPhone|iPod/.test(ua) ? "iPhone" : "iPad"}, Partsong also works on a computer.`;
if (iDevice) {
  $("device-note").textContent = IOS_NOTE;
  $("device-note").hidden = false;
}

// A quick check, each time the scan screen opens, that this browser can run
// the music reader: WebAssembly SIMD, and the memory onnxruntime reserves
// when it starts (a shared block that can grow to 4 GB; iPhones sometimes
// refuse it, "RangeError: Out of memory"). Done in a throwaway worker, closed
// at once so the memory is freed; nothing is downloaded. It warns rather than
// blocks: free memory changes as apps close. Counted by device and version.
const PROBE = `
let r = "ok";
try {
  // wasm-feature-detect's SIMD test module
  if (!WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]))) r = "no SIMD";
} catch { r = "no WebAssembly"; }
if (r === "ok") {
  try { new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: true }); }
  catch (e) { r = e instanceof RangeError ? "memory" : "other: " + String(e.message || e).slice(0, 60); }
}
postMessage(r);`;
let probeCounted = false;
function checkDevice() {
  let w;
  try {
    w = new Worker(URL.createObjectURL(new Blob([PROBE], { type: "text/javascript" })));
  } catch {
    return;
  }
  const done = (r) => {
    w.terminate();
    if (!probeCounted) {
      probeCounted = true;
      track(`device-check (${deviceTag}): ${r}`);
    }
    const note = $("device-note");
    if (r === "memory") {
      const phone = iDevice || deviceKind === "Android";
      const what = deviceKind === "iPad" ? "iPad" : phone ? "phone" : "computer";
      note.textContent =
        `This ${what} couldn't set aside enough memory for the music reader just now, so reading would probably fail. ` +
        `Close other apps and ${iDevice ? "Safari" : "browser"} tabs${phone ? ` (or restart the ${what})` : ""}, then open Partsong again.` +
        (phone ? " Or scan on a computer using Chrome or Edge." : "");
    } else if (r === "no SIMD" || r === "no WebAssembly") {
      note.textContent = "This browser is too old to read music. Update it (or the phone's software), or scan on a computer using Chrome or Edge.";
    } else {
      note.textContent = iDevice ? IOS_NOTE : "";
    }
    note.hidden = !note.textContent;
  };
  const timer = setTimeout(() => done("no answer"), 3000);
  w.onmessage = (e) => {
    clearTimeout(timer);
    done(e.data);
  };
  w.onerror = () => {
    clearTimeout(timer);
    done("worker failed");
  };
}

// The sample score (samples/tallis-if-ye-love-me.pdf, from CPDL):
// opens the scan screen with its pages added, ready for Read music.
// Anonymous usage counts (GoatCounter, no cookies; see index.html): which
// features get used, never titles or music. Silent if blocked or offline.
// GoatCounter's script loads after the app starts (and not at all if
// blocked): an early count waits up to 15 s for it.
function track(name, title = name, tries = 30) {
  try {
    if (window.goatcounter?.count) return window.goatcounter.count({ path: name, title, event: true });
  } catch {
    return;
  }
  if (tries > 0) setTimeout(() => track(name, title, tries - 1), 500);
}

// Whether people come back: once a day, on opening, how many different days
// this device has used Partsong, how long since its first, and how many
// scores it holds, each in broad groups. The counts stay on the device; no
// id is sent, so nothing links one device's counts together.
const USE_DAYS = "partsong-use-days"; // { first, last, days }
const group = (n, edges, from = 0) => {
  for (const [i, e] of edges.entries()) {
    if (n < e) {
      const lo = i ? edges[i - 1] : from;
      return e - lo === 1 ? String(lo) : `${lo}–${e - 1}`;
    }
  }
  return `${edges.at(-1)}+`;
};
async function countReturn() {
  try {
    const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
    const was = JSON.parse(localStorage.getItem(USE_DAYS) || "null");
    if (was?.last === today) return;
    const use = { first: was?.first ?? today, last: today, days: (was?.days ?? 0) + 1 };
    localStorage.setItem(USE_DAYS, JSON.stringify(use));
    const since = Math.round((Date.parse(today) - Date.parse(use.first)) / 864e5);
    const scores = (await db.all().catch(() => [])).filter((e) => !e.pending).length;
    track(`use: day ${group(use.days, [2, 3, 4, 6, 11, 21, 51], 1)}`);
    track(`use: first ${since === 0 ? "today" : since < 7 ? "1–6 days ago" : since < 28 ? "1–4 weeks ago" : since < 91 ? "1–3 months ago" : "3+ months ago"}`);
    track(`library: ${group(scores, [1, 2, 3, 4, 6, 11, 21, 51])} scores`);
  } catch {}
}

// Why a reading failed, short enough to count: the error's last line,
// without file paths, and with
// numbers as N so the same failure counts together. Never the score or photo.
function failureReason(e) {
  const last = String(e?.message ?? e).trim().split("\n").at(-1) || e?.name || "unknown";
  return (
    last
      .replace(/^(Uncaught )?(Exception|Error): /, "")
      .replace(/(\/[\w.-]+)+/g, "…")
      .replace(/\d+(\.\d+)?/g, "N")
      .slice(0, 80) || "unknown"
  );
}

async function trySample() {
  track("sample");
  if (reading) return show("scan");
  loadScan();
  $("scan-name").value = "If ye love me (sample)";
  // The reader misses the forward repeat at the start of bar 14.
  scanSettings = { repeats: { 26: 14 } };
  setPageStatus("Opening the sample…");
  try {
    const blob = await (await fetch("samples/tallis-if-ye-love-me.pdf")).blob();
    if (await addFiles([new File([blob], "If ye love me (sample).pdf", { type: "application/pdf" })])) setPageStatus("Tap Read music to read the sample.");
  } catch (e) {
    setPageStatus(`Couldn't open the sample: ${e.message}`);
  }
}
for (const b of document.querySelectorAll(".try-sample")) b.onclick = trySample;

function resumeScan(entry) {
  if (reading) return show("scan");
  loadScan(entry.images, entry.pages, entry.id, entry.created, entry.title);
  // Settings made before reading (the sample's repeats, systems you fixed) go on with it.
  const { id: _id, created: _c, title: _t, images: _i, pages: _p, pending: _pe, stopped: _s, resumes: _r, found, ...settings } = entry;
  scanSettings = settings;
  found?.forEach((f, i) => {
    if (!f || !pages[i]) return;
    pages[i].layout = f.systems;
    pages[i].parts = f.parts;
    pages[i].classes = f.classes;
  });
  scanResumes = entry.resumes ?? 0;
  readScan();
}

// The reader uses several threads only in a cross-origin isolated page, and
// on GitHub Pages only the service worker can make one, for pages loaded after
// it took over: so a first visit would read on one thread. Reload once (the
// saved scan carries on below), when a reload would make the difference.
const THREADS_RELOAD = "partsong-threads-reload";
function reloadForThreads() {
  try {
    // Computers only: phones close the tab when reading runs short of memory
    // (more threads use more), and a reload would cut a download short.
    if (iDevice || deviceKind === "Android" || self.crossOriginIsolated || !navigator.serviceWorker?.controller || (navigator.hardwareConcurrency || 1) < 2) return false;
    if (sessionStorage.getItem(THREADS_RELOAD)) return false; // tried in this tab
    sessionStorage.setItem(THREADS_RELOAD, `scan:${scanId}`);
  } catch {
    return false;
  }
  location.reload();
  return true;
}

// On launch, carry on with a scan that was interrupted, unless it has already
// been resumed twice without progress (e.g. the phone keeps running out of memory).
// Counted, by kind of device: the page itself can't report being killed.
// Taken at startup, whichever way the launch goes, so a later reload in this
// tab (e.g. Update) doesn't take it for this one.
const reloadedScan = (() => {
  try {
    const v = sessionStorage.getItem(THREADS_RELOAD);
    if (!v?.startsWith("scan:")) return null;
    sessionStorage.setItem(THREADS_RELOAD, "done");
    return v.slice(5);
  } catch {
    return null;
  }
})();
async function resumeUnfinished() {
  const all = await db.all().catch(() => []);
  // After the reload for threads: the scan that was tapped, not counted as a restart.
  const tapped = reloadedScan && all.find((e) => e.id === reloadedScan && e.pending);
  if (tapped) {
    track(`read-reloaded-for-threads (${deviceTag}): ${self.crossOriginIsolated ? "isolated" : "still not isolated"}`);
    return resumeScan(tapped);
  }
  const entry = all.find((e) => e.pending && !e.stopped);
  const resumes = entry?.resumes ?? 0;
  if (!entry || resumes > 2) return;
  await db.update(entry.id, { resumes: resumes + 1 }).catch(() => {});
  if (resumes === 2) return track(`read-gave-up (${deviceTag})`); // once
  track(`read-restarted (${deviceTag})`);
  resumeScan({ ...entry, resumes: resumes + 1 }); // as just saved: readScan's save keeps it
}

// Each page's systems and segmentation as found, kept with an unfinished
// scan so that a read carried on after the app was closed starts where it
// stopped (finding systems for a long score takes a while, and a phone may
// close the app more than once on the way).
const foundLayouts = () => pages.map((p) => (p.layout ? { systems: p.layout, parts: p.parts, classes: p.classes ?? null } : null));

function scanEntry(pending) {
  return {
    id: scanId,
    title: $("scan-name").value.trim() || `Scan ${new Date().toLocaleDateString()}`,
    created: scanCreated,
    images: pages.map((p) => p.blob),
    pages: pages.map((p) => p.xml ?? null),
    pending,
    resumes: scanResumes,
    ...scanSettings,
    ...(pending ? { found: foundLayouts() } : {}),
  };
}

$("discard-scan").onclick = async () => {
  if (reading) return;
  if (rereading) return goHome(); // the score is still saved as it was
  if (scanId) await db.remove(scanId).catch(() => {});
  loadScan();
  goHome();
};

// Keeps the screen on while reading; the lock lapses when the app is hidden,
// so it's taken again on return.
function keepAwake() {
  let lock = null;
  const acquire = async () => {
    if (document.visibilityState === "visible") lock = await navigator.wakeLock?.request("screen").catch(() => null);
  };
  document.addEventListener("visibilitychange", acquire);
  acquire();
  return () => {
    document.removeEventListener("visibilitychange", acquire);
    lock?.release().catch(() => {});
  };
}

async function addPage(image) {
  const blob = await uprightPhoto(image);
  pages.push({ blob, url: URL.createObjectURL(blob) });
  renderPages();
}

// Why a picked file can't be used, in words a user can act on.
async function unreadableReason(file) {
  if (file.size === 0) return "the file is empty. If it's in Google Photos or Drive, download it to the phone first";
  const head = String.fromCharCode(...new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (/ftyp(heic|heix|hevc|heif|mif1|msf1)/.test(head)) {
    return "it's a HEIC photo, which Chrome can't open. Use Take photo, or set the camera to save JPEG";
  }
  return "it isn't an image or PDF this browser can open";
}

async function addFiles(files) {
  const problems = [];
  for (const f of files) {
    const name = f.name || "file";
    if (await isPdf(f)) {
      if (!$("scan-name").value.trim()) $("scan-name").value = name.replace(/\.pdf$/i, "");
      try {
        await pdfPages(f, async (blob, n, count) => {
          setPageStatus(`Opening ${name}: page ${n} of ${count}`);
          await addPage(blob);
        });
      } catch (e) {
        problems.push(`Couldn't open ${name}: ${e.message}`);
      }
      continue;
    }
    try {
      await addPage(f);
    } catch {
      problems.push(`Couldn't add ${name}: ${await unreadableReason(f)}.`);
    }
  }
  setPageStatus(problems.join("\n"));
  return !problems.length;
}

$("camera").onchange = (e) => {
  addFiles([...e.target.files]);
  e.target.value = "";
};
$("gallery").onchange = (e) => {
  addFiles([...e.target.files]);
  e.target.value = "";
};

async function rotatePage(p) {
  p.blob = await rotateBlob(p.blob, 90);
  delete p.xml;
  URL.revokeObjectURL(p.url);
  p.url = URL.createObjectURL(p.blob);
  renderPages();
}

// A page full-screen, to check it's the right way up and readable; Rotate
// turns it as the small button does. Back closes it.
let zoomed = null;
function openZoom(p) {
  zoomed = p;
  $("page-zoom-img").src = p.url;
  $("page-zoom-num").textContent = `Page ${pages.indexOf(p) + 1} of ${pages.length}`;
  $("page-zoom").hidden = false;
  history.pushState({ ...history.state, zoom: true }, "");
}
function closeZoom(nav = true) {
  if ($("page-zoom").hidden) return;
  $("page-zoom").hidden = true;
  zoomed = null;
  if (nav && history.state?.zoom) history.back();
}
$("page-zoom-close").onclick = () => closeZoom();
$("page-zoom-rotate").onclick = async () => {
  if (!zoomed || reading) return;
  await rotatePage(zoomed);
  $("page-zoom-img").src = zoomed.url;
};

function renderPages() {
  $("pages").replaceChildren(
    ...pages.map((p, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<img alt="Page ${i + 1}"><span class="num">${i + 1}</span>
        <button class="rotate" aria-label="Rotate page ${i + 1}">&#8635;</button>
        <button class="remove" aria-label="Remove page ${i + 1}">&times;</button>`;
      li.querySelector("img").src = p.url;
      li.querySelector("img").onclick = () => openZoom(p);
      li.querySelector(".rotate").onclick = () => rotatePage(p);
      li.querySelector(".remove").onclick = () => {
        URL.revokeObjectURL(p.url);
        pages.splice(i, 1);
        renderPages();
      };
      return li;
    }),
  );
  $("recognise").disabled = pages.length === 0;
}

// Apply EXIF rotation and cap the size. homr autocrops before resizing to
// 1920 px wide, so keep typical phone resolution (~4000 px) intact.
async function normalise(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const scale = Math.min(1, 4200 / Math.max(bmp.width, bmp.height));
  const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

// A saved page whose picture the phone has lost can't be read again: say
// what to do rather than show the browser's error.
async function pagePixels(blob) {
  try {
    return await normalise(blob);
  } catch {
    throw new Error("the phone has lost the picture of this page. Tap Discard this scan, then add the pages or PDF again");
  }
}

let requestId = 0;
// systems: the user's systems for this page ([top, bottom] ranges), if fixed.
// classes: the page's segmentation from layoutPage, so it isn't worked out twice.
function recognisePage(image, systems, classes) {
  return ask({ type: "recognise", image, systems: systems?.length ? JSON.stringify(systems) : "", classes }, [image]);
}

// The page's systems before reading any staff: { systems: per system its
// staves' [x0, y0, x1, y1] on the photo, classes }.
function layoutPage(image, systems) {
  return ask({ type: "layout", image, systems: systems?.length ? JSON.stringify(systems) : "" }, [image]);
}

function ask(msg, transfer) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    // Stopped while a photo was being prepared: the reader is already gone.
    if (!worker) return reject(new Stopped());
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

$("recognise").onclick = () => (reading ? stopReading?.() : readScan());

const NO_MUSIC = /No (staffs|noteheads) found\s*$/;

// ---------- two phases: the systems on every page, then the staves ----------
// Finding each page's systems is quick; reading every staff is the slow part.
// So the systems come first, shown on every page to check (as Check and fix
// systems does), and the staves are read once you tap Read music.

// Pages (indexes) whose systems give other parts than most pages' do.
function doubtfulPages(todo) {
  const shape = (i) => pages[i].parts?.join(",");
  const freq = new Map();
  for (const i of todo) if (shape(i)) freq.set(shape(i), (freq.get(shape(i)) ?? 0) + 1);
  const usual = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0];
  return todo.filter((i) => shape(i) && shape(i) !== usual);
}

async function checkSystems(stopped) {
  const todo = pages.map((_, i) => i).filter((i) => !pages[i].xml);
  // Each page is shown to check as soon as its systems are found, so you
  // check page 1 while the rest are found; Read music waits for the last.
  let check = null;
  try {
    for (const i of todo) {
      // Progress is on the status line until the check opens, then on its bar.
      pageLabel = check ? "" : `Page ${i + 1} of ${pages.length}`;
      if (!check) setPageStatus("finding lines of music…");
      check?.waiting(`Finding the lines of music (systems): page ${i + 1} of ${pages.length}…`);
      // A page whose systems were found before the app was closed (a phone
      // reloading under memory pressure) isn't done again.
      if (!pages[i].layout) {
        try {
          const r = await Promise.race([layoutPage(await pagePixels(pages[i].blob), scanSettings.systemHints?.[i]), stopped]);
          pages[i].layout = r.systems;
          pages[i].parts = r.parts;
          pages[i].classes = r.classes;
          if (scanId && !rereading) await db.update(scanId, { found: foundLayouts(), resumes: 0 }).catch(() => {});
          scanResumes = 0; // progress
        } catch (e) {
          // No music on it: the reading leaves it out.
          if (e instanceof Stopped || !NO_MUSIC.test(e.message)) throw e;
        }
      }
      if (pages[i].layout) {
        if (!check) {
          pageLabel = "";
          setPageStatus("");
          check = openCheck();
        }
        check.add(i);
      }
    }
    pageLabel = "";
    const found = `Systems (staves in each): ${todo.map((i) => `p${i + 1} ${(pages[i].layout ?? []).map((sys) => sys.length).join(",") || "none"} parts ${pages[i].parts?.join("") ?? "-"}`).join("; ")}`;
    console.log("[omr]", found);
    remember(readerLog, found, 40);
    if (check) {
      const hints = await Promise.race([check.done(doubtfulPages(todo)), stopped]);
      if (Object.keys(hints).length) {
        track("systems-check-fixed");
        scanSettings.systemHints = { ...(scanSettings.systemHints ?? {}), ...hints };
      }
    }
  } finally {
    pageLabel = "";
    $("systems-check").hidden = true;
    $("recognise").hidden = false;
  }
  scanSettings.systemsChecked = true;
  if (scanId) await db.update(scanId, { systemHints: scanSettings.systemHints, systemsChecked: true }).catch(() => {});
}

// The check screen: pages are added as their systems are found; done()
// marks the unusual ones, lets Read music be tapped, and resolves with the
// systems of the pages changed (page -> [top, bottom] ranges).
$("check-stop").onclick = () => $("recognise").click();
const CHECK_LINES = "Each red line marks where one line of music (system) ends: all the voices sung together. If a red line is in the wrong place, tap between two staves to add or remove one.";
const CHECK_INTRO = `Pages appear as they're found. ${CHECK_LINES}`;
function openCheck() {
  const drafts = {};
  const labels = {};
  $("check-list").replaceChildren();
  $("check-intro").textContent = CHECK_INTRO;
  // Stop reading moves into the bar at the bottom as Cancel (the button above
  // scrolls away), and becomes Next once every page's systems are found.
  $("check-done").hidden = true;
  $("check-done").onclick = null;
  $("check-stop").hidden = false;
  $("recognise").hidden = true;
  $("check-wait").textContent = "Finding the lines of music (systems)…";
  $("systems-check").hidden = false;
  $("systems-check").scrollIntoView({ behavior: "smooth", block: "start" });
  return {
    add(i) {
      const label = (labels[i] = Object.assign(document.createElement("p"), { className: "check-page", textContent: `Page ${i + 1}` }));
      const div = Object.assign(document.createElement("div"), { className: "page" });
      const img = document.createElement("img");
      img.alt = `Page ${i + 1}`;
      img.src = pages[i].url;
      const svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("preserveAspectRatio", "none");
      const g = document.createElementNS(SVG, "g");
      svg.append(g);
      const d = (drafts[i] = pageRows(i, pages[i].layout.map((staves, index) => ({ index, staves: staves.map(([, y0, , y1]) => ({ y0, y1 })) }))));
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        d.w = img.naturalWidth * scale;
        d.h = img.naturalHeight * scale;
        svg.setAttribute("viewBox", `0 0 ${d.w} ${d.h}`);
        drawGaps(g, d, d.w);
      };
      svg.onclick = (e) => {
        // Taps are logged (where, and the page's gaps after: | a system's end,
        // . inside one) so a report shows what a tap did.
        if (!d.w) return remember(readerLog, `Check tap p${i + 1}: picture not loaded yet`, 40);
        const rect = svg.getBoundingClientRect();
        const y = ((e.clientY - rect.top) / rect.height) * d.h;
        if (toggleGap(d, y)) drawGaps(g, d, d.w);
        const gaps = d.rows.slice(1).map((row, k) => `${Math.round((d.rows[k].y1 + row.y0) / 2)}${d.splits[k] ? "|" : "."}`);
        remember(readerLog, `Check tap p${i + 1} at y ${Math.round(y)} of ${Math.round(d.h)}: ${gaps.join(" ")}`.slice(0, 200), 40);
      };
      div.append(img, svg);
      $("check-list").append(label, div);
    },
    waiting(text) {
      $("check-wait").textContent = text;
    },
    done(doubtful) {
      for (const i of doubtful) if (labels[i]) labels[i].textContent += ": looks unusual";
      const which = doubtful.map((i) => i + 1);
      const named = which.length > 1 ? `Pages ${which.slice(0, -1).join(", ")} and ${which.at(-1)} look` : `Page ${which[0]} looks`;
      $("check-intro").textContent = CHECK_LINES + (which.length ? ` ${named} unusual.` : "");
      $("check-wait").textContent = "Red lines look right?";
      $("check-stop").hidden = true;
      $("check-done").hidden = false;
      return new Promise((resolve) => {
        $("check-done").onclick = () => {
          const hints = {};
          for (const [i, d] of Object.entries(drafts)) if (d.h && d.splits.some((x, k) => x !== d.initial[k])) hints[i] = fixBands(d, d.h);
          resolve(hints);
        };
      });
    },
  };
}

// While reading, the Read music button stops it: the reader is shut down at
// once (even mid-page; it starts again for the next read). Pages already read
// are kept, and Read music carries on from the next one.
let stopReading = null;
class Stopped extends Error {}

async function readScan() {
  if (reading) return;
  reading = true;
  $("scan").classList.add("reading");
  $("recognise").textContent = "Stop reading";
  $("read-hint").hidden = false;
  const stopped = new Promise((_, reject) => {
    stopReading = () => {
      reject(new Stopped());
      for (const p of pending.values()) p.reject(new Stopped());
      pending.clear();
      resetWorker();
    };
  });
  stopped.catch(() => {});
  const release = keepAwake();
  scanId ??= crypto.randomUUID();
  scanCreated ??= Date.now();
  let saved = !rereading && (await db.put(scanEntry(true)).then(() => true, () => false));
  if (saved && reloadForThreads()) return;
  try {
    startWorker();
    await Promise.race([workerReady, stopped]);
    const t0 = performance.now();
    // Only a read of every page gives the time a whole score takes.
    const fresh = pages.every((p) => !p.xml);
    // Systems you've just fixed are read as they are.
    if (!rereading && !scanSettings.systemsChecked) await checkSystems(stopped);
    $("read-step").hidden = false;
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].xml) continue;
      pageLabel = `Page ${i + 1} of ${pages.length}`;
      setPageStatus("finding staves…");
      try {
        const classes = pages[i].classes;
        pages[i].classes = null;
        pages[i].xml = await Promise.race([recognisePage(await pagePixels(pages[i].blob), scanSettings.systemHints?.[i], classes), stopped]);
      } catch (e) {
        // A cover or words-only page: leave it out and read the rest (unless
        // it's the only page left, when the error is the answer).
        if (e instanceof Stopped || pages.length === 1 || !NO_MUSIC.test(e.message)) throw e;
        track("read-skipped-page");
        URL.revokeObjectURL(pages[i].url);
        pages.splice(i, 1);
        if (scanSettings.systemHints) {
          const hints = {};
          for (const [k, v] of Object.entries(scanSettings.systemHints)) if (+k !== i) hints[+k > i ? +k - 1 : k] = v;
          scanSettings.systemHints = hints;
        }
        renderPages();
        i--;
      }
      scanResumes = 0; // progress
      if (saved) await db.update(scanId, { images: pages.map((p) => p.blob), pages: pages.map((p) => p.xml ?? null), found: foundLayouts(), resumes: 0 }).catch(() => {});
    }
    pageLabel = "";
    const secs = Math.round((performance.now() - t0) / 1000);
    readSeconds = fresh ? secs : null;
    remember(readerLog, `Read ${plural(pages.length, "page")} in ${duration(secs)}${fresh ? "" : " (carried on from an earlier read)"}`, 40);
    setPageStatus(`Done in ${duration(secs)}`);
    track("read-ok", `${pages.length} page${pages.length === 1 ? "" : "s"}`);
    track(`read-ok (${deviceTag})`);
  } catch (e) {
    pageLabel = "";
    if (e instanceof Stopped) {
      // Not carried on by itself when the app next opens.
      if (saved) await db.update(scanId, { stopped: true }).catch(() => {});
      const done = pages.filter((p) => p.xml).length;
      setEngineStatus("");
      setPageStatus(
        rereading
          ? "Stopped. The score is as it was."
          : `Stopped${done ? ` after ${done} of ${pages.length} pages` : ""}. Tap Read music to carry on.`,
      );
      return;
    }
    track("read-failed");
    track(`read-failed (${deviceTag})`);
    track(`read-failed (${deviceTag}): ${failureReason(e)}`);
    // A long error ends with the actual error; show that first, since the
    // whole message can run off the bottom of a phone screen.
    const lines = e.message.trim().split("\n");
    const why = lines.length > 1 ? `${lines.at(-1)}\n\n${e.message}` : e.message;
    const page = pages.findIndex((p) => !p.xml) + 1;
    setPageStatus(
      NO_MUSIC.test(e.message)
        ? `Page ${page} doesn't look like sheet music.\nRetake the photo straight on, in good light, or remove it (×) and press Read music again.`
        : `Couldn't read page ${page}: ${why}`,
    );
    return;
  } finally {
    reading = false;
    $("scan").classList.remove("reading");
    stopReading = null;
    $("systems-check").hidden = true;
    $("read-step").hidden = true;
    $("read-hint").hidden = true;
    $("recognise").textContent = "Read music";
    $("recognise").disabled = pages.length === 0;
    release();
  }
  const entry = scanEntry(false);
  if (readSeconds) entry.readSeconds = readSeconds;
  saved = await db.put(entry).then(() => true, () => false);
  if (!saved) setPageStatus("Read OK, but couldn't save it on this phone (storage full?).");
  scanId = null;
  rereading = false;
  // If they've gone back to the library meanwhile, it's just added there.
  if (!$("scan").hidden) openScore(entry, "replace");
  else renderLibrary();
}

$("open-xml").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (files.length) openFiles(files);
};

// Score files (shared from Partsong) and MusicXML, from the picker or the
// share sheet; an ordinary PDF starts a new scan.
async function openFiles(files) {
  try {
    const xmls = [];
    const pdfs = [];
    let name = "";
    for (const f of files) {
      const shared = await readScoreFile(f);
      if (shared) {
        await importScore(shared);
        continue;
      }
      if (await isPdf(f)) {
        pdfs.push(f);
        continue;
      }
      const text = await f.text();
      try {
        parsePage(text);
      } catch {
        throw new Error(`${f.name || "it"} isn't a Partsong score, a PDF or a MusicXML file`);
      }
      xmls.push(text);
      name ||= f.name.replace(/\.(musicxml|xml)$/i, "");
    }
    // An ordinary PDF is sheet music to read: its pages, to look over before
    // Read music (step 1 of 3, as with photos).
    if (pdfs.length) {
      loadScan();
      if ((await addFiles(pdfs)) && pages.length) setPageStatus("Check the pages, then tap Read music.");
    }
    if (!xmls.length) return;
    const title = parsePage(xmls[0]).title || name || "Imported score";
    await importScore({ id: crypto.randomUUID(), title, created: Date.now(), pages: xmls, images: [] });
  } catch (err) {
    $("library-status").textContent = `Couldn't open that file: ${err.message}`;
  }
}

// Imports never overwrite: a score already here (same id or same name) is
// kept, and the new one gets a fresh id and a numbered name, "Title (2)".
async function asNewScore(entry) {
  const lib = await db.all();
  if (lib.some((e) => e.id === entry.id)) entry.id = crypto.randomUUID();
  const titles = new Set(lib.map((e) => e.title));
  const base = entry.title;
  for (let n = 2; titles.has(entry.title); n++) entry.title = `${base} (${n})`;
  return entry;
}

async function importScore(entry) {
  await db.put(await asNewScore(entry));
  openScore(entry);
}

// Shares a library score as a link (through the relay, see share.js), or as
// the PDF when the relay couldn't take it. Preparing can outlast
// the browser's "just tapped" window for the share sheet; then it's kept and
// the next tap shares it straight away.
// How a share reports progress: on the button itself when it has words
// (Preparing… / Ready to share / Shared ✓, then its label again; errors in the
// error banner), or on a status line for the icon buttons.
function shareReporter(button, status, label) {
  clearTimeout(button.revert);
  if (!status) {
    return (kind, long, short) => {
      clearTimeout(button.revert);
      if (kind === "error") showError(long);
      button.textContent = kind === "error" || kind === "idle" ? label : short;
      if (kind === "done") button.revert = setTimeout(() => (button.textContent = label), 2500);
    };
  }
  return (kind, long) => {
    clearTimeout(button.revert);
    status.textContent = long;
    if (kind !== "busy" && kind !== "ready") button.revert = setTimeout(() => (status.textContent = ""), 4000);
  };
}

let prepared = null; // { id, file, link, title }

// The link a score was last shared with, kept with the score, while it still
// matches (same fingerprint) and has time to run on the relay.
// A stored score with the open score's live settings on top (tempo and the
// others' volume are only saved when a slider is let go).
function liveEntry(entry) {
  if (!entry || entry.id !== current?.id) return entry;
  const live = { ...entry, tempo: Number($("tempo").value), others: Number($("others").value) };
  for (const k of ["title", "mine", "excluded", "manual", "markedStaff", "octave", "locked", "repeats", "playRepeats", "layout"]) if (current[k] !== undefined) live[k] = current[k];
  return live;
}

async function reusableLink(entry, key) {
  const kept = entry.shareLink;
  return kept && kept.key === (key ?? (await shareKey(entry))) && Date.now() - kept.at < LINK_REUSE_MS ? kept.link : null;
}
async function rememberLink(id, shareLink) {
  await db.update(id, { shareLink }).catch(() => {});
  if (current?.id === id) current.shareLink = shareLink;
  updateShareReady();
}

// Share buttons look "ready" when a tap will share at once (a kept link, or
// audio already made for these settings), and plain when it has to prepare.
async function updateShareReady() {
  if (!current) return;
  const entry = liveEntry((await db.all()).find((e) => e.id === current.id));
  $("share-score").classList.toggle("ready", !!(entry && (await reusableLink(entry))));
  $("share-audio").classList.toggle("ready", !!preparedAudio && preparedAudio.key === audioKey());
}
async function shareScore(id, button, status, label) {
  const say = shareReporter(button, status, label);
  button.disabled = true;
  try {
    if (prepared?.id !== id) {
      const entry = liveEntry((await db.all()).find((e) => e.id === id));
      const key = await shareKey(entry);
      // Unchanged since it was last shared: the same link, straight away.
      const kept = await reusableLink(entry, key);
      if (kept) prepared = { id, link: kept, file: null, title: entry.title };
      else {
        say("busy", "Preparing to share…", "Preparing…");
        prepared = { id, ...(await shareableScore(entry)), title: entry.title };
        if (prepared.link) await rememberLink(id, { key, link: prepared.link, at: Date.now() });
      }
    }
    const linked = !!prepared.link;
    const why = prepared.why;
    const how = linked ? await shareLink(prepared.link, prepared.title) : await shareFile(prepared.file, prepared.title);
    if (how === "shared" || how === "downloaded" || how === "copied") track(linked ? "share" : "share-pdf");
    if (how !== "retry") prepared = null;
    if (how === "retry") say("ready", "Ready to share: tap again.", "Ready to share");
    else if (how === "cancelled") say("idle", "");
    else if (how === "copied") say("done", "Name and link copied: paste them into a message.", "Link copied ✓");
    else if (!linked) {
      // No link: say why, and that the PDF is what to send instead.
      const where = how === "downloaded" ? "saved the PDF to Downloads" : "shared the PDF";
      const long = `Couldn't make a link (${why ?? "the link service didn't respond"}), so Partsong ${where} instead: send that file, which opens in Partsong.`;
      say("done", long, how === "downloaded" ? "Saved PDF ✓" : "Shared as PDF ✓");
      if (!status) showError(long);
    } else if (how === "downloaded") say("done", "Saved to Downloads.", "Saved ✓");
    else say("done", "Shared.", "Shared ✓");
  } catch (e) {
    prepared = null;
    say("error", `Couldn't share: ${e.message}`);
  } finally {
    button.disabled = false;
  }
}

$("share").onclick = () => shareScore(current.id, $("share"), $("share-status"));

// An audio file of what Play plays (bars, repeats, your part, the others'
// volume, sound, tempo and pitch), rendered offline, to share: e.g. for
// someone to learn their part from on the way to rehearsal. The share sheet
// only opens within a few seconds of a tap, and rendering can take longer on a
// phone; then the file is kept ("Ready to share: tap again") until anything
// that's heard changes.
const SHARE_AUDIO = "Send a recording of my part";
const SHARE_SCORE = "Send a link to another singer";
const EXPORT_PDF = "Save as a PDF file";
let preparedAudio = null; // { key, file, part }
function audioKey() {
  return JSON.stringify([current?.id, playSegments(), current.mine, current.manual, current.excluded, current.octave, othersGain, $("instrument").value, $("tempo").value]);
}
// A prepared file that no longer matches the settings is dropped.
function updateAudioButton() {
  if (preparedAudio && preparedAudio.key !== audioKey()) {
    preparedAudio = null;
    clearTimeout($("share-audio").revert);
    $("share-audio").textContent = SHARE_AUDIO;
  }
  updateShareReady();
}
$("share-audio").onclick = async () => {
  const button = $("share-audio");
  const say = shareReporter(button, null, SHARE_AUDIO);
  button.disabled = true;
  try {
    const key = audioKey();
    if (preparedAudio?.key !== key) {
      say("busy", "Preparing to share…", "Preparing…");
      const part = hasMarks() ? "my part" : (score.lines[current.mine]?.label ?? "part");
      const renderer = new Player(score);
      renderer.mix = player.mix;
      renderer.bpm = Number($("tempo").value);
      renderer.instrument = $("instrument").value;
      const name = `${current.title} - ${part}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
      preparedAudio = { key, part, file: await audioFile(await renderer.render(playSegments(), AUDIO_RATE), name) };
      button.classList.add("ready");
    }
    const how = await shareFile(preparedAudio.file, `${current.title} (${preparedAudio.part})`);
    if (how === "shared" || how === "downloaded") track("share-audio");
    if (how === "retry") say("ready", "", "Ready to share");
    else if (how === "cancelled") say("idle", "");
    else say("done", "", how === "downloaded" ? "Saved ✓" : "Shared ✓");
  } catch (e) {
    preparedAudio = null;
    say("error", `Couldn't make the audio: ${e.message}`);
  } finally {
    button.disabled = false;
  }
};

// The same link share as the icon by the title.
$("share-score").onclick = () => shareScore(current.id, $("share-score"), null, SHARE_SCORE);

// The score as a .partsong.pdf (pages, with the score inside): a copy to keep,
// print or send that doesn't expire. Kept while unchanged if the share sheet
// needs a fresh tap.
let preparedPdf = null; // { key, file }
$("export-pdf").onclick = async () => {
  const button = $("export-pdf");
  const say = shareReporter(button, null, EXPORT_PDF);
  button.disabled = true;
  try {
    const entry = liveEntry((await db.all()).find((e) => e.id === current.id));
    const key = `${entry.id} ${await shareKey(entry)}`;
    if (preparedPdf?.key !== key) {
      say("busy", "", "Preparing…");
      preparedPdf = { key, file: await scoreFile(entry) };
    }
    const how = await shareFile(preparedPdf.file, entry.title);
    if (how === "shared" || how === "downloaded") track("export-pdf");
    if (how !== "retry") preparedPdf = null;
    if (how === "retry") say("ready", "", "Ready: tap again");
    else if (how === "cancelled") say("idle", "");
    else say("done", "", how === "downloaded" ? "Saved ✓" : "Done ✓");
  } catch (e) {
    preparedPdf = null;
    say("error", `Couldn't make the PDF: ${e.message}`);
  } finally {
    button.disabled = false;
  }
};

// A copy of a score (photos, music, marks, settings), unlocked and named
// "Title (2)", added to the list (rename it when you open it), e.g. to mark up
// first and second sopranos as separate scores.
async function copyScore(id) {
  const original = (await db.all()).find((e) => e.id === id);
  const copy = await asNewScore({ ...original, id: crypto.randomUUID(), created: Date.now(), locked: false });
  await db.put(copy);
  await renderLibrary();
  document.querySelector(`#library li[data-id="${copy.id}"]`)?.classList.add("just-added");
  $("library-status").textContent = `Copied as “${copy.title}”. Open it to rename.`;
  clearTimeout(shareScore.timer);
  shareScore.timer = setTimeout(() => ($("library-status").textContent = ""), 5000);
}

// A score shared by link (#s=<id>.<key>): fetched from the relay and
// decrypted, then offered like any other. If the relay can't supply it, say
// what to do: try again, or ask for it again (a link lasts a year).
async function receiveFromRelay() {
  const fragment = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  $("library-status").textContent = "Fetching the shared score…";
  let entry = null;
  let failure = "";
  for (let attempt = 0; attempt < 2 && !entry && !failure.includes("404"); attempt++) {
    entry = await entryFromRelay(fragment).catch((e) => ((failure = e.message), null));
    if (!entry && !attempt) await new Promise((r) => setTimeout(r, 3000));
  }
  $("library-status").textContent = "";
  if (entry) offerImport(entry);
  else
    showNotice(
      failure.includes("404")
        ? "This link has expired (links last a year). Ask for the score to be shared again."
        : "Couldn't fetch this score just now. Check your connection and tap the link again.",
    );
}

// A score handed over by an older .partsong.html file opened in the browser (from
// WhatsApp, email…): carried in the link itself (#import=…, without photos)
// and, with &receive, posted in full by the page that opened us when it can
// (an installed app opened from the link has no way back to that page). Older
// files sent only #receive. Always asks first, since any page could try this.
async function receiveFromPage() {
  const hash = location.hash;
  history.replaceState(null, "", location.pathname);
  let entry = null;
  try {
    const [, payload, receive] = hash.match(/^#import=([\w-]+)(&receive)?/) ?? [];
    // Files from before the link carried the score: nothing to fall back on.
    if (hash === "#receive" && !window.opener) throw new Error("it was sent from an older version of Partsong. Ask for it to be shared again");
    if ((receive || hash === "#receive") && window.opener) {
      const json = await fromOpener().catch(() => null);
      if (json) entry = parseScoreFile(json);
    }
    if (!entry && payload) entry = await entryFromLink(payload);
    if (!entry) throw new Error("the score didn't arrive");
  } catch (e) {
    showError(`Couldn't open the shared score: ${e.message}`);
  }
  if (entry?.photosLeftOut) {
    // Only the music came through the link (the installed app can't reach the
    // file's page): don't add a copy without its photos.
    showNotice(
      `“${entry.title}” has photos of its pages, which can't come across this way. ` +
        "Go back to the message, press and hold the file, tap Share and choose Partsong.",
    );
  } else if (entry) offerImport(entry);
}

function showNotice(text) {
  $("import-question").textContent = text;
  $("import-yes").hidden = true;
  $("import-no").textContent = "OK";
  $("import-no").onclick = () => ($("import-offer").hidden = true);
  $("import-offer").hidden = false;
}

// The full score (with photos) posted by the .partsong.html page that opened us.
function fromOpener() {
  return new Promise((resolve, reject) => {
    addEventListener("message", (e) => {
      if (e.source !== window.opener || e.data?.type !== "partsong-score") return;
      clearInterval(ping);
      resolve(e.data.json);
    });
    const ping = setInterval(() => window.opener?.postMessage("partsong-ready", "*"), 250);
    setTimeout(() => {
      clearInterval(ping);
      reject(new Error("the score didn't arrive"));
    }, 8000);
  });
}

// done() runs once the question is answered either way; if it returns false
// the score is no longer on offer (another window took it).
async function offerImport(entry, done = () => {}) {
  await asNewScore(entry);
  const pages = `${entry.pages.length} page${entry.pages.length === 1 ? "" : "s"}`;
  $("import-question").textContent = `Add “${entry.title}” (${pages}) to your scores?`;
  $("import-yes").hidden = false;
  $("import-no").textContent = "Cancel";
  $("import-offer").hidden = false;
  $("import-yes").onclick = async () => {
    $("import-offer").hidden = true;
    if ((await done()) === false) return;
    await importScore(entry);
  };
  $("import-no").onclick = () => {
    $("import-offer").hidden = true;
    done();
  };
}

// Files shared to the installed app arrive via the service worker's inbox.
// A score file asks first, as from its page's link, and stays in the inbox
// until answered: Android can launch the app twice for one share, and the
// second launch reloads the page.
async function openInbox() {
  const cache = await caches.open("partscanner-inbox");
  const keys = await cache.keys();
  if (!keys.length) return;
  const scans = [];
  const others = [];
  for (const req of keys) {
    const res = await cache.match(req);
    const name = decodeURIComponent(res.headers.get("x-name") || "shared");
    const f = new File([await res.blob()], name, { type: res.headers.get("content-type") || "" });
    const shared = await readScoreFile(f).catch(() => null);
    if (shared) {
      await offerImport(shared, () => cache.delete(req));
      continue;
    }
    if (!(await cache.delete(req))) continue; // another window took it
    if (f.type.startsWith("image/") || (await isPdf(f))) scans.push(f);
    else others.push(f);
  }
  if (others.length) await openFiles(others);
  if (scans.length) {
    loadScan();
    await addFiles(scans);
  }
}

// A share can land after the page has looked (see above), or while it's in
// the background: look again when told, and when it comes back to the screen.
navigator.serviceWorker?.addEventListener("message", (e) => e.data?.type === "inbox" && openInbox());
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && "caches" in window && openInbox());

// ---------- practice ----------

let player;
let playTracked = false; // count the first play of each opened score only
let current; // library entry
let score;

// How bars are lined up across parts. Marks and repeat starts are saved by
// system and bar number, so a score saved under an earlier layout has them
// moved to the system or bar in the same place on its page (layout 2: bars
// lined up system by system, which can drop a misread extra bar or system).
// Layout 3: a pair of staves read as one goes back on two, which can change
// the parts, so the saved part choices (line ids) move to the same music.
const LAYOUT = 3;
function migrateLayout(entry) {
  const was = entry.layout ?? 1;
  if (was >= LAYOUT) return;
  entry.layout = LAYOUT;
  const refs = [entry.manual, entry.markedStaff, entry.repeats].some((o) => o && Object.keys(o).length);
  if (was < 2 && refs) {
    const old = buildScore(entry.pages.map((x) => parsePage(x, { restaff: false })), { legacyAlign: true });
    const sys = placeMap(old.systems, score.systems);
    const bar = placeMap(old.measures, score.measures);
    const move = (o, key, value = (v) => v) => {
      if (!o) return o;
      // Larger old systems last, so a misread one-bar system doesn't win.
      const keys = Object.keys(o).sort((a, b) => (old.systems[a]?.bars.length ?? 0) - (old.systems[b]?.bars.length ?? 0));
      return Object.fromEntries(keys.map((k) => [key(k), value(o[k])]).filter(([k]) => k != null));
    };
    entry.manual = move(entry.manual, (k) => sys.get(Number(k)));
    entry.markedStaff = move(entry.markedStaff, (k) => sys.get(Number(k)));
    // repeats: bar number (1-based) -> bar it goes back to (1-based)
    const barNo = (n) => { const i = bar.get(Number(n) - 1); return i == null ? null : i + 1; };
    entry.repeats = entry.repeats && Object.fromEntries(Object.entries(entry.repeats).map(([k, v]) => [barNo(k), barNo(v) ?? v]).filter(([k]) => k != null));
  }
  moveLines(entry); // after the marks have moved to this layout's systems
  updateEntry(entry.id, { layout: entry.layout, manual: entry.manual, markedStaff: entry.markedStaff, repeats: entry.repeats, mine: entry.mine, excluded: entry.excluded });
}

// Saved part choices (your part, parts switched off, marks) are line ids:
// re-point each at the line now holding most of its notes, and each mark's
// staff at the staff that line is on in that system, nearest the old one.
function moveLines(entry) {
  const used = entry.mine != null || entry.excluded?.length || Object.keys(entry.manual ?? {}).length;
  if (!used) return;
  const old = buildScore(entry.pages.map((x) => parsePage(x, { restaff: false })));
  const sig = (s) => JSON.stringify(s.lines.map((l) => [l.label, l.staffKey, l.voice, l.notes.length]));
  if (sig(old) === sig(score)) return;
  const notes = score.lines.map((l) => new Set(l.notes.map((n) => `${n.t}:${n.midi}`)));
  const line = (id) => {
    const from = old.lines[id];
    if (!from) return id;
    let best = null;
    let most = 0;
    notes.forEach((set, j) => {
      const n = from.notes.filter((x) => set.has(`${x.t}:${x.midi}`)).length;
      if (n > most || (n === most && n && score.lines[j].label === from.label)) [best, most] = [j, n];
    });
    return best ?? id;
  };
  if (entry.mine != null) entry.mine = line(entry.mine);
  if (entry.excluded) entry.excluded = [...new Set(entry.excluded.map(line))];
  if (!entry.manual) return;
  const markedStaff = {};
  entry.manual = Object.fromEntries(
    Object.entries(entry.manual).map(([sys, id]) => {
      const to = line(id);
      const was = old.systems[sys]?.staves.find((st) => st.key === entry.markedStaff?.[sys]) ?? old.systems[sys]?.staves.find((st) => st.lines.includes(id));
      const mid = was && (was.y0 + was.y1) / 2;
      const staff = score.systems[sys]?.staves
        .filter((st) => st.lines.includes(to))
        .sort((a, b) => (mid == null ? 0 : Math.abs((a.y0 + a.y1) / 2 - mid) - Math.abs((b.y0 + b.y1) / 2 - mid)))[0];
      if (staff) markedStaff[sys] = staff.key;
      return [sys, to];
    }),
  );
  entry.markedStaff = markedStaff;
}

// Index in `to` of the item (system or bar, with page and box) in the same
// place as each item of `from`: same page, most vertical overlap, then
// nearest left edge. Without boxes, the same index.
function placeMap(from, to) {
  const map = new Map();
  from.forEach((a, i) => {
    if (!a.box) return to[i] && map.set(i, i);
    let best = null;
    let bestScore = -Infinity;
    to.forEach((b, j) => {
      if (!b.box || b.page !== a.page) return;
      const overlap = Math.min(a.box.y1, b.box.y1) - Math.max(a.box.y0, b.box.y0);
      const score = overlap - Math.abs(a.box.x0 - b.box.x0) * 1e-3;
      if (overlap > 0 && score > bestScore) (best = j), (bestScore = score);
    });
    if (best != null) map.set(i, best);
  });
  return map;
}

function openScore(entry, nav = "push") {
  const partChosen = entry.mine != null || Object.keys(entry.manual ?? {}).length > 0; // before defaults below
  current = entry;
  score = buildScore(entry.pages.map(parsePage));
  migrateLayout(entry);
  player?.stop();
  player = new Player(score);
  playTracked = false;
  player.onPosition = (beat) => {
    $("position").textContent = `Bar ${barAt(beat).number}`;
    follow(beat);
    followRead(beat);
  };
  player.onEnd = () => setPlaying(false);
  player.mix = (lineId, t) => {
    if (lineId === myLineAt(t)) return { gain: 1, shift: 12 * current.octave };
    // Marked scores play every line, except a piano part left switched off.
    if (current.excluded.includes(lineId) && (!hasMarks() || score.lines[lineId].accompaniment)) return { gain: 0 };
    return { gain: othersGain, shift: 0 };
  };

  $("title").value = entry.title;
  $("share-status").textContent = "";
  for (const [id, label] of [["share-audio", SHARE_AUDIO], ["share-score", SHARE_SCORE], ["export-pdf", EXPORT_PDF]]) {
    clearTimeout($(id).revert);
    $(id).textContent = label;
  }
  $("to-bar").value = score.measures.length;
  $("from-bar").value = 1;
  $("from-bar").max = $("to-bar").max = score.measures.length;
  $("tempo").value = entry.tempo ?? 80;
  $("others").value = entry.others ?? 25;
  const soprano = score.lines.findIndex((l) => l.label === "Soprano");
  current.mine = Math.min(entry.mine ?? Math.max(0, soprano), score.lines.length - 1);
  current.excluded = entry.excluded ?? score.lines.filter((l) => l.accompaniment).map((l) => l.id);
  current.manual = entry.manual ?? {};
  current.markedStaff = entry.markedStaff ?? {};
  repairReferences();
  current.octave = entry.octave ?? 0;
  $("octave").value = String(current.octave);
  current.repeats = entry.repeats ?? {};
  current.playRepeats = entry.playRepeats ?? true;
  renderRepeats();
  showAllParts = false;
  renderLines();
  renderPartChoice();
  applyLock();
  applyMix();
  updateLabels();
  player.bpm = Number($("tempo").value);
  player.instrument = $("instrument").value;
  $("position").textContent = "Bar 1";
  setPlaying(false);
  resumeAt = null;
  $("osmd").replaceChildren();
  osmdFor = null;
  show("practice", nav);
  // New scans (no part chosen yet) and photo-less scores start with settings open.
  $("panel").hidden = $("panel-backdrop").hidden = true;
  setPanel(!partChosen || !entry.images?.length);
  renderFollow();
  // Pages (photos) when there are any to follow along on; otherwise the read score.
  $("view-toggle").hidden = $("follow").hidden;
  setView($("follow").hidden ? "read" : "pages");
}

// ---------- following along on the photos ----------

const SVG = "http://www.w3.org/2000/svg";
const MAX_SIDE = 4200; // must match normalise(): homr's coordinates are in that space
let pageViews = []; // per page: { svg, bar, playhead, note, w, h }
let followedBar = null;

function svgEl(tag, cls) {
  const el = document.createElementNS(SVG, tag);
  el.setAttribute("class", cls);
  el.style.display = "none";
  return el;
}

function renderFollow() {
  releasePhotos("practice");
  followedBar = null;
  pageViews = [];
  const images = current.images ?? [];
  $("follow").hidden = !images.length || !score.measures.some((m) => m.box);
  $("photo-list").replaceChildren(
    ...images.flatMap((blob, p) => {
      const div = document.createElement("div");
      div.className = "page";
      const img = document.createElement("img");
      img.alt = `Page ${p + 1}`;
      img.src = photoUrl("practice", blob);
      const svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("preserveAspectRatio", "none");
      const view = { svg, marks: document.createElementNS(SVG, "g"), fix: document.createElementNS(SVG, "g"), bar: svgEl("rect", "bar"), playhead: svgEl("line", "playhead"), note: svgEl("circle", "note") };
      svg.append(view.marks, view.fix, view.bar, view.playhead, view.note);
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        view.w = img.naturalWidth * scale;
        view.h = img.naturalHeight * scale;
        svg.setAttribute("viewBox", `0 0 ${view.w} ${view.h}`);
        if (p === 0) showBar(barRange()[0]);
        renderMarks();
        renderFix();
      };
      svg.onclick = (e) => (fixing ? fixTap(p, e) : marking ? toggleMark(p, e) : pickBar(p, e));
      pageViews.push(view);
      // Shown while checking systems: the page's number, under a red bar like
      // a system split (a new page always starts a new system).
      const label = document.createElement("p");
      label.className = "page-label";
      label.textContent = `Page ${p + 1}`;
      div.append(img, svg);
      return [label, div];
    }),
  );
}

function padded(box, view) {
  const px = view.w * 0.015;
  const py = view.h * 0.025;
  return { x: box.x0 - px, y: box.y0 - py, w: box.x1 - box.x0 + 2 * px, h: box.y1 - box.y0 + 2 * py };
}

function showEl(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.style.display = "";
}
const hide = (el) => (el.style.display = "none");

// Highlights the bar at `beat`; while playing also moves the playhead and
// marks the note your part is singing.
function follow(beat, playing = true) {
  const bar = barAt(beat);
  if (!bar.area) return;
  const view = pageViews[bar.page];
  if (!view?.w) return;
  if (bar !== followedBar) {
    for (const v of pageViews) [v.bar, v.playhead, v.note].forEach(hide);
    const r = padded(bar.area, view);
    showEl(view.bar, { x: r.x, y: r.y, width: r.w, height: r.h, rx: view.w * 0.006 });
    followedBar = bar;
    if (playing) keepInView(view.bar);
  }
  if (!playing) return;

  const r = padded(bar.area, view);
  const onsets = bar.onsets;
  const i = onsets.findLastIndex((o) => o.t <= beat + 1e-6);
  const from = i >= 0 ? onsets[i] : { t: bar.start, x: r.x };
  const to = onsets[i + 1] ?? { t: bar.start + bar.length, x: r.x + r.w };
  const x = from.x + ((to.x - from.x) * (beat - from.t)) / Math.max(1e-6, to.t - from.t);
  showEl(view.playhead, { x1: x, x2: x, y1: r.y, y2: r.y + r.h });

  const mine = myLineAt(beat);
  const note = mine != null && score.lines[mine]?.notes.find((n) => n.t <= beat + 1e-6 && beat < n.t + n.dur);
  if (note?.pos && note.pos.page === bar.page) {
    // Across the bar, the onset's average position is steadier than one note's.
    const cx = onsets.find((o) => Math.abs(o.t - note.t) < 1e-6)?.x ?? note.pos.x;
    showEl(view.note, { cx, cy: note.pos.y, r: view.w * 0.011 });
  } else hide(view.note);
}

function showBar(beat) {
  followedBar = null;
  follow(beat, false);
  readBar = null;
  followRead(beat, false);
}

function keepInView(el) {
  const r = el.getBoundingClientRect();
  const top = document.querySelector("header").offsetHeight;
  const bottom = $("panel").hidden
    ? window.innerHeight - document.querySelector(".transport").offsetHeight
    : $("panel").getBoundingClientRect().top;
  if (r.top >= top && r.bottom <= bottom) return;
  window.scrollBy({ top: r.top - top - Math.max(0, (bottom - top - r.height) / 3), behavior: "smooth" });
}

// Tap position in the photo's coordinates.
function tapPoint(page, e) {
  const view = pageViews[page];
  const rect = view.svg.getBoundingClientRect();
  return { view, x: ((e.clientX - rect.left) / rect.width) * view.w, y: ((e.clientY - rect.top) / rect.height) * view.h };
}

// Tap a bar on a photo to start from it.
function pickBar(page, e) {
  const { view, x, y } = tapPoint(page, e);
  let best = null;
  let bestDist = Infinity;
  for (const bar of score.measures) {
    if (bar.page !== page || !bar.area) continue;
    const r = bar.area; // not padded: the padding reaches into the next system
    const dx = Math.max(r.x0 - x, 0, x - r.x1);
    const dy = Math.max(r.y0 - y, 0, y - r.y1);
    const d = dx * dx + dy * dy;
    if (d < bestDist) [best, bestDist] = [bar, d];
  }
  if (!best) return;
  $("from-bar").value = best.number;
  if (Number($("to-bar").value) < best.number) $("to-bar").value = score.measures.length;
  $("from-bar").onchange();
}

// ---------- your part: auto (one line) or manual (marked per system) ----------

let othersGain = 0.25;

// Marks (staff per system, set in mark-up mode) take precedence over the
// list choice whenever there are any, so nothing is lost by a stray tap.
const hasMarks = () => Object.keys(current.manual).length > 0;

// Scores saved by an older version can refer to lines or systems that no
// longer exist once the music is re-analysed; drop those references.
function repairReferences() {
  const okLine = (id) => Number.isInteger(Number(id)) && Number(id) >= 0 && Number(id) < score.lines.length;
  const manual = Object.fromEntries(
    Object.entries(current.manual).filter(([sys, id]) => okLine(id) && Number(sys) < score.systems.length),
  );
  const excluded = current.excluded.filter(okLine);
  const changed = Object.keys(manual).length !== Object.keys(current.manual).length || excluded.length !== current.excluded.length;
  if (!okLine(current.mine)) {
    const soprano = score.lines.findIndex((l) => l.label === "Soprano");
    current.mine = Math.max(0, soprano);
  }
  current.manual = manual;
  current.excluded = excluded;
  if (changed) updateEntry(current.id, { manual, excluded, mine: current.mine });
}

function myLineAt(beat) {
  if (!hasMarks()) return current.mine;
  return current.manual[barAt(beat).system] ?? null;
}

// The list of parts is clearly wrong when a part's name comes up twice, or
// there are more sung lines than any choir score has (layouts that change
// between pages, e.g. Christ Is King: 16 lines, two of each SATB name). Then
// the panel shows how to get your part (Fix systems, then mark) instead.
let showAllParts = false;
function partsDoubtful() {
  const names = score.lines.filter((l) => !l.accompaniment).map((l) => l.label);
  return new Set(names).size < names.length || names.length > 8;
}

function renderPartChoice() {
  const marked = Object.keys(current.manual).length;
  const doubt = partsDoubtful() && !showAllParts;
  // Systems you checked before reading aren't sent back to be checked again.
  const canFix = !!current.images?.length && !current.systemsChecked;
  $("parts-doubt").hidden = !doubt;
  $("parts-list").hidden = doubt;
  $("parts-show").hidden = !doubt;
  $("show-parts").textContent = `Show the ${score.lines.length} parts it found`;
  $("doubt-fix-step").hidden = !canFix;
  $("doubt-intro").textContent = canFix
    ? "Its layout changes from page to page. Two steps get you your part exactly:"
    : current.images?.length
      ? "Its layout changes from page to page. Mark the staff you sing on the music:"
      : "Mark the staff you sing on the music instead:";
  $("doubt-mark-title").textContent = canFix ? "2. Mark your part" : "Mark your part";
  $("fix-link").hidden = !current.images?.length || (doubt && marked === 0 && canFix);
  $("auto-part").hidden = marked > 0;
  $("marked-part").hidden = marked === 0;
  $("marked-count").textContent = `${marked} of ${score.systems.length} systems`;
  $("tap-hint").textContent = fixing ? "Red lines are where Partsong thinks one line of music (system) ends and the next begins. Tap between two staves to add or remove a line." : marking ? "Tap the staff you sing in each system." : "Tap a bar to start from there.";
}

// The sound is a preference for this device, not part of a score.
const INSTRUMENT_KEY = "partsong-instrument";
try {
  const saved = localStorage.getItem(INSTRUMENT_KEY);
  if ([...$("instrument").options].some((o) => o.value === saved)) $("instrument").value = saved;
} catch {}
$("instrument").onchange = () => {
  if (player) player.instrument = $("instrument").value;
  try {
    localStorage.setItem(INSTRUMENT_KEY, $("instrument").value);
  } catch {}
};

$("octave").onchange = () => {
  current.octave = Number($("octave").value);
  updateEntry(current.id, { octave: current.octave });
};

// markedStaff: which staff each mark was made on (system -> staff key), for
// shading it: one line can run over two staves of a system when the reader
// files them under one part.
function setMarks(manual, markedStaff = {}) {
  current.manual = manual;
  current.markedStaff = markedStaff;
  updateEntry(current.id, { manual, markedStaff });
  renderPartChoice();
  renderMarks();
}

$("clear-marks").onclick = () => {
  const b = $("clear-marks");
  if (b.dataset.confirm !== "1") {
    b.dataset.confirm = "1";
    b.textContent = "Tap again to clear";
    setTimeout(() => {
      b.dataset.confirm = "";
      b.textContent = "Clear marks";
    }, 3000);
    return;
  }
  b.dataset.confirm = "";
  b.textContent = "Clear marks";
  setMarks({});
};

// ---------- mark-up mode ----------

let marking = false;
let fixing = false; // marking systems (Fix systems) rather than your part

function startMarkup(mode = "part") {
  if ($("view-toggle").hidden) return;
  setView("pages");
  player.stop();
  // Reuse the open panel's history entry (going back then pushing would race).
  const fromPanel = history.state?.panel;
  setPanel(false, false);
  marking = true;
  fixing = mode === "systems";
  document.body.classList.add("marking");
  document.body.classList.toggle("fixing", fixing);
  $(fixing ? "fix-bar" : "markup-bar").hidden = false;
  if (fixing) startFix();
  const state = { screen: "practice", markup: true };
  if (fromPanel) history.replaceState(state, "");
  else history.pushState(state, "");
  renderPartChoice();
  window.scrollTo({ top: $("follow").offsetTop - 60, behavior: "smooth" });
}
$("start-markup").onclick = () => startMarkup();
$("doubt-mark").onclick = () => startMarkup();
$("doubt-fix").onclick = () => startMarkup("systems");
$("show-parts").onclick = () => {
  showAllParts = true;
  renderPartChoice();
};
$("edit-markup").onclick = () => startMarkup();

// nav=false when the back button already left the mark-up history entry.
function endMarkup(nav = true) {
  if (!marking) return;
  marking = false;
  fixing = false;
  document.body.classList.remove("marking", "fixing");
  $("markup-bar").hidden = $("fix-bar").hidden = true;
  renderFix();
  if (nav && history.state?.markup) history.back();
  renderPartChoice();
}
$("markup-done").onclick = () => endMarkup();

// ---------- Check and fix systems: where one system ends and the next begins ----------
// For pages the reader grouped wrongly (parts then play out of step). Each
// page shows its staves' gaps: a red line where Partsong ends a system, a
// dotted one inside a system; a tap switches the nearest gap. Changed pages
// are read again with those systems, kept with the score (systemHints: page
// -> [top, bottom] ranges in photo coordinates, one per system).

let fixDraft = {}; // page -> { rows: [{ y0, y1 }], splits: [bool per gap], initial }

// A page's staves top to bottom, one per row (a row the reader split across
// two systems side by side counts once), and whether the reader starts a new
// system at each gap between them.
function pageRows(page, systems = score.systems.filter((sys) => sys.page === page)) {
  const staves = systems
    .flatMap((sys) => sys.staves.filter((st) => Number.isFinite(st.y0) && Number.isFinite(st.y1)).map((st) => ({ y0: st.y0, y1: st.y1, sys: sys.index })))
    .sort((a, b) => a.y0 - b.y0);
  const rows = [];
  for (const st of staves) {
    const last = rows.at(-1);
    const mid = (st.y0 + st.y1) / 2;
    if (last && mid < last.y1) {
      last.y1 = Math.max(last.y1, st.y1);
      last.systems.add(st.sys);
    } else rows.push({ y0: st.y0, y1: st.y1, systems: new Set([st.sys]) });
  }
  const splits = rows.slice(1).map((row, i) => ![...row.systems].some((s) => rows[i].systems.has(s)));
  return { rows: rows.map(({ y0, y1 }) => ({ y0, y1 })), splits, initial: splits.slice() };
}

function startFix() {
  fixDraft = {};
  for (let p = 0; p < pageViews.length; p++) fixDraft[p] = pageRows(p);
  renderFix();
}

function fixTap(page, e) {
  const { y } = tapPoint(page, e);
  if (toggleGap(fixDraft[page], y)) renderFix();
}

// Switches the gap between staves nearest y (a split or not).
function toggleGap(d, y) {
  if (!d?.splits.length) return false;
  const gap = (i) => (d.rows[i].y1 + d.rows[i + 1].y0) / 2;
  let nearest = 0;
  for (let i = 1; i < d.splits.length; i++) if (Math.abs(gap(i) - y) < Math.abs(gap(nearest) - y)) nearest = i;
  d.splits[nearest] = !d.splits[nearest];
  return true;
}

// A page's gaps as lines on its overlay: red where a system ends, dotted inside one.
function drawGaps(g, d, w) {
  g.replaceChildren();
  d.splits.forEach((split, i) => {
    const y = (d.rows[i].y1 + d.rows[i + 1].y0) / 2;
    const line = document.createElementNS(SVG, "line");
    for (const [k, v] of Object.entries({ class: split ? "fix-split" : "fix-gap", x1: w * 0.02, x2: w * 0.98, y1: y, y2: y })) line.setAttribute(k, v);
    g.append(line);
  });
}

// The systems a page's splits make, as y ranges reaching halfway to the
// neighbouring staves (the reader puts a staff in the range its middle is in).
function fixBands(d, h) {
  const bands = [];
  let start = 0;
  for (let i = 0; i < d.rows.length; i++) {
    if (i < d.splits.length && !d.splits[i]) continue;
    const top = start > 0 ? (d.rows[start - 1].y1 + d.rows[start].y0) / 2 : d.rows[start].y0 - h * 0.015;
    const bottom = i + 1 < d.rows.length ? (d.rows[i].y1 + d.rows[i + 1].y0) / 2 : d.rows[i].y1 + h * 0.015;
    bands.push([top, bottom]);
    start = i + 1;
  }
  return bands;
}

function renderFix() {
  for (const [p, view] of pageViews.entries()) {
    view.fix.replaceChildren();
    const d = fixDraft[p];
    if (fixing && view.w && d) drawGaps(view.fix, d, view.w);
  }
}

$("start-fix").onclick = () => startMarkup("systems");
$("fix-cancel").onclick = () => endMarkup();
$("fix-done").onclick = () => {
  // Pages whose splits were changed; the others keep how they were read.
  const changed = Object.entries(fixDraft)
    .filter(([, d]) => d.splits.some((x, i) => x !== d.initial[i]))
    .map(([p]) => Number(p));
  if (!changed.length || reading) return endMarkup();
  const hints = { ...(current.systemHints ?? {}) };
  for (const p of changed) hints[p] = fixBands(fixDraft[p], pageViews[p].h);
  // Stay on this history entry (going back here would land after the reading
  // screen opens and close it).
  history.replaceState({ screen: "practice" }, "");
  endMarkup(false);
  // Read just those pages again, as Read again does (the score stays as it
  // was until the reading is done).
  const { id, created, title, images, pages: xmls, pending: _pending, excluded: _excluded, ...settings } = liveEntry(current);
  prepared = preparedAudio = null;
  loadScan(images, xmls.map((x, i) => (changed.includes(i) ? null : x)), id, created, title);
  scanSettings = { ...settings, systemHints: hints };
  rereading = true;
  readScan();
};

// Tap a staff to mark it as yours in that system. Tapping the marked staff
// again steps upper voice -> lower voice -> unmarked (one-voice staff: unmarks).
function toggleMark(page, e) {
  const { x, y } = tapPoint(page, e);
  const gap = (a0, a1, v) => Math.max(a0 - v, 0, v - a1);
  // The staff nearest the tap on this page, whichever system it's in (systems
  // can overlap on the photo when the reader misjudges them).
  const cands = score.systems
    .filter((s) => s.page === page && s.box)
    .flatMap((sys) => sys.staves.map((staff) => ({ sys, staff, dy: gap(staff.y0, staff.y1, y), dx: gap(sys.box.x0, sys.box.x1, x) })))
    .sort((a, b) => a.dy - b.dy || a.dx - b.dx);
  const best = cands[0];
  if (!best) return;
  const { sys, staff } = best;
  const order = { upper: 0, only: 1, lower: 2 };
  const choices = staff.lines.slice().sort((a, b) => order[score.lines[a].voice] - order[score.lines[b].voice]);
  // The same staff can belong to two systems the reader split one row into:
  // mark (or unmark) it in each, starting over unless it's marked in all.
  const targets = [best, ...cands.filter((c) => c.sys !== sys && c.dy === 0 && best.dy === 0 && c.staff.key === staff.key)];
  const onStaff = (c) => c.staff.lines.includes(current.manual[c.sys.index]) && (current.markedStaff?.[c.sys.index] ?? c.staff.key) === c.staff.key;
  const everywhere = targets.every(onStaff);
  const now = everywhere ? choices.indexOf(current.manual[sys.index]) : -1;
  const next = now < 0 ? choices[0] : choices[now + 1];
  const manual = { ...current.manual };
  const markedStaff = { ...current.markedStaff };
  for (const c of targets) {
    delete manual[c.sys.index];
    delete markedStaff[c.sys.index];
    if (next == null) continue;
    const voice = score.lines[next].voice;
    manual[c.sys.index] = c.staff.lines.find((id) => score.lines[id].voice === voice) ?? c.staff.lines[0];
    markedStaff[c.sys.index] = c.staff.key;
  }
  setMarks(manual, markedStaff);
}

// Shades the staff you've marked in each system.
function renderMarks() {
  for (const [p, view] of pageViews.entries()) {
    view.marks.replaceChildren();
    if (!view.w) continue;
    for (const [sysIndex, lineId] of Object.entries(current.manual)) {
      const sys = score.systems[sysIndex];
      const line = score.lines[lineId];
      const tapped = sys?.page === p && sys.staves.find((st) => st.key === current.markedStaff?.[sysIndex] && st.lines.includes(Number(lineId)));
      const staff = tapped || (sys?.page === p && (sys.staves.find((st) => st.lines.includes(Number(lineId))) ?? sys.staves.find((st) => st.key === line?.staffKey)));
      if (!staff) continue;
      const px = view.w * 0.015;
      const py = view.h * 0.012;
      // The staff's own outline when the reader gave one (the whole line), else
      // the span of its notes.
      const x0 = staff.x0 ?? sys.box.x0;
      const x1 = staff.x1 ?? sys.box.x1;
      const rect = document.createElementNS(SVG, "rect");
      rect.setAttribute("class", "mark");
      rect.setAttribute("x", x0 - px);
      rect.setAttribute("y", staff.y0 - py);
      rect.setAttribute("width", x1 - x0 + 2 * px);
      rect.setAttribute("height", staff.y1 - staff.y0 + 2 * py);
      rect.setAttribute("rx", view.w * 0.006);
      view.marks.append(rect);
      if (line.voice !== "only" && staff.lines.length > 1) {
        const label = document.createElementNS(SVG, "text");
        label.setAttribute("class", "mark-label");
        label.setAttribute("x", x1 + px - view.w * 0.005);
        label.setAttribute("y", staff.y0 - py - view.h * 0.004);
        label.setAttribute("text-anchor", "end");
        label.setAttribute("font-size", view.w * 0.03);
        label.textContent = line.voice === "upper" ? "upper voice" : "lower voice";
        view.marks.append(label);
      }
    }
  }
}

function barAt(beat) {
  let lo = 0;
  let hi = score.measures.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (score.measures[mid].start <= beat + 1e-6) lo = mid;
    else hi = mid - 1;
  }
  return score.measures[lo];
}

// ---------- lock: stops accidental changes to the part, title and delete ----------

function applyLock() {
  const locked = !!current.locked;
  $("lock").checked = locked;
  $("panel").classList.toggle("locked", locked);
  $("title").readOnly = locked;
  $("title-icon").textContent = locked ? "🔒" : "✎";
  for (const el of [
    ...document.querySelectorAll("#lines input"),
    $("octave"),
    $("start-markup"),
    $("edit-markup"),
    $("clear-marks"),
    $("delete"),
    $("read-again"),
    $("start-fix"),
    $("doubt-mark"),
    $("doubt-fix"),
  ]) el.disabled = locked;
  renderPartChoice();
  $("read-again").hidden = !current.images?.length;
}

$("lock").onchange = () => {
  current.locked = $("lock").checked;
  updateEntry(current.id, { locked: current.locked });
  applyLock();
};

// Each repeat the reader found, with the bar it goes back to. A forward repeat
// at the start of a line is easy to miss, so the start can be corrected here.
function renderRepeats() {
  const ends = score.measures.filter((m) => m.repeatBackward);
  $("repeats").hidden = !ends.length;
  $("play-repeats").checked = current.playRepeats !== false;
  $("repeat-list").replaceChildren(
    ...ends.map((m) => {
      const li = document.createElement("li");
      li.innerHTML = `<span></span> goes back to bar <input type="number" min="1" inputmode="numeric">`;
      li.querySelector("span").textContent = `Repeat at bar ${m.number}`;
      const input = li.querySelector("input");
      input.max = m.number;
      input.value = current.repeats[m.number] ?? m.repeatTo + 1;
      input.disabled = current.playRepeats === false;
      input.onchange = () => {
        const bar = Math.min(m.number, Math.max(1, Math.round(Number(input.value)) || m.repeatTo + 1));
        input.value = bar;
        current.repeats = { ...current.repeats, [m.number]: bar };
        updateEntry(current.id, { repeats: current.repeats });
        restartIfPlaying();
      };
      return li;
    }),
  );
}
$("play-repeats").onchange = () => {
  current.playRepeats = $("play-repeats").checked;
  updateEntry(current.id, { playRepeats: current.playRepeats });
  renderRepeats();
  restartIfPlaying();
};

function restartIfPlaying() {
  resumeAt = null;
  if (player?.playing) startPlayback();
}

function renderLines() {
  $("lines").replaceChildren(
    ...score.lines.map((line) => {
      const li = document.createElement("li");
      li.className = line.id === current.mine ? "mine" : "";
      const midis = line.notes.map((n) => n.midi);
      const range = `${noteName(Math.min(...midis))}–${noteName(Math.max(...midis))}`;
      li.innerHTML = `
        <label class="pick"><input type="radio" name="mine"><span></span><span class="range">${range}</span></label>
        <label class="include"><input type="checkbox"> play</label>`;
      li.querySelector(".pick span").textContent = line.label;
      const radio = li.querySelector('input[type="radio"]');
      radio.checked = line.id === current.mine;
      radio.onchange = () => {
        current.mine = line.id;
        updateEntry(current.id, { mine: line.id });
        renderLines();
        applyMix();
      };
      const include = li.querySelector('input[type="checkbox"]');
      include.checked = !current.excluded.includes(line.id);
      include.onchange = () => {
        current.excluded = include.checked
          ? current.excluded.filter((x) => x !== line.id)
          : [...current.excluded, line.id];
        updateEntry(current.id, { excluded: current.excluded });
        applyMix();
      };
      return li;
    }),
  );
  if (current.locked) for (const el of document.querySelectorAll("#lines input")) el.disabled = true;
}

// Takes effect from the next notes scheduled (within a quarter second).
function applyMix() {
  othersGain = Number($("others").value) / 100;
}

function updateLabels() {
  $("others-val").textContent = `${$("others").value}%`;
  $("tempo-val").textContent = $("tempo").value;
}

$("others").oninput = () => {
  updateLabels();
  applyMix();
};
$("others").onchange = () => updateEntry(current.id, { others: Number($("others").value) });
$("tempo").oninput = () => {
  updateLabels();
  player.setTempo(Number($("tempo").value));
};
$("tempo").onchange = () => updateEntry(current.id, { tempo: Number($("tempo").value) });
$("title").onchange = () => {
  current.title = $("title").value.trim() || current.title;
  $("title").value = current.title;
  updateEntry(current.id, { title: current.title });
};

function barNumbers() {
  const n = score.measures.length;
  const from = Math.min(Math.max(1, Number($("from-bar").value) || 1), n);
  const to = Math.min(Math.max(from, Number($("to-bar").value) || n), n);
  return [from, to];
}

function barRange() {
  const [from, to] = barNumbers();
  const last = score.measures[to - 1];
  return [score.measures[from - 1].start, last.start + last.length];
}

// What to play for the chosen bars: stretches of the score in order, taking
// repeats (unless switched off) with any corrected repeat starts.
function playSegments() {
  const [from, to] = barNumbers();
  const targets = Object.fromEntries(Object.entries(current.repeats ?? {}).map(([bar, toBar]) => [bar - 1, toBar - 1]));
  const order = current.playRepeats === false
    ? Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i)
    : playOrder(score.measures, from - 1, to - 1, targets);
  const segments = [];
  for (const i of order) {
    const m = score.measures[i];
    const last = segments.at(-1);
    if (last && Math.abs(last.to - m.start) < 1e-6) last.to = m.start + m.length;
    else segments.push({ from: m.start, to: m.start + m.length });
  }
  return segments;
}

// After a pause: where playback stopped (in the score and along the play
// order), so play carries on from there, including on a repeat's second time.
let resumeAt = null; // { beat, offset, key }
const rangeKey = () => JSON.stringify([barNumbers(), current.repeats, current.playRepeats]);

function startPlayback(offset = 0) {
  // Treat the first bar as new, so it's scrolled into view.
  followedBar = null;
  readBar = null;
  player.play(playSegments(), offset, $("loop").checked);
}

function setPlaying(on) {
  $("play").classList.toggle("playing", on);
  $("play").setAttribute("aria-label", on ? "Pause" : "Play");
}

// nav=false when responding to the back button (history already moved).
function setPanel(open, nav = true) {
  const wasOpen = !$("panel").hidden;
  $("panel").hidden = !open;
  $("panel-backdrop").hidden = !open;
  $("settings").setAttribute("aria-expanded", String(open));
  if (open && current) updateAudioButton();
  if (!nav || open === wasOpen) return;
  if (open) history.pushState({ screen: "practice", panel: true }, "");
  else if (history.state?.panel) history.back();
}
$("settings").onclick = () => setPanel($("panel").hidden);
// "?" buttons show and hide the explanation they point at.
for (const q of document.querySelectorAll(".q")) {
  q.onclick = () => {
    const help = $(q.getAttribute("aria-controls"));
    help.hidden = !help.hidden;
    q.setAttribute("aria-expanded", String(!help.hidden));
  };
}
// A change to anything that's heard means the audio needs preparing again.
for (const type of ["input", "change"]) $("panel").addEventListener(type, () => current && updateAudioButton());
$("panel-close").onclick = () => setPanel(false);
$("panel-backdrop").onclick = () => setPanel(false);

// Swipe the panel's handle down to close it.
{
  let startY = null;
  const head = $("panel-head");
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    startY = e.clientY;
    try {
      head.setPointerCapture(e.pointerId);
    } catch {}
  });
  head.addEventListener("pointermove", (e) => {
    if (startY == null) return;
    $("panel").style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
  });
  const end = (e) => {
    if (startY == null) return;
    const dragged = e.clientY - startY;
    startY = null;
    $("panel").style.transform = "";
    if (dragged > 60) setPanel(false);
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
}

$("play").onclick = () => {
  if (player.playing) {
    player.stop();
    resumeAt = { beat: player.position(), offset: player.offset(), key: rangeKey() };
    return;
  }
  const offset = resumeAt?.key === rangeKey() ? resumeAt.offset : 0;
  resumeAt = null;
  startPlayback(offset);
  setPlaying(true);
  if (!playTracked) track("play", hasMarks() ? "play (marked)" : "play");
  playTracked = true;
};

$("rewind").onclick = () => {
  resumeAt = null;
  const [from, to] = barRange();
  if (player.playing) startPlayback();
  else {
    showBar(from);
    $("position").textContent = `Bar ${barAt(from).number}`;
  }
};

for (const id of ["from-bar", "to-bar", "loop"]) {
  $(id).onchange = () => {
    resumeAt = null;
    const [from, to] = barRange();
    if (player.playing) startPlayback();
    else {
      showBar(from);
      $("position").textContent = `Bar ${barAt(from).number}`;
    }
  };
}

// Read a score's photos again (e.g. after the reader improves), keeping its
// title and settings. It stays as it was until the new reading is saved.
$("read-again").onclick = () => {
  if (reading) return show("scan");
  // Parts switched off are saved by their place in the parts list, which a new
  // reading can change: go back to the default (the piano off).
  const { id, created, title, images, pages: _pages, pending: _pending, excluded: _excluded, ...settings } = liveEntry(current);
  prepared = preparedAudio = null;
  loadScan(images, [], id, created, title);
  scanSettings = settings;
  rereading = true;
  readScan();
};

$("delete").onclick = () => {
  if ($("delete").dataset.confirm !== "1") {
    $("delete").dataset.confirm = "1";
    $("delete").textContent = "Tap again to delete";
    setTimeout(() => {
      $("delete").dataset.confirm = "";
      $("delete").textContent = "Delete";
    }, 3000);
    return;
  }
  $("delete").dataset.confirm = "";
  $("delete").textContent = "Delete";
  db.remove(current.id).finally(goHome);
};

// ---------- Pages / As read ----------

// Follow-along on the As read view: OSMD knows where it drew each bar.
let readViews = []; // per page: { osmd, div, bar, playhead }
let readBar = null;

function readMark(cls) {
  const el = document.createElement("div");
  el.className = cls;
  el.hidden = true;
  return el;
}

// Bar `i` of a rendered page, in pixels within its container.
function readBarBox(view, i) {
  const staves = view.osmd?.GraphicSheet?.MeasureList?.[i];
  if (!staves) return null;
  const unit = 10 * view.osmd.zoom; // OSMD units -> px (osmd is set: staves were found)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let lead = 0; // clef/key/time at the start of a system
  for (const m of staves) {
    const ps = m?.PositionAndShape;
    if (!ps) continue;
    lead = Math.max(lead, m.beginInstructionsWidth || 0);
    x0 = Math.min(x0, ps.AbsolutePosition.x + ps.BorderLeft);
    x1 = Math.max(x1, ps.AbsolutePosition.x + ps.BorderRight);
    y0 = Math.min(y0, ps.AbsolutePosition.y + ps.BorderTop);
    y1 = Math.max(y1, ps.AbsolutePosition.y + ps.BorderBottom);
  }
  if (x0 === Infinity) return null;
  const pad = 6;
  const svg = view.div.querySelector("svg");
  const ox = svg ? svg.getBoundingClientRect().left - view.div.getBoundingClientRect().left : 0;
  const oy = svg ? svg.getBoundingClientRect().top - view.div.getBoundingClientRect().top : 0;
  return { x: ox + x0 * unit, y: oy + y0 * unit - pad, w: (x1 - x0) * unit, h: (y1 - y0) * unit + 2 * pad, lead: lead * unit };
}

function place(el, { x, y, w, h }) {
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  el.hidden = false;
}

function followRead(beat, playing = true) {
  if ($("read-view").hidden || !readViews.length) return;
  const bar = barAt(beat);
  const view = readViews[bar.sheet];
  const box = view && readBarBox(view, bar.sheetBar);
  if (!box) return;
  if (bar !== readBar) {
    for (const v of readViews) v.bar.hidden = v.playhead.hidden = true;
    place(view.bar, box);
    readBar = bar;
    if (playing) keepInView(view.bar);
  }
  if (!playing) return;
  const from = box.x + box.lead;
  const x = from + ((box.w - box.lead) * Math.min(1, Math.max(0, beat - bar.start))) / bar.length;
  place(view.playhead, { x: x - 1.5, y: box.y, w: 3, h: box.h });
}

// homr numbers each page's bars from 1; renumber to match the bar counter.
function numberBars(xml, first) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  for (const part of doc.querySelectorAll("part")) {
    [...part.children].filter((m) => m.tagName === "measure").forEach((m, i) => m.setAttribute("number", first + i));
  }
  return new XMLSerializer().serializeToString(doc);
}

// Tap a bar in the As read view to start from it.
function pickReadBar(sheet, e) {
  const view = readViews[sheet];
  const r = view.div.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  let best = null;
  let bestDist = Infinity;
  for (const bar of score.measures) {
    if (bar.sheet !== sheet) continue;
    const b = readBarBox(view, bar.sheetBar);
    if (!b) continue;
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    if (dx * dx + dy * dy < bestDist) [best, bestDist] = [bar, dx * dx + dy * dy];
  }
  if (!best) return;
  $("from-bar").value = best.number;
  if (Number($("to-bar").value) < best.number) $("to-bar").value = score.measures.length;
  $("from-bar").onchange();
}

// Where you are: the playing position, else where you paused, else the start bar.
const currentBeat = () => (player?.playing ? player.position() : resumeAt?.beat ?? barRange()[0]);

function setView(view) {
  const pages = view === "pages";
  $("follow").hidden = !pages;
  $("read-view").hidden = pages;
  const t = $("view-toggle");
  t.classList.toggle("on-read", !pages);
  $("view-toggle-label").textContent = pages ? "As read" : "Pages";
  t.setAttribute("aria-label", pages ? "Show the music as read" : "Show your pages");
  if (pages) {
    followedBar = null;
    follow(currentBeat(), !!player?.playing);
  } else {
    renderRead();
    readBar = null;
    followRead(currentBeat(), !!player?.playing);
  }
  revealCurrentBar();
}
$("view-toggle").onclick = () => setView($("read-view").hidden ? "read" : "pages");

// Scrolls the highlighted bar of the visible view into the middle of the screen.
function revealCurrentBar() {
  const bar = barAt(currentBeat());
  const el = $("read-view").hidden ? pageViews[bar.page]?.bar : readViews[bar.sheet]?.bar;
  if (el && el.style.display !== "none" && !el.hidden) el.scrollIntoView({ block: "center" });
}

// Draws the recognised MusicXML with OSMD, loaded on first use.
let osmdLoaded;
let osmdFor = null; // the score currently drawn
async function renderRead() {
  if (osmdFor === current) return;
  const entry = (osmdFor = current);
  $("osmd").replaceChildren();
  readViews = [];
  readBar = null;
  osmdLoaded ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = OSMD_URL;
    s.onload = resolve;
    s.onerror = () => {
      osmdLoaded = null;
      reject(new Error("Couldn't load the score viewer (offline?)"));
    };
    document.head.append(s);
  });
  try {
    await osmdLoaded;
    for (const xml of entry.pages) {
      // Draw a page at a time so playback and scrolling get a turn in between.
      await new Promise((r) => setTimeout(r, 0));
      if (osmdFor !== entry) return; // another score was opened meanwhile
      const div = document.createElement("div");
      div.className = "read-page";
      $("osmd").append(div);
      const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(div, {
        autoResize: false,
        drawTitle: false,
        drawPartNames: false,
      });
      osmd.EngravingRules.UseXMLMeasureNumbers = true;
      const sheet = readViews.length;
      try {
        await osmd.load(numberBars(xml, score.measures.find((b) => b.sheet === sheet)?.number ?? 1));
        osmd.zoom = 0.6;
        osmd.render();
      } catch (e) {
        // One page the viewer can't draw shouldn't hide the others.
        div.replaceChildren();
        div.className = "read-page read-failed muted";
        div.textContent = `Page ${sheet + 1} can't be shown here (${e.message}). It still plays.`;
        readViews.push({ osmd: null, div, bar: readMark("read-bar"), playhead: readMark("read-playhead") });
        continue;
      }
      const view = { osmd, div, bar: readMark("read-bar"), playhead: readMark("read-playhead") };
      div.append(view.bar, view.playhead);
      div.onclick = (e) => pickReadBar(sheet, e);
      readViews.push(view);
    }
    showBar(currentBeat());
    if (!$("read-view").hidden) revealCurrentBar();
  } catch (e) {
    osmdFor = null;
    $("osmd").textContent = e.message;
  }
}

if ("serviceWorker" in navigator && location.hostname !== "localhost") {
  navigator.serviceWorker.register("sw.js");
}

if (location.hash.startsWith("#s=")) {
  renderLibrary().then(receiveFromRelay);
} else if (/^#(receive|import=)/.test(location.hash)) {
  renderLibrary().then(receiveFromPage);
} else if (new URLSearchParams(location.search).has("inbox")) {
  history.replaceState(null, "", location.pathname);
  renderLibrary()
    .then(openInbox)
    .catch((e) => showError(`Couldn't open the shared file: ${e.message}`));
} else if (new URLSearchParams(location.search).has("open-file")) {
  // The files themselves come through launchQueue (above).
  history.replaceState(null, "", location.pathname);
  renderLibrary();
} else {
  // A share whose launch never finished (e.g. stuck offline) is still waiting.
  renderLibrary().then(async () => ((await (await caches.open("partscanner-inbox")).keys()).length ? openInbox() : resumeUnfinished()));
}
prefetchReader();
countReturn();

// PDFs opened with Partsong from the system's "Open with" (manifest
// file_handlers: desktop Chrome/Edge, and Android where Chrome supports it):
// a score file is offered, an ordinary PDF starts a new scan.
window.launchQueue?.setConsumer(async ({ files: handles }) => {
  const scans = [];
  for (const handle of handles ?? []) {
    const f = await handle.getFile();
    const shared = await readScoreFile(f).catch(() => null);
    if (shared) await offerImport(shared);
    else scans.push(f);
  }
  if (scans.length) {
    loadScan();
    await addFiles(scans);
  }
});

// A link tapped while Partsong is already open (e.g. the installed app) only
// changes the #fragment, without reloading.
addEventListener("hashchange", () => {
  if (location.hash.startsWith("#s=")) receiveFromRelay();
  else if (/^#(receive|import=)/.test(location.hash)) receiveFromPage();
});
