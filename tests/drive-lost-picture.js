// Turning a page whose picture the phone can no longer read (iPhone, v203:
// Safari's "An error occured reading the Blob argument to createImageBitmap"
// was shown as an error) says what to do instead. The unreadable picture is a
// saved, stopped scan whose image isn't an image. Run against
// http://localhost:8765/testdata/.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "lost", title: "Lost", created: 1, images: [new Blob(["not a picture"], { type: "image/png" })], pages: [null], pending: true, stopped: true }); tx.oncomplete = res; }; });
const f = document.createElement("iframe");
f.style.cssText = "width:412px;height:900px;border:0";
f.src = "/index.html?" + Math.random();
document.body.prepend(f);
const $ = (id) => f.contentWindow.document.getElementById(id);
const errors = [];
await waitFor(() => $("new-scan"), 20000, "app");
f.contentWindow.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason?.message ?? e.reason)));
await waitFor(() => f.contentWindow.document.querySelector("#library button"), 10000, "library").then((b) => b.click());
// Opening it tries to read it again, which fails first.
await waitFor(() => /Couldn't read page 1/.test($("status").textContent), 30000, "read fails");
const rotate = await waitFor(() => f.contentWindow.document.querySelector("#pages .rotate"), 10000, "page");
rotate.click();
await sleep(1500);
const r = { status: $("status").textContent.trim(), toast: $("error-toast").hidden ? "" : $("error-toast").textContent, errors };
r.ok = /^Couldn't turn page 1: the phone has lost the picture/.test(r.status) && !r.toast && !errors.length;
window.result = r;
