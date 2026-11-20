// A stored score that comes back empty (Chrome gives null when a large
// record's file has gone from the disk; seen on Windows as "Cannot read
// properties of null (reading 'images')" at db.js's list): the library shows
// the others, with no error, and it's counted.
// Run against http://localhost:8765/index.html.
const events = []; window.goatcounter = { count: (e) => events.push(e.path) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const idb = (mode, fn) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); fn(tx.objectStore("scores")); tx.oncomplete = () => res(); }; });
const xml = await (await fetch("/testdata/huron_0.musicxml")).text();
await idb("readwrite", (s) => { s.put({ id: "good-1", title: "Still here", created: 2, pages: [xml], images: [] }); s.put({ id: "lost-1", title: "Lost", created: 1, pages: [xml], images: [] }); });
// As Chrome does for the lost one: its value reads as null.
const value = Object.getOwnPropertyDescriptor(IDBCursorWithValue.prototype, "value");
Object.defineProperty(IDBCursorWithValue.prototype, "value", { get() { return this.key === "lost-1" ? null : value.get.call(this); }, configurable: true });
$("new-scan").click(); history.back(); await sleep(800);
const rows = [...document.querySelectorAll("#library li .name")].map((n) => n.textContent);
const errors = events.filter((p) => p.startsWith("error"));
const counted = events.filter((p) => p.startsWith("library: empty record"));
window.result = { rows, errors, counted, toastHidden: $("error-toast").hidden, ok: rows.join() === "Still here" && !errors.length && counted.length === 1 && $("error-toast").hidden };
