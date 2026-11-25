// An error from a script that isn't Partsong's (a browser extension's, seen as
// "reading 'M_ID'" on Windows), or another site's "Script error.", isn't shown
// or counted, nor one from a script injected into the page (the Google app's
// browser); Partsong's own still are, including from blob: URLs.
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
// A script injected into the page (the Google app's browser on an iPhone):
// its frames are on the page's own address, with no .js file ("Na", 25 Nov).
toast.hidden = true;
fire(`${location.origin}/`, "Na");
r.injectedShown = !toast.hidden;
const err = Object.assign(new Error("Na"), { stack: `@${location.origin}/:512:420\nyi@${location.origin}/:202:221` });
window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: err }));
r.injectedRejectionShown = !toast.hidden;
r.ok = !r.foreignShown && !r.scriptErrorShown && r.ownShown && r.ownBlobShown && !r.injectedShown && !r.injectedRejectionShown;
window.result = r;
