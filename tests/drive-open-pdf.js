// Open PDF with ordinary sheet music: it opens as a new scan on its pages
// (step 1 of 3), and nothing is read until Read music is tapped. Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
const r = { label: $("open-xml").parentElement.textContent.trim() };
const pdf = new File([await (await fetch("/testdata/huron.pdf")).blob()], "Huron.pdf", { type: "application/pdf" });
const dt = new DataTransfer(); dt.items.add(pdf);
$("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
await waitFor(() => !$("scan").hidden && document.querySelectorAll("#pages img").length === 4, 60000, "pages added");
await sleep(1500);
r.opened = { pages: document.querySelectorAll("#pages img").length, name: $("scan-name").value, status: $("status").textContent, step: document.querySelector("#scan .check-step").textContent, notReading: $("recognise").textContent === "Read music" && $("systems-check").hidden };
$("recognise").click();
await waitFor(() => /Page 1 of 4/.test($("status").textContent) || !$("systems-check").hidden, 60000, "reading started");
r.started = { screen: !$("scan").hidden, pages: document.querySelectorAll("#pages img").length, name: $("scan-name").value };
await shot(false);
r.step3 = await waitFor(() => !$("read-step").hidden && $("read-step").textContent, 900000, "step 3");
await shot(false);
await waitFor(() => !$("practice").hidden, 900000, "read");
r.step3HiddenAfter = $("read-step").hidden;
r.read = { title: $("title").value, bars: $("to-bar").value };
window.result = r;
