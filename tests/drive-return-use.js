// Once a day, on opening, Partsong counts how many days it has been used on
// this device, how long since the first, and how many scores it holds, in
// broad groups (no id). GoatCounter itself is kept out so the stand-in counts:
//   CHROME_FLAGS="--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND" node scripts/headless-test.mjs \
//     http://localhost:8765/index.html out.json 120 tests/drive-return-use.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async () => {
  const f = document.createElement("iframe");
  f.src = "/index.html";
  document.body.append(f);
  const events = [];
  // Stands in for GoatCounter (which doesn't count on localhost).
  const stub = setInterval(() => { try { f.contentWindow.goatcounter = { count: (e) => events.push(e.path) }; } catch {} }, 20);
  await sleep(4000);
  clearInterval(stub);
  f.remove();
  return events.filter((p) => /^(use|library):/.test(p));
};
localStorage.removeItem("partsong-use-days");
const r = { first: await open(), sameDay: await open() };
const day = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA");
localStorage.setItem("partsong-use-days", JSON.stringify({ first: day(10), last: day(1), days: 4 }));
r.later = await open();
r.stored = JSON.parse(localStorage.getItem("partsong-use-days")).days;
r.ok = r.first.join() === "use: day 1,use: first today,library: 0 scores" && r.sameDay.length === 0 && r.later.join() === "use: day 4–5,use: first 1–4 weeks ago,library: 0 scores" && r.stored === 5;
window.result = r;
