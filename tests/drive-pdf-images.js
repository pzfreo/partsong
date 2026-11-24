// PDFs whose page is a JPEG 2000, JBIG2 or CCITT fax image (scanned editions use them) draw their music, not blank pages: pdf.js decodes those images with
// its own decoders (lib/pdfjs-dist@*/wasm/), which Partsong didn't ship, and
// without them drew white pages ("staff lines 0.0%, noteheads 0.0%").
//   node scripts/headless-test.mjs http://localhost:8765/index.html out.json 60 tests/drive-pdf-images.js
const { pdfPages } = await import("./pdf-pages.js");
const ink = {};
for (const name of ["huron-jpx.pdf", "huron-jbig2.pdf", "huron-ccitt.pdf"]) {
  const pdf = await (await fetch(`testdata/${name}`)).blob();
  await pdfPages(new File([pdf], name), async (blob) => {
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    ink[name] = dark / (d.length / 4);
  });
}
window.result = { ink, ok: Object.values(ink).length === 3 && Object.values(ink).every((v) => v > 0.02) };
