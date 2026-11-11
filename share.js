// Score files for sharing between devices or people (WhatsApp, Drive, email):
// a .partsong.pdf, a real PDF of the page photos that anyone can read, with the
// recognised MusicXML and practice settings attached inside it (PDF is one of
// the few types browsers hand to the share sheet, and phones open it anywhere).
// A last page says how to open it in Partsong. Older .partsong.html files (the
// same JSON in a page, photos as base64) still open. (Internal ids keep the
// app's original name, Part Scanner, so older files still open.)

const FORMAT = "partscanner-score";
const SETTINGS = ["mine", "excluded", "manual", "markedStaff", "octave", "tempo", "others", "locked", "repeats", "playRepeats", "layout"];
const PHOTO_QUALITY = 0.85;
// This copy of Partsong (deploys stamp ?v=N on the scripts), for the file's
// debug info.
const VERSION = new URL(import.meta.url).searchParams.get("v") || "dev";
const SHOWN_VERSION = /^\d+$/.test(VERSION) ? `v${VERSION}` : VERSION;
const PAGE_WIDTH = 595.28; // A4 width in PDF points; photo pages keep their shape

function fromBase64(data, type) {
  const s = atob(data);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type });
}

// Same size, so note positions on the photo still line up.
async function asJpeg(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close();
  return { jpeg: await canvas.convertToBlob({ type: "image/jpeg", quality: PHOTO_QUALITY }), width: canvas.width, height: canvas.height };
}

// Older files' link (#import=..., gzipped JSON without photos).
export async function entryFromLink(payload) {
  const gz = fromBase64(payload.replaceAll("-", "+").replaceAll("_", "/"), "application/gzip");
  const json = await new Response(gz.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  const entry = parseScoreFile(json);
  if (entry) entry.photosLeftOut = JSON.parse(json).photos || 0;
  return entry;
}

const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff); // Latin-1
const deflate = async (data, way) =>
  new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(way)).arrayBuffer());
// A PDF text string in WinAnsi (Latin-1 here); anything else becomes "?".
const pdfText = (s) => `(${s.replace(/[^\x20-\xff]/g, "?").replace(/[\\()]/g, "\\$&")})`;

const jpegPhotos = async (entry) => {
  const photos = [];
  for (const blob of entry.images ?? []) photos.push(await asJpeg(blob));
  return photos;
};

export async function scoreFile(entry) {
  return pdfFile(entry, await jpegPhotos(entry));
}

