// weekOf (app.js): the Monday of a date's week, for the weekly regular count.
// Fixed dates, in several time zones (the app works from the device's local date).
//   node tests/week-of.mjs
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (!process.env.WEEK_OF_CHILD) {
  let failed = 0;
  for (const tz of ["UTC", "America/Sao_Paulo", "Pacific/Auckland", "America/Havana", "Asia/Beirut", "Pacific/Apia"]) {
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname], { env: { ...process.env, TZ: tz, WEEK_OF_CHILD: "1" }, encoding: "utf8" });
    process.stdout.write(`${tz}: ${r.stdout}`);
    failed += r.status;
  }
  process.exit(failed ? 1 : 0);
}
// The function itself, taken from the app's source.
const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const weekOf = new Function(`${/const weekOf = \(date\) => \{[\s\S]*?\n\};/.exec(src)[0]}; return weekOf;`)();
const cases = {
  "2026-11-23": "2026-11-23", // a Monday: itself
  "2026-11-26": "2026-11-23", // a Thursday
  "2026-11-29": "2026-11-23", // a Sunday: the Monday before
  "2026-11-30": "2026-11-30", // the next Monday
  "2027-01-01": "2026-12-28", // across a year
  "2028-02-29": "2028-02-28", // a leap day (a Tuesday)
  "2026-03-01": "2026-02-23", // across a month
  "2026-03-29": "2026-03-23", // the day Europe's clocks go forward
  "2026-10-25": "2026-10-19", // the day they go back
};
const wrong = Object.entries(cases).filter(([d, w]) => weekOf(d) !== w).map(([d, w]) => `${d}: ${weekOf(d)}, want ${w}`);
console.log(wrong.length ? "FAIL " + wrong.join("; ") : `ok (${Object.keys(cases).length} dates)`);
process.exit(wrong.length ? 1 : 0);
