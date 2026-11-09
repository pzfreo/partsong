// An error from a script that isn't Partsong's (a browser extension's, seen as
// "reading 'M_ID'" on Windows), or another site's "Script error.", isn't shown
// or counted; Partsong's own still are, including from blob: URLs.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 30 tests/drive-foreign-error.js
const toast = document.getElementById("error-toast");
const fire = (filename, message) => window.dispatchEvent(new ErrorEvent("error", { message, filename }));
const r = {};
toast.hidden = true;
fire("chrome-extension://abcdef/content.js", "Cannot read properties of undefined (reading 'M_ID')");
r.foreignShown = !toast.hidden;
fire("", "Script error."); // another site's script, details hidden
r.scriptErrorShown = !toast.hidden;
fire(`${location.origin}/app.js`, "own error");
r.ownShown = !toast.hidden && toast.textContent.includes("own error");
toast.hidden = true;
fire(`blob:${location.origin}/1234`, "own blob error");
r.ownBlobShown = !toast.hidden;
r.ok = !r.foreignShown && !r.scriptErrorShown && r.ownShown && r.ownBlobShown;
window.result = r;
