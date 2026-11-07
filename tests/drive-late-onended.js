// Firefox fires a rendering's onended after OfflineAudioContext.startRendering
// resolves, by when render() has put the player's own note list back (undefined
// on a fresh Player). Fired late by hand here, as Firefox does: no error.
// Run against http://localhost:8765/index.html.
const r = { errors: [] };
window.addEventListener("error", (e) => r.errors.push(e.message));
try {
  const { Player } = await import("/player.js");
  const { buildScore, parsePage } = await import("/score.js");
  const pages = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((x) => x.text())));
  const score = buildScore(pages.map((p) => parsePage(p)));
  const oscs = [];
  const make = OfflineAudioContext.prototype.createOscillator;
  OfflineAudioContext.prototype.createOscillator = function () { const o = make.call(this); oscs.push(o); return o; };
  const p = new Player(score);
  const buf = await p.render([{ from: 0, to: 8 }], 22050);
  OfflineAudioContext.prototype.createOscillator = make;
  r.seconds = +buf.duration.toFixed(1);
  r.oscillators = oscs.length;
  for (const o of oscs) { try { o.onended?.(); } catch (e) { r.errors.push(e.message); } }
  r.errorCount = r.errors.length; r.errors = [...new Set(r.errors)];
} catch (e) { r.fatal = String(e.stack ?? e); }
window.result = r;
