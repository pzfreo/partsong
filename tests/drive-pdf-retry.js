// A PDF opened after pdf.js failed to load (a dropped connection on a phone)
// loads pdf.js again instead of failing until the page is reloaded.
// Serve with `python3 tests/flaky-server.py . 3` (pdf.js fails 3 times: all
// of the first PDF's tries) and run against http://127.0.0.1:8766/index.html:
// the first PDF fails, the second opens (before: both failed).
const { pdfPages } = await import("/pdf-pages.js");
const pdf = new File([await (await fetch("/samples/tallis-if-ye-love-me.pdf")).blob()], "s.pdf", { type: "application/pdf" });
const open = () => pdfPages(pdf, async () => {}).then(() => "ok", (e) => "failed: " + e.message);
const r = { first: await open(), second: await open() };
r.ok = r.second === "ok";
window.result = r;
