// A page that fills only part of a photo (a desk round it) is judged upright or
// sideways rightly: the page at 96%, 70%, 50% and 35% of the frame's height
// (tests/make-landscape-fixtures.py), upright and turned a quarter. It was
// judged wrongly for the 70%, 50% and 35% ones both ways, so a small upright
// page was turned onto its side and the reader found no music.
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 120 tests/drive-orient-small-page.js
const { isSideways } = await import("./orient.js");
const load = async (f) => createImageBitmap(await (await fetch("/testdata/" + f)).blob(), { imageOrientation: "from-image" });
const turned = async (bmp) => { const c = new OffscreenCanvas(bmp.height, bmp.width); const g = c.getContext("2d"); g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(bmp, 0, 0); return createImageBitmap(c); };
const wrong = [];
const check = (name, got, want) => { if (got !== want) wrong.push(`${name}: judged ${got ? "sideways" : "upright"}`); };
for (const f of ["landscape-frame-96.jpg", "landscape-frame-70.jpg", "landscape-frame-50.jpg", "landscape-frame-35.jpg", "landscape-spread.jpg", "huron_0.png", "cam_0_exif6.jpg", "cam_3_exif6.jpg"]) {
  const b = await load(f);
  check(f, isSideways(b), false);
  check(f + " turned", isSideways(await turned(b)), true);
}
for (const f of ["cam_0_exif1.jpg", "cam_1_exif1.jpg", "cam_2_exif3.jpg", "cam_3_exif1.jpg"]) check(f, isSideways(await load(f)), true);
window.result = { wrong, ok: wrong.length === 0 };
