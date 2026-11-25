// Compares the systems found in two runs of drive-low-memory-positions.js:
// the same systems and staves, each box within TOL photo pixels.
import { readFileSync } from "node:fs";
const TOL = 12;
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
let worst = 0, same = true;
a.systems.forEach((page, p) => {
  if (page.length !== b.systems[p].length) same = false;
  page.forEach((sys, i) => sys.forEach((staff, j) => staff.forEach((v, k) => {
    const w = b.systems[p]?.[i]?.[j]?.[k];
    if (w == null) same = false; else worst = Math.max(worst, Math.abs(v - w));
  })));
});
const ok = same && worst <= TOL;
console.log(JSON.stringify({ sameSystems: same, worstDifference: worst, ok }));
process.exit(ok ? 0 : 1);
