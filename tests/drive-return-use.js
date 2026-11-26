// Once a day, on opening, Partsong counts how many days it has been used on
// this device, how long since the first, and how many scores it holds, in
// broad groups (no id). And once a week, a device used on three or more days
// counts itself a regular ("use: regular this week"), nothing else with it.
// GoatCounter itself is kept out so the stand-in counts:
//   CHROME_FLAGS="--host-resolver-rules=MAP gc.zgo.at ~NOTFOUND" node scripts/headless-test.mjs \
//     http://localhost:8765/index.html out.json 120 tests/drive-return-use.js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (counting = true) => {
  const f = document.createElement("iframe");
  f.src = "/index.html";
  document.body.append(f);
  const events = [];
  // Stands in for GoatCounter (which doesn't count on localhost).
  const stub = setInterval(() => { try { if (counting) f.contentWindow.goatcounter = { count: (e) => events.push(e.path) }; } catch {} }, 20);
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
// The weekly count. The Monday on or before a day, found by walking back (not by the app's own function: tests/week-of.mjs tests that).
const monday = (n) => { for (let i = n; ; i++) { const t = new Date(Date.now() - i * 864e5); if (t.getDay() === 1) return t.toLocaleDateString("en-CA"); } };
const thisWeek = monday(0), lastWeek = monday(7);
const week = async (state, counting = true) => { localStorage.setItem("partsong-use-days", JSON.stringify({ first: day(20), last: day(1), ...state })); const e = await open(counting); return { regular: e.filter((p) => p === "use: regular this week").length, stored: JSON.parse(localStorage.getItem("partsong-use-days")) }; };
r.notYet = await week({ days: 1 });                              // day 2: not a regular yet
r.third = await week({ days: 2 });                               // reaches day 3: counts itself, and notes the week
r.sameWeek = await week({ days: 6, week: thisWeek });            // already counted this week: not again
r.nextWeek = await week({ days: 6, week: lastWeek });            // last counted last week: counts again
r.lost = await week({ days: 2 }, false);                         // GoatCounter never loads: not counted, and the week is NOT noted...
r.retried = await week({ days: 3 });                             // ...so the next open counts it
r.ok = r.first.join() === "use: day 1,use: first today,library: 0 scores" && r.sameDay.length === 0 &&
  r.later.join() === "use: day 4–5,use: first 1–4 weeks ago,library: 0 scores,use: regular this week" && r.stored === 5 &&
  r.notYet.regular === 0 && r.notYet.stored.week === undefined &&
  r.third.regular === 1 && r.third.stored.week === thisWeek &&
  r.sameWeek.regular === 0 && r.sameWeek.stored.week === thisWeek &&
  r.nextWeek.regular === 1 && r.nextWeek.stored.week === thisWeek &&
  r.lost.regular === 0 && r.lost.stored.week === undefined && r.lost.stored.days === 3 &&
  r.retried.regular === 1 && r.retried.stored.week === thisWeek;
window.result = r;
