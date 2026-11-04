// Stop reading in the systems check's bar, while systems are still being
// found: reading stops, the check closes and Read music is back at the top.
// Run against http://localhost:8765/index.html.
window.manualCheck = true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
const pdf = new File([await (await fetch("/testdata/tree.pdf")).blob()], "tree.pdf", { type: "application/pdf" });
const dt = new DataTransfer(); dt.items.add(pdf);
$("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
await waitFor(() => !$("systems-check").hidden, 600000, "systems check");
const r = { stopInBar: !$("check-stop").hidden, topHidden: $("recognise").hidden };
$("check-stop").click();
await waitFor(() => $("systems-check").hidden, 10000, "check closed");
await sleep(300);
r.after = { status: $("status").textContent, label: $("recognise").textContent, shown: !$("recognise").hidden };
r.ok = r.stopInBar && r.topHidden && /^Stopped/.test(r.after.status) && r.after.label === "Read music" && r.after.shown;
window.result = r;
