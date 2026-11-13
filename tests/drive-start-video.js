// The getting-started video plays over the start screen (it used to open the
// Help page in a new tab). Watch a video (newcomers) and the About link both
// open it and it plays; Close, Back and a tap outside close it and stop it;
// Back after opening it from About goes home, not back to About. The first
// play is counted as "video-play (start screen)".
//   CHROME_FLAGS="--mute-audio --autoplay-policy=no-user-gesture-required" \
//     node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-start-video.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const events = [];
window.goatcounter = { count: (e) => events.push(e.path) };
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").clear(); tx.oncomplete = res; }; });
location.hash = ""; $("new-scan").click(); history.back(); await sleep(800);
const video = $("intro-video-player");
const shown = () => !$("intro-video").hidden;
const r = {};

const watch = document.querySelector("#library-empty .video-open");
r.newcomerButton = { visible: !$("library-empty").hidden && !!watch?.offsetParent, text: watch?.textContent };
watch.click();
await waitFor(() => video.currentTime > 0.5, 15000, "video playing");
const box = video.getBoundingClientRect();
r.opened = { shown: shown(), playing: !video.paused, fits: box.bottom <= innerHeight && box.right <= innerWidth && box.top >= 0 };
$("intro-video-close").click();
await sleep(300);
r.closeButton = { hidden: !shown(), paused: video.paused, home: !$("home").hidden };

watch.click();
await sleep(500);
history.back();
await sleep(500);
r.back = { hidden: !shown(), paused: video.paused, home: !$("home").hidden };

watch.click();
await sleep(500);
$("intro-video").click(); // the dark area round the video
await sleep(300);
r.tapOutside = { hidden: !shown(), paused: video.paused };

document.querySelector(".about-open").click();
await sleep(300);
document.querySelector("#about .video-open").click();
await sleep(500);
r.fromAbout = { videoShown: shown(), aboutHidden: $("about").hidden };
history.back();
await sleep(500);
r.fromAboutBack = { videoHidden: !shown(), aboutHidden: $("about").hidden, home: !$("home").hidden };

r.counted = events.filter((p) => p.startsWith("video-play"));
r.ok = r.newcomerButton.visible && r.opened.shown && r.opened.playing && r.opened.fits &&
  Object.values(r.closeButton).every(Boolean) && Object.values(r.back).every(Boolean) && Object.values(r.tapOutside).every(Boolean) &&
  r.fromAbout.videoShown && r.fromAbout.aboutHidden && Object.values(r.fromAboutBack).every(Boolean) &&
  JSON.stringify(r.counted) === JSON.stringify(["video-play (start screen)"]);
window.result = r;
