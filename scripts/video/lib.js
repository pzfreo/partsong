window.manualCheck = true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const css = document.createElement("style");
css.textContent = `
#vcap{position:fixed;left:14px;right:14px;z-index:99999;padding:14px 18px;border-radius:16px;background:rgba(24,22,60,.92);color:#fff;
 font:600 19px/1.3 "Plus Jakarta Sans",system-ui,sans-serif;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.25);transition:opacity .35s;opacity:0;pointer-events:none}
#vcap.on{opacity:1} #vcap small{display:block;font-weight:500;font-size:15px;opacity:.85;margin-top:4px}
#vdot{position:fixed;z-index:99998;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,111,89,.45);border:3px solid #ff6f59;pointer-events:none;opacity:0;transform:scale(.6);transition:opacity .2s,transform .2s}
#vdot.on{opacity:1;transform:scale(1)}
#vcard{position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#4f46e5;color:#fff;text-align:center;padding:32px;
 font:700 34px/1.2 "Plus Jakarta Sans",system-ui,sans-serif;transition:opacity .5s}
#vcard small{font-weight:500;font-size:20px;opacity:.9} #vcard img{width:96px;height:96px;border-radius:22px}
#vcard.off{opacity:0;pointer-events:none}`;
document.head.append(css);
const cap = Object.assign(document.createElement("div"), { id: "vcap" });
const dot = Object.assign(document.createElement("div"), { id: "vdot" });
const card = Object.assign(document.createElement("div"), { id: "vcard" });
document.body.append(cap, dot, card);
const say = async (text, sub = "", where = "bottom", ms = 0) => {
  cap.classList.remove("on"); await sleep(250);
  cap.innerHTML = text + (sub ? `<small>${sub}</small>` : "");
  cap.style.top = where === "top" ? "70px" : where === "middle" ? "42%" : "";
  cap.style.bottom = where === "bottom" ? "110px" : "";
  cap.classList.add("on");
  if (ms) await sleep(ms);
};
const hush = async () => { cap.classList.remove("on"); await sleep(300); };
// Into view without scrolling the page behind the settings panel (that closes it).
const into = (el) => {
  const box = el.closest("#panel");
  if (!box) return el.scrollIntoView({ block: "center", behavior: "instant" });
  let p = el.parentElement;
  while (p && p !== box.parentElement && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
  if (!p || p === box.parentElement) return;
  const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
  p.scrollTo({ top: p.scrollTop + r.top - pr.top - pr.height / 2 + r.height / 2, behavior: "smooth" });
};
const tap = async (el, click = true, before = null) => {
  into(el); await sleep(400);
  await sleep(200);
  const r = el.getBoundingClientRect();
  dot.style.left = r.left + r.width / 2 + "px"; dot.style.top = r.top + r.height / 2 + "px";
  dot.classList.add("on"); await sleep(600);
  before?.();
  if (click) el.click();
  await sleep(250); dot.classList.remove("on");
};
const showCard = (html) => { card.innerHTML = html; card.classList.remove("off"); };
const hideCard = async () => { card.classList.add("off"); await sleep(600); };
// Voiceover: the caption shows as its clip starts (marked for the soundtrack);
// vo() waits for the clip, voStart() doesn't (an action runs under it).
let voEnd = 0;
const voStart = async (key, text, sub = "", where = "top") => {
  await say(text, sub, where);
  console.log("__MARK__ vo:" + key);
  voEnd = Date.now() + VO[key] * 1000 + 350;
};
const voWait = async () => { const ms = voEnd - Date.now(); if (ms > 0) await sleep(ms); };
const vo = async (...a) => { await voStart(...a); await voWait(); };
// Everything played reaches the speakers through ctx.destination: copy it to a
// recorder too, for the video's soundtrack (the real sound as settings change).
const tapStreams = new Map();
const connect = AudioNode.prototype.connect;
AudioNode.prototype.connect = function (dest, ...rest) {
  const r = connect.call(this, dest, ...rest);
  if (dest instanceof AudioDestinationNode && dest.context instanceof AudioContext) {
    let t = tapStreams.get(dest.context);
    if (!t) { t = dest.context.createMediaStreamDestination(); tapStreams.set(dest.context, t); }
    connect.call(this, t, ...rest);
  }
  return r;
};
let recorder, chunks = [];
const slide = async (el, to, ms, every = 50) => {
  const from = Number(el.value), steps = Math.max(1, Math.round(ms / every));
  for (let i = 1; i <= steps; i++) { el.value = Math.round(from + ((to - from) * i) / steps); el.dispatchEvent(new Event("input", { bubbles: true })); await sleep(every); }
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

// Taps a point on a page of music (fx, fy: fractions of the page). The point
// is scrolled to the middle of the screen and the pages (scope, e.g.
// "#check-list") zoomed to `zoom` around it, so a tap on a small page shows;
// the same point again just taps. zoomOut() puts the pages back.
let zoomed = null, lastTap = "";
const tapPage = async (scope, p, fx, fy, zoom = 1) => {
  const list = document.querySelector(scope);
  const svg = () => list.querySelectorAll(".page svg")[p];
  if (lastTap !== `${scope} ${p} ${fx} ${fy}`) {
    lastTap = `${scope} ${p} ${fx} ${fy}`;
    // Where the point is with the pages unzoomed (no paint in between).
    const t = list.style.transform; list.style.transition = "none"; list.style.transform = "none";
    const r = svg().getBoundingClientRect(), lr = list.getBoundingClientRect();
    const px = r.left + fx * r.width, py = r.top + fy * r.height;
    list.style.transform = t; void list.offsetWidth;
    list.style.transition = "transform .7s ease, transform-origin .7s ease";
    list.style.transformOrigin = `${px - lr.left}px ${py - lr.top}px`;
    list.style.transform = `scale(${zoom})`;
    zoomed = list;
    list.parentElement.style.overflowX = "clip"; // the zoomed pages mustn't widen the page
    window.scrollBy({ top: py - innerHeight / 2, behavior: "smooth" });
    await sleep(900);
  }
  const r = svg().getBoundingClientRect();
  const x = r.left + fx * r.width, y = r.top + fy * r.height;
  dot.style.left = x + "px"; dot.style.top = y + "px";
  dot.classList.add("on"); await sleep(450);
  svg().dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
  await sleep(250); dot.classList.remove("on");
};
const zoomOut = async () => {
  if (!zoomed) return;
  zoomed.style.transform = "none"; lastTap = ""; zoomed = null;
  await sleep(750);
};
// The recorded music, handed to record.mjs for the soundtrack.
const exportAudio = async () => {
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  window.audioB64 = btoa(bin);
  return bytes.length;
};