async function pdfFile(entry, photos) {
  const doc = {
    format: FORMAT,
    version: 2,
    id: entry.id,
    title: entry.title,
    created: entry.created,
    pages: entry.pages,
    photos: photos.length, // the PDF's own page images (marked /PartsongPhoto)
    settings: Object.fromEntries(SETTINGS.filter((k) => entry[k] !== undefined).map((k) => [k, entry[k]])),
    // Debug info: which Partsong read the music (kept when a received score is
    // shared on), and which made this file.
    readBy: entry.readBy,
    sharedBy: { version: SHOWN_VERSION, browser: navigator.userAgent, at: Date.now() },
  };
  const appUrl = new URL("./", location.href).href;
  const app = appUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const pages = `${entry.pages.length} page${entry.pages.length === 1 ? "" : "s"}`;
  const lines = [
    ["F2", 20, entry.title],
    ["F1", 12, `A Partsong score (${pages}) for learning your part: ${app}`, true],
    ["F1", 12, ""],
    ["F1", 12, "To practise with it in Partsong:"],
    ["F1", 12, "- Partsong app installed (Android): share this file to Partsong."],
    ["F1", 12, `- Otherwise: open ${app}, tap Open file and choose this file.`, true],
    ["F1", 12, "  On iPhone, first save it from WhatsApp with Share, then Save to Files."],
    ["F1", 12, ""],
    ["F1", 9, `${entry.readBy ? `Read by Partsong ${entry.readBy.version} on ${entry.readBy.device}, ${new Date(entry.readBy.at).toISOString().slice(0, 10)}` : "Read by an earlier version of Partsong"}; this file from ${SHOWN_VERSION}.`],
  ];
  const note = [];
  let y = 780;
  const links = []; // [x0, y0, x1, y1] of the lines naming the app: tapping one opens it
  for (const [font, size, text, link] of lines) {
    note.push(`BT /${font} ${size} Tf 50 ${y} Td ${pdfText(text)} Tj ET`);
    if (link) links.push([48, y - 4, 545, y + size]);
    y -= size + 10;
  }

  // Objects: 1 catalog, 2 pages, 3 info, 4-5 fonts, 6 attachment, 7 its filespec,
  // then per photo page: page, contents, image; then the note page and contents.
  const parts = [];
  const offsets = [];
  let pos = 0;
  const add = (b) => {
    b = typeof b === "string" ? bytes(b) : b;
    parts.push(b);
    pos += b.length;
  };
  const obj = (n, dict, stream) => {
    offsets[n] = pos;
    add(`${n} 0 obj\n${dict}\n`);
    if (stream) {
      add("stream\n");
      add(stream);
      add("\nendstream\n");
    }
    add("endobj\n");
  };
  const pageIds = photos.map((_, i) => 8 + i * 3).concat(8 + photos.length * 3);
  add("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
  const name = "(partsong-score.json)";
  obj(1, `<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [${name} 7 0 R] >> >> >>`);
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  obj(3, `<< /Title ${pdfText(entry.title)} /Creator (Partsong) /Producer (Partsong ${SHOWN_VERSION}) >>`);
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const json = await deflate(JSON.stringify(doc), new CompressionStream("deflate"));
  obj(6, `<< /Type /EmbeddedFile /Subtype /application#2Fjson /PartsongScore 1 /Filter /FlateDecode /Length ${json.length} >>`, json);
  obj(7, `<< /Type /Filespec /F ${name} /UF ${name} /EF << /F 6 0 R >> /Desc (Partsong score: music and settings) >>`);
  for (const [i, { jpeg, width, height }] of photos.entries()) {
    const [page, contents, image] = [8 + i * 3, 9 + i * 3, 10 + i * 3];
    const h = +((PAGE_WIDTH * height) / width).toFixed(2);
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${h}] /Resources << /XObject << /Im ${image} 0 R >> >> /Contents ${contents} 0 R >>`);
    const draw = bytes(`q ${PAGE_WIDTH} 0 0 ${h} 0 0 cm /Im Do Q`);
    obj(contents, `<< /Length ${draw.length} >>`, draw);
    const data = new Uint8Array(await jpeg.arrayBuffer());
    obj(image, `<< /Type /XObject /Subtype /Image /PartsongPhoto ${i} /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>`, data);
  }
  const notePage = 8 + photos.length * 3;
  const text = bytes(note.join("\n"));
  const annots = links.map((_, i) => notePage + 2 + i);
  obj(notePage, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents ${notePage + 1} 0 R /Annots [${annots.map((n) => `${n} 0 R`).join(" ")}] >>`);
  obj(notePage + 1, `<< /Length ${text.length} >>`, text);
  links.forEach((rect, i) => obj(annots[i], `<< /Type /Annot /Subtype /Link /Rect [${rect.join(" ")}] /Border [0 0 0] /A << /S /URI /URI ${pdfText(appUrl)} >> >>`));
  const size = notePage + 2 + links.length;
  const xref = pos;
  add(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let n = 1; n < size; n++) add(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  add(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const title = entry.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Score";
  return new File(parts, `${title}.partsong.pdf`, { type: "application/pdf" });
}

// ---------- relay: share by link ----------
// Sharing uploads the PDF, encrypted on the phone (AES-GCM), to Partsong's
// relay (relay/), and shares just the link <app>#s=<id>.<key> (WhatsApp drops
// a message's text when a file comes with it). The key is only in the link's
// #fragment, which browsers never send, so the relay can't read scores.
// Tapping the link brings the whole score to Safari, Chrome or the installed
// app alike. If the upload fails, the PDF is shared instead.

const RELAY_MAGIC = "PSR1";
const RELAY_WAIT = 60000; // ms before an upload or fetch counts as failed (at least)
const RELAY_MAX = 40e6; // the relay's limit (relay/index.js)
const SLOW_LINK = 50e3; // bytes/s: a big score's upload gets as long as this rate needs
const relayUrl = () => {
  try {
    const own = localStorage.getItem("partsong.relay"); // tests point this at a local relay
    if (own) return own;
  } catch {}
  return "https://partsong-relay.paul-8e3.workers.dev";
};
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

async function relayFetch(path, init = {}) {
  const ctl = new AbortController();
  const wait = Math.max(RELAY_WAIT, ((init.body?.size ?? 0) / SLOW_LINK) * 1000);
  const timer = setTimeout(() => ctl.abort(), wait);
  try {
    const res = await fetch(relayUrl() + path, { ...init, signal: ctl.signal });
    if (res.status === 413) throw new Error("the score is too big for a link");
    if (!res.ok) throw new Error(`the link service said ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// A fingerprint of everything a share carries (title, music, settings, photo
// sizes): the same fingerprint means the same score, so its link can be reused.
export async function shareKey(entry) {
  const what = JSON.stringify([
    entry.title,
    entry.pages,
    SETTINGS.map((k) => entry[k] ?? null),
    (entry.images ?? []).map((b) => b.size),
  ]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(what));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Links last a month (30 days) on the relay; reuse one only while it has a while to run.
export const LINK_REUSE_MS = 23 * 864e5; // at least a week left

// What a share sends: { file, link, why }; link null when the relay couldn't take
// it (then the file is shared), and why says why: too big, too slow, or unreachable.
export async function shareableScore(entry) {
  const file = await scoreFile(entry);
  const id = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const link = `${new URL("./", location.href).href}#s=${id}.${b64url(raw)}`;
  const mb = Math.max(1, Math.round(file.size / 1e6));
  try {
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await file.arrayBuffer());
    const body = new Blob([RELAY_MAGIC, iv, sealed]);
    if (body.size > RELAY_MAX) return { file, link: null, why: `the score is too big for a link (${mb} MB)` };
    await relayFetch(`/s/${id}`, { method: "PUT", body });
    return { file, link };
  } catch (e) {
    const why = e.name === "AbortError" ? `the upload took too long: ${mb} MB on this connection` : e.name === "TypeError" ? "couldn't reach the link service" : e.message;
    return { file, link: null, why };
  }
}

// The score behind a link's fragment (s=<id>.<key>), or null if that isn't one.
// Throws if the relay can't supply it.
export async function entryFromRelay(fragment) {
  const [, id, key64] = /^s=([\w-]{22})\.([\w-]{43})$/.exec(fragment) ?? [];
  if (!id) return null;
  const data = new Uint8Array(await (await relayFetch(`/s/${id}`)).arrayBuffer());
  if (new TextDecoder().decode(data.subarray(0, 4)) !== RELAY_MAGIC) throw new Error("not a Partsong score");
  const key = await crypto.subtle.importKey("raw", unb64url(key64), "AES-GCM", false, ["decrypt"]);
  const pdf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.subarray(4, 16) }, key, data.subarray(16));
  return readScoreFile(new File([pdf], "shared.partsong.pdf", { type: "application/pdf" }));
}

// The stream of the object whose dictionary contains `marker`, from index at.
function streamAt(pdf, text, at) {
  const dictEnd = text.indexOf(">>", at);
  const length = Number(/\/Length (\d+)/.exec(text.slice(text.lastIndexOf("<<", at), dictEnd))?.[1]);
  const m = /stream\r?\n/.exec(text.slice(dictEnd, dictEnd + 40));
  if (!m || !length) return null;
  const start = dictEnd + m.index + m[0].length;
  return pdf.subarray(start, start + length);
}

// A library entry from a .partsong.pdf, or null if it's an ordinary PDF.
async function readPdfScore(file) {
  const pdf = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder("latin1").decode(pdf); // one char per byte
  const at = text.indexOf("/PartsongScore");
  if (at < 0) return null;
  const packed = streamAt(pdf, text, at);
  if (!packed) return null;
  const entry = parseScoreFile(new TextDecoder().decode(await deflate(packed, new DecompressionStream("deflate"))));
  if (!entry) return null;
  const photos = [];
  for (const m of text.matchAll(/\/PartsongPhoto (\d+)/g)) {
    const data = streamAt(pdf, text, m.index);
    if (data) photos[Number(m[1])] = new Blob([data], { type: "image/jpeg" });
  }
  entry.images = photos.filter(Boolean);
  return entry;
}

// A library entry from any score file (.partsong.pdf, or an older
// .partsong.html), or null if the file isn't one.
export async function readScoreFile(file) {
  const head = new TextDecoder("latin1").decode(await file.slice(0, 1024).arrayBuffer());
  if (head.includes("%PDF-")) return readPdfScore(file); // may start up to 1 KB in
  return parseScoreFile(await file.text());
}

// Returns a library entry, or null if the text isn't a score file.
export function parseScoreFile(text) {
  const embedded = text.match(new RegExp(`<script type="application/json" id="${FORMAT}">([\\s\\S]*?)</script>`));
  const json = embedded ? embedded[1] : text.trimStart().startsWith("{") ? text : null;
  if (!json) return null;
  let doc;
  try {
    doc = JSON.parse(json);
  } catch {
    return null;
  }
  if (doc?.format !== FORMAT || !Array.isArray(doc.pages)) return null;
  return {
    ...doc.settings,
    id: doc.id || crypto.randomUUID(),
    title: doc.title || "Shared score",
    created: doc.created || Date.now(),
    pages: doc.pages,
    ...(doc.readBy ? { readBy: doc.readBy } : {}),
    images: (doc.images ?? []).map((d) => fromBase64(d, "image/jpeg")),
  };
}

export const isMobile = () => navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Phones: the share sheet (WhatsApp, Drive, email). Desktop: a plain download,
// even where the browser offers a share menu (e.g. Chrome on macOS).
// "retry" means the share sheet needs a fresh tap (browsers only allow it
// shortly after one).
// A link: the share sheet on phones; on desktop, copied to paste into a message.
// Either way the song's name goes with it: link previews can't show it (the
// score is encrypted, and what identifies it is in the #fragment).
export async function shareLink(link, title) {
  const data = { title, text: `${title}: ${link}` };
  if (isMobile() && navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";
      if (e.name === "NotAllowedError") return "retry";
    }
  }
  try {
    await navigator.clipboard.writeText(data.text);
  } catch (e) {
    // Safari allows copying only straight after a tap: making the link took
    // too long, so it's ready for the next tap. Refused right after a tap
    // (copying blocked), it's an error, or "tap again" would never end.
    if (e.name === "NotAllowedError" && navigator.userActivation?.isActive === false) return "retry";
    throw e;
  }
  return "copied";
}

export async function shareFile(file, title) {
  const data = { files: [file], title };
  if (isMobile() && navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";
      if (e.name === "NotAllowedError") return "retry";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return "downloaded";
}
