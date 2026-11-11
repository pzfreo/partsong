// A received score file brings only the settings a share carries: any other
// field in its settings (e.g. pending, which would make it a scan to carry on
// reading at each launch) is left out, and a malformed list of parts not
// played is dropped.
//   node tests/received-settings.mjs
import assert from "node:assert/strict";
const { parseScoreFile } = await import("../share.js");
const file = (settings) => JSON.stringify({ format: "partscanner-score", title: "T", pages: ["<x/>"], settings });
const got = parseScoreFile(file({ tempo: 96, mine: 2, excluded: [1], pending: true, stopped: false, shareAllowed: true, id: "x", images: [1] }));
assert.deepEqual([got.tempo, got.mine, got.excluded], [96, 2, [1]]);
for (const k of ["pending", "stopped", "shareAllowed"]) assert.ok(!(k in got), `${k} came through`);
assert.notEqual(got.id, "x");
assert.ok(!("excluded" in parseScoreFile(file({ excluded: 5 }))));
assert.equal(parseScoreFile(file(undefined)).title, "T");
console.log("Received settings checks passed");
