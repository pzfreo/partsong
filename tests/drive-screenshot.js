// A screenshot of Partsong's own page list (small pictures of pages) isn't
// read as music: homr finds a "staff" a few percent of the image wide and
// read it as a bar of invented notes; it now says the page doesn't look like
// sheet music. Needs testdata/rose-1.png. Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
const shot = new File([await (await fetch("/testdata/rose-1.png")).blob()], "rose-1.png", { type: "image/png" });
const dt = new DataTransfer(); dt.items.add(shot);
$("new-scan").click();
await sleep(300);
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
await waitFor(() => document.querySelectorAll("#pages img").length === 1 && !$("recognise").disabled, 60000, "page added");
$("recognise").click();
await waitFor(() => !$("practice").hidden || /sheet music|Couldn't/.test($("status").textContent), 900000, "read");
const r = { read: !$("practice").hidden, status: $("status").textContent.trim() };
r.ok = !r.read && /doesn't look like sheet music/.test(r.status);
window.result = r;
