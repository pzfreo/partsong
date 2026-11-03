// A score saved before photos were stored as bytes (its photos are Blobs)
// still shows its photos. Blobs have a bytes() method, so the stored-bytes
// test must not mistake one for stored bytes (v155 did, and showed broken
// images). Run with host page http://localhost:8765/testdata/.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pages = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "old", title: "Old photos", created: 1, pages, images }); tx.oncomplete = res; }; });
const f = document.createElement("iframe");
f.style.cssText = "width:412px;height:900px;border:0";
f.src = "/index.html?" + Math.random();
document.body.prepend(f);
await sleep(3000);
const d = f.contentDocument;
const thumb = d.querySelector("#library img");
await sleep(500);
const r = { libraryThumbWidth: thumb?.naturalWidth };
d.querySelector("#library button").click();
await sleep(3000);
r.practice = !d.getElementById("practice").hidden;
r.photoWidths = [...d.querySelectorAll("#photo-list img")].map((i) => i.naturalWidth);
r.ok = r.practice && r.photoWidths.length === 2 && r.photoWidths.every((w) => w > 0) && r.libraryThumbWidth > 0;
window.result = r;
