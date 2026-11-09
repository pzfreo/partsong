// Audit recognition output before playback, retaining page/part/measure IDs
// so an OCR/decoder error can be distinguished from a playback conversion bug.
export function auditRecognition(xml, page, report, { tenor = false } = {}) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  for (const part of doc.querySelectorAll("score-partwise > part")) {
    let meter = 4, divisions = 1;
    for (const measure of part.querySelectorAll("measure")) {
      const prefix = `p${page} ${part.getAttribute("id")} m${measure.getAttribute("number")}`;
      const attributes = measure.querySelector("attributes");
      divisions = Number(attributes?.querySelector("divisions")?.textContent ?? divisions);
      const time = measure.querySelector("time");
      if (time) meter = Number(time.querySelector("beats")?.textContent ?? 4) * 4 / Number(time.querySelector("beat-type")?.textContent ?? 4);
      const rest = measure.querySelector("multiple-rest");
      if (rest) report(`${prefix}: multi-rest=${rest.textContent}; playback=${Number(rest.textContent) * meter} quarter beats. Count comes from recognition; compare with print.`);
      for (const clef of measure.querySelectorAll("clef")) {
        const shift = clef.querySelector("clef-octave-change");
        report(`${prefix}: clef=${clef.querySelector("sign")?.textContent}, octave shift=${shift?.textContent ?? 0}${tenor && !shift ? "; tenor octave marker absent in recognition" : ""}`);
      }
      let cursor = 0, length = 0;
      for (const el of measure.children) {
        const duration = Number(el.querySelector("duration")?.textContent ?? 0) / divisions;
        if (el.tagName === "backup") cursor -= duration;
        else if (el.tagName === "forward" || (el.tagName === "note" && !el.querySelector("chord, grace"))) cursor += duration;
        length = Math.max(length, cursor);
      }
      if (!rest && length > meter + 1e-6) report(`${prefix}: duration overflow ${length} > meter ${meter}; inspect recognized rhythm.`);
    }
  }
}

// Apply only an explicit, user-provided tenor title to an isolated treble part.
// This inference is logged and never applies to an ensemble or bass clef.
export function restoreNamedTenorClef(xml, title, report) {
  if (!/\btenor\b/i.test(title)) return xml;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parts = doc.querySelectorAll("score-partwise > part");
  if (parts.length !== 1 || [...doc.querySelectorAll("staves")].some((el) => Number(el.textContent) > 1)) return xml;
  let changed = false;
  for (const clef of doc.querySelectorAll("clef")) {
    if (clef.querySelector("sign")?.textContent !== "G" || clef.querySelector("clef-octave-change")) continue;
    const shift = doc.createElement("clef-octave-change");
    shift.textContent = "-1";
    clef.append(shift);
    changed = true;
    report("Inferred octave-lower treble clef from the isolated score's Tenor title; applied -12 semitones once.");
  }
  return changed ? new XMLSerializer().serializeToString(doc) : xml;
}
