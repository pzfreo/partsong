// Renders each page of a PDF to a PNG for recognition, via pdf.js (loaded on
// first use; the service worker caches it for offline use).

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/";
const TARGET_WIDTH = 2480; // about 300 dpi across an A4 page
const MAX_SIDE = 4200; // same cap as photos (see normalise() in app.js)

let pdfjs;

function load() {
  pdfjs ??= import(PDFJS_URL + "pdf.min.mjs").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS_URL + "pdf.worker.min.mjs";
    return lib;
  });
  return pdfjs;
}

// By content: pickers (e.g. Drive on Android) may give no type or extension.
// The PDF standard allows the %PDF- header anywhere in the first 1024 bytes.
export async function isPdf(file) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return String.fromCharCode(...head).includes("%PDF-");
}

// Calls onPage(blob, pageNumber, pageCount) for each page, in order.
// A page drawn when the phone was short of memory can come back empty or
// undecodable: say so here rather than fail later in the reader.
async function checkImage(blob, n) {
  try {
    if (!blob?.size) throw new Error("empty");
    const bmp = await createImageBitmap(blob);
    const ok = bmp.width > 0 && bmp.height > 0;
    bmp.close();
    if (!ok) throw new Error("no pixels");
  } catch {
    throw new Error(`the phone ran out of memory drawing page ${n} of the PDF. Close some apps or browser tabs and try again`);
  }
}

export async function pdfPages(file, onPage) {
  const lib = await load();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(TARGET_WIDTH / base.width, MAX_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      page.cleanup();
      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      // Free the canvas now: Safari on iPhones caps the memory all canvases
      // may use, and over the cap it hands back empty or unreadable images
      // instead of failing (a page is about 35 MB).
      canvas.width = canvas.height = 0;
      await checkImage(blob, n);
      await onPage(blob, n, doc.numPages);
    }
  } finally {
    task.destroy();
  }
}
