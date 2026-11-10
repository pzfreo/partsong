// Difficult scores: fixing the red lines (systems) and marking your part, on
// score.ly (In the Bleak Midwinter laid out to trip Partsong up: verse 1 on
// four staves with one system's bracket hidden, so it's split; verse 4 on two
// staves with two systems close, so they're merged). Positions are fractions of
// the page, measured on the check screen.
await sleep(800);
showCard(`<img src="/icon-192.png" alt="">Difficult scores<small>Fixing the lines of music,<br>and marking your part</small>`);
rec(true);
await sleep(400);
console.log("__MARK__ vo:intro"); await sleep(VO.intro * 1000 + 300);
await hideCard();
await voStart("open", "This carol changes layout:", "four staves for verse 1, two for the last verse.", "middle");
const openPdf = $("open-xml").closest("label");
await tap(openPdf, false);
const pdf = new File([await (await fetch("/video-demo/score.pdf")).blob()], "In the Bleak Midwinter.pdf", { type: "application/pdf" });
const dt = new DataTransfer(); dt.items.add(pdf);
$("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
await waitFor(() => /^Check the pages/.test($("status").textContent) && !$("recognise").disabled, 60000, "pages added");
await voWait();
await hush();
await tap($("recognise"));
// The check screen, once every page's systems are found.
await waitFor(() => !$("check-done").hidden, 600000, "systems found");
rec(false);
window.scrollTo({ top: $("systems-check").getBoundingClientRect().top + scrollY - 60, behavior: "instant" });
await sleep(1500);
rec(true);
await vo("systems", "Red lines mark where each line of music ends.", "", "top");
await voStart("remove", "Here it split one line of music in two:", "tap the red line to remove it.", "top");
await sleep(600);
await tapPage("#check-list", 0, 0.35, 432 / 990, 2.2);
await sleep(1200);
await voWait();
await voStart("add", "Here two lines of music run together:", "tap between them to add a red line.", "top");
await sleep(600);
await tapPage("#check-list", 1, 0.35, 304 / 990, 2.2);
await sleep(1200);
await voWait();
await zoomOut();
await hush();
await voStart("next", "Then tap Next, and Partsong reads the notes.", "", "middle");
await tap($("check-done"));
await voWait();
rec(false);
await waitFor(() => !$("practice").hidden, 900000, "read");
await sleep(2500);
await hush();
if ($("panel").hidden) { $("settings").click(); await sleep(800); }
into($("lines")); await sleep(800);
rec(true);
await voStart("parts", "When the layout changes, the list of parts can be a muddle,", "so mark your part on the music instead.", "top");
await sleep(2500);
await tap($("start-markup"));
await voWait();
await voStart("mark", "Tap your staff in each line of music.", "Here, the alto.", "top");
for (const y of [175, 375, 641, 835]) await tapPage("#photo-list", 0, 0.35, y / 990, 1.8);
await voWait();
await voStart("shared", "Where two voices share a staff:", "tap once for the upper voice, twice for the lower.", "top");
// Zoomed on the right-hand end, where the mark's "upper voice"/"lower voice" label shows.
for (const y of [75, 222, 318, 485]) { await tapPage("#photo-list", 1, 0.92, y / 990, 1.8); await sleep(700); await tapPage("#photo-list", 1, 0.92, y / 990, 1.8); await sleep(700); }
await voWait();
await zoomOut();
await hush();
await voStart("play", "Tap Done, then play:", "Partsong plays just what you marked.", "top");
await tap($("markup-done"));
window.scrollTo({ top: 0, behavior: "smooth" }); await sleep(800);
await tap($("play"), true, () => console.log("__MARK__ play"));
await sleep(80);
const stream = [...tapStreams.values()][0]?.stream;
if (!stream) throw new Error("no audio to record");
recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 160000 });
recorder.ondataavailable = (e) => chunks.push(e.data);
recorder.start(); console.log("__MARK__ music");
await voWait();
await sleep(6000);
await tap($("play"), true, () => console.log("__MARK__ stop"));
recorder.stop(); await new Promise((r) => (recorder.onstop = r));
await hush();
showCard(`<img src="/icon-192.png" alt="">partsong.app<small>Free on your iPhone, Android<br>and desktop.</small>`);
await sleep(300);
console.log("__MARK__ vo:end"); await sleep(VO.end * 1000 + 1200);
rec(false);
window.result = { ok: true, audioBytes: await exportAudio() };
