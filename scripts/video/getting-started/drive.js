// Getting started: the sample score from scan to sharing, with the music
// recorded live as the settings change.
await sleep(800);
showCard(`<img src="/icon-192.png" alt="">Partsong<small>Learn your part of a choir piece:<br>photograph the music, then sing along.</small>`);
rec(true);
await sleep(400);
console.log("__MARK__ vo:intro"); await sleep(VO.intro * 1000 + 300);
await hideCard();
// 1. Start: a photo or PDF of the music (here, the sample).
await vo("add", "Take photos of your music, or open a PDF.", "We'll use the sample score.", "middle");
await tap(document.querySelector("#library-empty .try-sample"));
await hush();
await waitFor(() => document.querySelectorAll("#pages img").length === 3 && !$("recognise").disabled, 30000, "sample pages");
await sleep(400);
await vo("pages", "Check your pages are in order,", "then tap Read music.", "middle");
await hush();
await tap($("recognise"));
// 2. Systems check.
await waitFor(() => !$("systems-check").hidden, 600000, "systems check");
rec(false);
await sleep(2500);
rec(true);
await vo("systems", "Red lines show where each line of music ends.", "Usually right: tap between staves to fix one.", "top");
await hush();
await tap($("check-done"));
await vo("reading", "Partsong reads the notes…", "this can take a minute or two", "middle");
rec(false);
await waitFor(() => !$("practice").hidden, 900000, "read");
await sleep(2500);
await hush();
if (!$("panel").hidden) { $("panel-close").click(); await sleep(800); }
rec(true);
// 3. Practice, with the sound as each setting changes.
await vo("score", "Here's your score.", "", "middle");
await hush();
await voStart("pick", "Choose the part you sing.");
await tap($("settings"));
await sleep(500);
const alto = [...document.querySelectorAll("#lines li")].find((li) => /Alto/.test(li.textContent));
into(alto); await sleep(400);
await tap(alto.querySelector('input[type="radio"]') || alto.querySelector(".pick"));
await voWait();
await voStart("play", "Tap play to hear it.");
await tap($("play"), true, () => console.log("__MARK__ play"));
await sleep(80);
const stream = [...tapStreams.values()][0]?.stream;
if (!stream) throw new Error("no audio to record");
recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 160000 });
recorder.ondataavailable = (e) => chunks.push(e.data);
recorder.start(); console.log("__MARK__ music");
await voWait();
await sleep(1500); // all four parts, full
await voStart("others", "Turn the other parts down…", "so your line stands out.");
const others = $("others");
await tap(others, false);
await slide(others, 10, 2500);
await voWait();
await sleep(1500);
await voStart("tempo", "…and slow it down while you learn.");
const tempo = $("tempo");
await tap(tempo, false);
await slide(tempo, 60, 1, 1); // one step: each change restarts playback, cutting the notes sounding
await voWait();
await sleep(800);
await tap($("panel-close"));
await vo("follow", "It follows along as it plays.", "Tap any bar to start from there.");
await sleep(1500);
await tap($("play"), true, () => console.log("__MARK__ stop"));
recorder.stop(); await new Promise((r) => (recorder.onstop = r));
await hush();
// 4. Share.
if ($("panel").hidden) await tap($("settings"));
await sleep(500);
const share = $("share-score");
await voStart("share", "Share your part with the choir:", "they get a link with the score and your settings.");
await tap(share, false);
await voWait();
await hush();
await tap($("panel-close"));
showCard(`<img src="/icon-192.png" alt="">partsong.app<small>Free on your iPhone, Android<br>and desktop.<br>No account needed.</small>`);
await sleep(300);
console.log("__MARK__ vo:end"); await sleep(VO.end * 1000 + 1200);
rec(false);
window.result = { ok: true, audioBytes: await exportAudio() };
