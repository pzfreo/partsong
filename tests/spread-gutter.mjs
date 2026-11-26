// Where a wide page is two pages side by side: spreadGutter's cut, from the
// staves the reader found. Run: node tests/spread-gutter.mjs
import { spreadGutter } from "../score.js";
const W = 4000, H = 2800;
const column = (x0, x1, n = 4, top = 150) => Array.from({ length: n }, (_, i) => [[x0, top + i * 650, x1, top + i * 650 + 330]]);
let failed = 0;
const check = (name, got, want) => {
  const ok = want === null ? got === null : got != null && Math.abs(got - want) < 1;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got}`);
};
// Two pages, margins between: cut in the middle of the gap.
check("open book", spreadGutter([...column(200, 1850), ...column(2150, 3800)], W, H), 2000);
// A page in two columns, off-centre but inside the middle band.
check("two columns, gap at 40%", spreadGutter([...column(150, 1450), ...column(1750, 3850)], W, H), 1600);
// The usual landscape page: staves across the whole width.
check("full-width staves", spreadGutter(column(200, 3800), W, H), null);
// A portrait page.
check("portrait", spreadGutter([...column(100, 900), ...column(1100, 1900)], 2000, 2800), null);
// Staves on one side only.
check("left side only", spreadGutter(column(200, 1850), W, H), null);
check("one stave a side", spreadGutter([[[200, 150, 1850, 480]], [[2150, 150, 3800, 480]]], W, H), null);
// Too narrow a gap to be a gutter.
check("narrow gap", spreadGutter([...column(200, 1950), ...column(2000, 3800)], W, H), null);
// A gap near the edge of the page, not the middle.
check("gap at the edge", spreadGutter([...column(200, 700), ...column(1000, 3800)], W, H), null);
// Side by side but one above the other (a short column at the bottom only).
check("not side by side", spreadGutter([...column(200, 1850, 2, 150), ...column(2150, 3800, 2, 1900)], W, H), null);
// Staves of different sizes that overlap in x (a staff across the gutter).
check("one stave across", spreadGutter([...column(200, 1850), ...column(2150, 3800), [[200, 2700, 3800, 2790]]], W, H), null);
process.exit(failed ? 1 : 0);
