// Lyrics are aligned to the selected playback notes, leaving the source XML
// intact. One editor token per onset; '_' means a note without a new syllable.
export function alignWords(words, notes) {
  const tokens = notes.map(() => "_");
  for (const word of words) {
    const pieces = word.text.replace(/[_—]+/g, "").split(/[-‐–]/).filter(Boolean);
    pieces.forEach((text, i) => {
      const x = word.x0 + (word.x1 - word.x0) * (i + 0.5) / pieces.length;
      let best = -1, distance = Infinity;
      notes.forEach((n, j) => {
        if (!n.pos || tokens[j] !== "_") return;
        if (Math.abs(n.pos.x - x) < distance) [best, distance] = [j, Math.abs(n.pos.x - x)];
      });
      if (best >= 0) tokens[best] = text + (i < pieces.length - 1 || /[-‐–]$/.test(word.text) ? "-" : "");
    });
  }
  return tokens.join(" ");
}

export function selectedNotes(score, manual, system) {
  const id = manual[system.index];
  const byTime = new Map();
  for (const n of score.lines[id]?.notes ?? []) {
    if (n.t + n.dur > system.start && n.t < system.end && !byTime.has(n.t)) byTime.set(n.t, n);
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

// Choose one source per bar, not one global side and not a mixture of voices
// at every empty note. Dedicated lyrics below take precedence; shared lyrics
// between staves fill passages that have no dedicated text.
export function chooseLyricRegions(above, below, notes, bars) {
  const upper = above.map((row) => row.trim().split(/\s+/));
  const lower = below.map((row) => row.trim().split(/\s+/));
  const result = notes.map(() => "_");
  const hasText = (row, i) => row[i] && row[i] !== "_";
  for (const bar of bars) {
    const indices = notes.flatMap((note, i) => note.t >= bar.start && note.t < bar.start + bar.length ? [i] : []);
    const candidate = (rows) => rows.map((row) => ({ row, count: indices.filter((i) => hasText(row, i)).length }))
      .find(({ row, count }) => count > 1 || (count === 1 && indices.some((i) => hasText(row, i) && (!/\p{Script=Tamil}/u.test(row[i]) || [...row[i]].length >= 4))));
    // The nearest row above is the last one; below it is the first one.
    // Do not pick a distant voice merely because it has more syllables.
    const dedicated = candidate(lower);
    const shared = candidate([...upper].reverse());
    const source = dedicated?.count ? dedicated.row : shared?.count ? shared.row : null;
    if (source) for (const i of indices) result[i] = source[i] ?? "_";
  }
  return result.some((token) => token !== "_") ? [result.join(" ")] : [];
}

const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

// Match the playback selection back to source notes by their image positions.
// Source part ordering can change when SA/TB becomes four separate staves.
export function filterSelectedPart(xml, score, manual, sheet) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parts = [...doc.querySelectorAll("score-partwise > part")];
  const wanted = new Map();
  const bars = score.measures.filter((b) => b.sheet === sheet);
  for (const bar of bars) {
    const line = score.lines[manual[bar.system]];
    if (!line) continue;
    const notes = line.notes.filter((n) => n.pos && n.t >= bar.start && n.t < bar.start + bar.length);
    for (const note of notes) {
      let nearest = null, distance = Infinity;
      for (const part of parts) {
        const measure = [...part.children].filter((el) => el.tagName === "measure")[bar.sheetBar];
        for (const candidate of measure?.querySelectorAll("note") ?? []) {
          const comment = [...candidate.childNodes].find((c) => c.nodeType === 8 && /imgpos:/.test(c.data));
          const pos = comment?.data.match(/imgpos:\s*(-?\d+),\s*(-?\d+)/);
          if (!pos) continue;
          const d = Math.hypot(Number(pos[1]) - note.pos.x, Number(pos[2]) - note.pos.y);
          if (d < distance) [nearest, distance] = [{ part, candidate }, d];
        }
      }
      if (!nearest || distance > 100) continue;
      const { part, candidate } = nearest;
      const staff = candidate.querySelector("staff")?.textContent ?? "1";
      const voice = candidate.querySelector("voice")?.textContent ?? "1";
      const staves = wanted.get(part) ?? new Map();
      const selection = staves.get(staff) ?? { all: false, voices: new Set() };
      selection.all ||= line.voice === "only";
      selection.voices.add(voice);
      staves.set(staff, selection);
      wanted.set(part, staves);
    }
  }
  // MusicXML without image coordinates can still be selected by its part key.
  if (!wanted.size) {
    const keys = new Set(bars.map((bar) => score.lines[manual[bar.system]]?.staffKey).filter(Boolean));
    const seen = {};
    for (const part of parts) {
      const count = Math.max(1, ...[...part.querySelectorAll("attributes > staves")].map((el) => Number(el.textContent)));
      const index = seen[count] ?? 0;
      seen[count] = index + 1;
      for (const key of keys) if (key.startsWith(`${count}#${index}/`)) {
        wanted.set(part, new Map([[key.split("/")[1], { all: true, voices: new Set() }]]));
      }
    }
  }
  const keep = new Set();
  for (const part of parts) {
    const staves = wanted.get(part);
    if (!staves) { part.remove(); continue; }
    keep.add(part.getAttribute("id"));
    const numbers = [...staves.keys()].sort((a, b) => Number(a) - Number(b));
    const renumber = (n) => String(numbers.indexOf(n) + 1);
    for (const measure of [...part.children].filter((el) => el.tagName === "measure")) {
      for (const note of [...measure.querySelectorAll("note")]) {
        const staff = note.querySelector("staff")?.textContent ?? "1";
        const selection = staves.get(staff);
        const voice = note.querySelector("voice")?.textContent ?? "1";
        if (!selection || (!selection.all && !selection.voices.has(voice))) {
          // Preserve the original time cursor, including backup/forward, while
          // removing other voices. Chord notes do not advance that cursor.
          const duration = note.querySelector("duration");
          if (duration && !note.querySelector("chord, grace")) {
            const forward = doc.createElement("forward");
            forward.append(duration.cloneNode(true));
            note.replaceWith(forward);
          } else note.remove();
        } else if (note.querySelector("staff")) note.querySelector("staff").textContent = renumber(staff);
      }
      for (const attrs of measure.querySelectorAll("attributes")) {
        const count = attrs.querySelector("staves");
        if (count) count.textContent = numbers.length;
        for (const el of attrs.querySelectorAll("clef, key, time, staff-details")) {
          const n = el.getAttribute("number");
          if (n && !staves.has(n)) el.remove();
          else if (n) el.setAttribute("number", renumber(n));
        }
        // Unnumbered clefs belong to staff 1. If only staff 2 is retained,
        // its numbered clef above becomes the first clef instead.
        if (!staves.has("1")) for (const clef of attrs.querySelectorAll("clef:not([number])")) clef.remove();
      }
    }
  }
  for (const part of doc.querySelectorAll("part-list > score-part")) if (!keep.has(part.getAttribute("id"))) part.remove();
  doc.querySelectorAll("part-list > part-group").forEach((el) => el.remove());
  if (!keep.size) return null;
  return new XMLSerializer().serializeToString(doc);
}

// Add lyrics to a copy of the original MusicXML. Never reconstruct pitches,
// durations, clefs, meters, ties, or rests from the playback representation.
export function addLyricsToXml(xml, score, manual, verses, sheet, placement = "below") {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parts = [...doc.querySelectorAll("score-partwise > part")];
  const used = new Set();
  for (const system of score.systems) {
    const notes = selectedNotes(score, manual, system);
    const rows = (verses[system.index] ?? []).map((row) => row.trim().split(/\s+/));
    if (!rows.length) continue;
    for (const [index, note] of notes.entries()) {
      if (note.t < system.start || !note.pos) continue;
      const bar = score.measures.find((b) => b.sheet === sheet && note.t >= b.start && note.t < b.start + b.length);
      if (!bar) continue;
      let target = null, distance = Infinity;
      for (const part of parts) {
        const measure = [...part.children].filter((el) => el.tagName === "measure")[bar.sheetBar];
        for (const candidate of measure?.querySelectorAll("note") ?? []) {
          if (!candidate.querySelector("pitch") || used.has(candidate)) continue;
          const comment = [...candidate.childNodes].find((c) => c.nodeType === 8 && /imgpos:/.test(c.data));
          const pos = comment?.data.match(/imgpos:\s*(-?\d+),\s*(-?\d+)/);
          if (!pos) continue;
          const d = Math.hypot(Number(pos[1]) - note.pos.x, Number(pos[2]) - note.pos.y);
          if (d < distance) [target, distance] = [candidate, d];
        }
      }
      if (!target || distance > 100) continue;
      const lyrics = rows.flatMap((tokens, verse) => {
        const token = tokens[index];
        if (!token || token === "_") return [];
        const previous = tokens[index - 1]?.endsWith("-");
        const next = token.endsWith("-");
        const syllabic = previous ? (next ? "middle" : "end") : (next ? "begin" : "single");
        return [`<lyric number="${verse + 1}" placement="${placement === "above" ? "above" : "below"}"><syllabic>${syllabic}</syllabic><text>${escapeXml(token.replace(/-$/, ""))}</text></lyric>`];
      });
      if (!lyrics.length) continue;
      used.add(target);
      target.querySelectorAll("lyric").forEach((el) => el.remove());
      for (const lyric of lyrics) target.append(doc.importNode(new DOMParser().parseFromString(lyric, "application/xml").documentElement, true));
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

export async function recognizeVerses(image, page, staff, bottom, notes, worker, language = "eng") {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(page.w);
  canvas.height = Math.max(1, Math.round(bottom - staff.y1));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = image.naturalHeight / page.h;
  ctx.drawImage(image, 0, staff.y1 * scale, image.naturalWidth, canvas.height * scale, 0, 0, canvas.width, canvas.height);
  // Remove long lyric extension lines before locating text rows. These lines
  // and note stems otherwise confuse paragraph OCR into dropping syllables.
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const ink = (x, y) => {
    const i = (y * canvas.width + x) * 4;
    return Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) < 160;
  };
  for (let y = 0; y < canvas.height; y++) {
    let start = 0;
    for (let x = 0; x <= canvas.width; x++) {
      if (x < canvas.width && ink(x, y)) continue;
      if (x - start > canvas.width * 0.025) {
        for (let p = start; p < x; p++) {
          const i = (y * canvas.width + p) * 4;
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
        }
      }
      start = x + 1;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const rows = [];
  for (let y = 0; y < canvas.height; y++) {
    let count = 0;
    for (let x = Math.round(canvas.width * 0.16); x < canvas.width * 0.97; x++) if (ink(x, y)) count++;
    if (count >= 2) rows.push(y);
  }
  const bands = [];
  for (const y of rows) {
    const last = bands.at(-1);
    if (last && y - last.end <= 4) last.end = y;
    else bands.push({ start: y, end: y });
  }
  const verses = [];
  for (const band of bands) {
    if (band.end - band.start < 7) continue;
    // Do not trim rows to the height of the first detected fragment: a
    // note stem can be shorter than the text and would cut off every letter.
    const top = Math.max(0, band.start - 3);
    const height = Math.min(canvas.height, band.end + 4) - top;
    await worker.setParameters({ tessedit_pageseg_mode: height > 45 ? "6" : "7", preserve_interword_spaces: "1" });
    const line = document.createElement("canvas");
    const padding = 16;
    line.width = canvas.width * 2;
    line.height = height * 2 + padding * 2;
    const lc = line.getContext("2d");
    lc.fillStyle = "white";
    lc.fillRect(0, 0, line.width, line.height);
    lc.drawImage(canvas, 0, top, canvas.width, height, 0, padding, canvas.width * 2, height * 2);
    const { data } = await worker.recognize(line, {}, { tsv: true });
    const groups = new Map();
    for (const row of (data.tsv ?? "").split("\n").slice(1)) {
      const c = row.split("\t");
      const key = c.slice(1, 5).join("/");
      if (c[0] === "5" && /^[-‐–]$/.test(c[11]?.trim())) {
        const previous = groups.get(key)?.at(-1);
        if (previous) previous.text += "-";
        continue;
      }
      // Short sung syllables are often low confidence; retaining them is
      // preferable to silently deleting them from the score.
      if (c[0] !== "5" || Number(c[10]) < 0 || !/[\p{L}]/u.test(c[11] ?? "")) continue;
      // In Tamil mode, music-shaped Latin guesses are not lyric candidates.
      if (language === "tam" && !/\p{Script=Tamil}/u.test(c[11])) continue;
      const words = groups.get(key) ?? [];
      words.push({ text: c[11], confidence: Number(c[10]), x0: Number(c[6]) / 2, x1: (Number(c[6]) + Number(c[8])) / 2 });
      groups.set(key, words);
    }
    for (const words of groups.values()) {
      const confidence = words.reduce((sum, word) => sum + word.confidence, 0) / words.length;
      if (confidence < 55) continue;
      // Isolated low-confidence fragments are usually dynamics or note tails,
      // not an extra verse. Keep low-confidence syllables within real lines.
      if (words.length === 1 && (words[0].confidence < 60 || /[()<>]/.test(words[0].text))) continue;
      if (words.length) verses.push(alignWords(words, notes));
    }
  }
  return verses;
}
