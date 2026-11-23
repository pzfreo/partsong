// An error with no stack (Safari's DOMException "Internal error", seen twice in
// practice on iPhones) still says what it was and what the singer did just
// before: its name and type, and the last buttons pressed and events counted.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 30 tests/drive-error-kind.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
localStorage.setItem("partsong.relay", "http://localhost:1"); // captured below, never sent
const sent = [];
const realFetch = window.fetch;
window.fetch = async (url, init) => {
  if (String(url).endsWith("/log")) return sent.push(JSON.parse(init.body)), new Response("", { status: 201 });
  return realFetch(url, init);
};
await sleep(300);
document.getElementById("new-scan").click();
await sleep(1200);
Promise.reject(new DOMException("Internal error", "UnknownError"));
await sleep(500);
window.fetch = realFetch;
localStorage.removeItem("partsong.relay");
const rec = sent.find((r) => r.kind === "error" && r.message === "Internal error");
window.result = {
  detail: rec?.detail,
  ok: !!rec && rec.detail.name === "UnknownError" && rec.detail.type === "DOMException" && /new-scan [12]s/.test(rec.detail.recent),
};
