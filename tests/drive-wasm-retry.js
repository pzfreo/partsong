// The reader's own WebAssembly is fetched again when the connection drops
// while it downloads (Android v260: "WebAssembly compilation aborted: Network
// error: Response body loading was aborted" failed the read). Serve with
// `python3 scripts/flaky-server.py 8769 --flaky-wasm` (each omr/*.wasm is cut
// halfway the first time) and run against http://localhost:8769/tests/omr-test.html?page=huron_1.png:
// the page is still read, after one retry.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = () => document.getElementById("log").textContent;
const end = Date.now() + 600000;
while (!window.result && !/ERROR/.test(lines()) && Date.now() < end) await sleep(500);
const retries = lines().split("\n").filter((l) => /"stage":"retry"/.test(l) && /\.wasm/.test(l)).length;
window.result = { read: !!window.result?.xml, retries, error: (lines().match(/ERROR.*/) || [""])[0], ok: !!window.result?.xml && retries >= 1 };
