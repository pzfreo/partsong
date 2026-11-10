// Help is one hub (learn-your-choir-part.html): every website page's footer is
// just "Help" pointing there, and every link to a section of a page
// (page.html#id) finds that id. Run: node tests/help-links.mjs
import fs from "node:fs";
const pages = fs.readdirSync(".").filter((f) => f.endsWith(".html"));
const hub = "learn-your-choir-part.html";
const bad = [];
for (const p of pages) {
  const html = fs.readFileSync(p, "utf8");
  if (p !== "index.html" && p !== hub) {
    const footers = html.match(/<p class="legal-links">.*<\/p>/g) ?? [];
    if (footers.length !== 1 || footers[0] !== `<p class="legal-links"><a href="${hub}">Help</a></p>`) bad.push(`${p}: footer ${footers}`);
  }
  for (const [, target, id] of html.matchAll(/href="([a-z-]*\.html)?#([\w-]+)"/g)) {
    const t = target || p;
    if (!fs.existsSync(t) || !fs.readFileSync(t, "utf8").includes(`id="${id}"`)) bad.push(`${p}: ${t}#${id} has no target`);
  }
}
for (const p of pages) if (p !== hub && p !== "index.html" && !fs.readFileSync(hub, "utf8").includes(`href="${p}"`)) bad.push(`${hub} doesn't link ${p}`);
console.log(bad.length ? bad.join("\n") : `ok: ${pages.length} pages`);
process.exit(bad.length ? 1 : 0);
