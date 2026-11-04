// Scanning works on iPhone/iPad, with a note on the scan screen that it's
// experimental there; elsewhere no note. Run with a Windows user agent (the harness emulates touch, so a
// Mac looks like an iPad) and with an iPhone one:
//   USER_AGENT="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" \
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-ios-note.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);
const seen = (el) => !!el && el.getClientRects().length > 0;
const r = { iPhone: /iPhone/.test(navigator.userAgent), scanButton: seen(document.getElementById("new-scan")), sample: seen(document.querySelector(".try-sample")) };
document.getElementById("new-scan").click();
await sleep(500);
const note = document.getElementById("device-note");
r.note = seen(note) ? note.textContent : null;
r.takePhoto = seen(document.getElementById("camera").closest("label"));
r.ok = r.scanButton && r.sample && r.takePhoto && (r.iPhone ? /^Scanning on iPhone is experimental/.test(r.note) : r.note === null);
window.result = r;
