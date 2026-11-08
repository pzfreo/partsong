// Reads /testdata/corpus/NAME.pdf in Partsong as a user would (Open PDF, Read
// music, systems accepted as found) and compares the result with NAME.xml, the
// edition's MusicXML: bars, systems, and each voice's pitches. A whole-octave
// shift counts as right (the player's pitch setting covers it). Run through
// scripts/corpus-check.sh, which fills in NAME.
const NAME = "__NAME__";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(500); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const r = { name: NAME };
try {
  await sleep(500);
  const pdf = new File([await (await fetch(`/testdata/corpus/${NAME}.pdf`)).blob()], `${NAME}.pdf`, { type: "application/pdf" });
  const dt = new DataTransfer(); dt.items.add(pdf);
  $("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
  await waitFor(() => /^Check the pages/.test($("status").textContent), 120000, "pages added");
  const t0 = performance.now();
  $("recognise").click();
  await waitFor(() => !$("practice").hidden || /fail|couldn't|Couldn't/i.test($("status").textContent), 1800000, "read");
  r.secs = Math.round((performance.now() - t0) / 1000);
  if ($("practice").hidden) throw new Error("read failed: " + $("status").textContent);
  const entry = await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result.sort((a, b) => b.created - a.created)[0]); }; });
  const { buildScore, parsePage } = await import("/score.js");
  const score = buildScore(entry.pages.map(parsePage));
  // The answer key.
  const doc = new DOMParser().parseFromString(await (await fetch(`/testdata/corpus/${NAME}.xml`)).text(), "application/xml");
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const names = Object.fromEntries([...doc.querySelectorAll("part-list score-part")].map((p) => [p.id, p.querySelector("part-name")?.textContent.trim().replace(/\s+/g, " ") || p.id]));
  const truth = [];
  let bars = 0, systems = 1, pages = 1;
  [...doc.querySelectorAll("part")].forEach((part, pi) => {
    const ms = [...part.querySelectorAll(":scope > measure")];
    if (pi === 0) {
      bars = ms.filter((m) => m.getAttribute("implicit") !== "yes" || m === ms[0]).length;
      for (const m of ms) { const p = m.querySelector(":scope > print"); if (p?.getAttribute("new-system") === "yes" || p?.getAttribute("new-page") === "yes") systems++; if (p?.getAttribute("new-page") === "yes") pages++; }
    }
    // Staves the edition hides (print-object="no") aren't on the page.
    if (part.querySelector('staff-details[print-object="no"]')) return;
    // One answer line per staff and voice (two voices can share a staff).
    const byVoice = new Map();
    for (const m of ms) for (const n of m.querySelectorAll(":scope > note")) {
      if (n.querySelector("rest, grace, cue") || n.querySelector("chord")) continue;
      if (n.querySelector('tie[type="stop"]') && !n.querySelector('tie[type="start"]')) continue;
      const key = `${n.querySelector("staff")?.textContent || 1}/${n.querySelector("voice")?.textContent || 1}`;
      const p = n.querySelector("pitch");
      if (!byVoice.has(key)) byVoice.set(key, []);
      byVoice.get(key).push((Number(p.querySelector("octave").textContent) + 1) * 12 + STEP[p.querySelector("step").textContent] + Number(p.querySelector("alter")?.textContent || 0));
    }
    const keys = [...byVoice.keys()].filter((k) => byVoice.get(k).length >= 8).sort();
    for (const k of keys) truth.push({ part: names[part.id] + (keys.length > 1 ? ` [staff/voice ${k}]` : ""), notes: byVoice.get(k) });
  });
  // Longest common subsequence of pitches, as a share of the answer's notes.
  const lcs = (a, b) => { let prev = new Array(b.length + 1).fill(0); for (const x of a) { const cur = [0]; for (let j = 0; j < b.length; j++) cur.push(x === b[j] ? prev[j] + 1 : Math.max(prev[j + 1], cur[j])); prev = cur; } return prev[b.length]; };
  const lines = score.lines.map((l) => ({ label: l.label, notes: l.notes.map((n) => n.midi) }));
  r.pages = entry.pages.length;
  r.pageXml = entry.pages;
  r.parsed = entry.pages.map((x) => parsePage(x).parts.map((p) => ({ name: p.name, staves: p.staves, clef: p.clef, bars: p.measures.length, notes: p.measures.reduce((a, m) => a + m.notes.length, 0), voices: [...new Set(p.measures.flatMap((m) => m.notes.map((n) => `${n.staff}/${n.voice ?? ''}`)))] })));
  r.bars = { truth: bars, read: score.measures.length };
  r.systems = { truth: systems, read: score.systems.length };
  r.lines = lines.map((l) => `${l.label} (${l.notes.length})`);
  // For each answer line: the reader's line sharing most of its pitches, and
  // the best match on any line at a constant shift (a misread clef shifts every note).
  r.parts = truth.map((t) => {
    let best = null, shifted = null;
    lines.forEach((l, i) => {
      // A whole octave out counts as right: the player's pitch setting covers it.
      for (const oct of [0, 12, -12]) {
        const k = lcs(t.notes.map((x) => x + oct), l.notes);
        const f1 = (2 * k) / (t.notes.length + l.notes.length);
        if (!best || f1 > best.f1) best = { i, f1, hit: k / t.notes.length, oct };
      }
      for (let d = -24; d <= 24; d++) {
        if (!d || Math.abs(d) === 12) continue;
        const ks = lcs(t.notes.map((x) => x + d), l.notes);
        if (!shifted || ks > shifted.k) shifted = { i, d, k: ks };
      }
    });
    const out = { part: t.part, notes: t.notes.length, line: best ? `${best.i}:${lines[best.i].label}` : null, pitchesMatched: best ? Math.round(best.hit * 100) : 0, octaveOut: best?.oct ? (best.oct > 0 ? "high" : "low") : undefined };
    if (shifted && shifted.k > (best?.hit ?? 0) * t.notes.length * 1.2) out.shifted = { line: `${shifted.i}:${lines[shifted.i].label}`, semitones: -shifted.d, matched: Math.round((shifted.k / t.notes.length) * 100) };
    return out;
  });
} catch (e) {
  r.error = String(e) + " | status: " + ($("status")?.textContent || "") + " | toast: " + (document.querySelector(".toast, #toast")?.textContent || "");
}
window.result = r;
