// Run with: node tests/unison-gap.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

// Exercise the internal voice splitter without needing a browser DOMParser.
const source = readFileSync(new URL("../score.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf("function splitStaff("), source.indexOf("// Scores read before voice tags")), context);
const note = (start, dur, tag, midi = 67) => ({ start, dur, tag, midi, staffKey: "1#2/1" });
// Pearsall, bar 27: whole G tagged upper2, then half G in both voices.
const notes = [note(0, 4, "upper2"), note(4, 2, "upper2"), note(4, 2, "upper")];
const split = (extra = []) => context.splitStaff([...notes, ...extra]);
assert.ok(split().high.some((n) => n.start === 0 && n.dur === 4 && n.midi === 67));
assert.equal(split().low.length, 2);
assert.equal(split([note(0, 4, "upper", null)]).high.length, 1);
assert.ok(!split([note(0, 4, "upper", 65)]).high.some((n) => n.start === 0 && n.midi === 67));
assert.equal(context.splitStaff([note(0, 4, "upper2", 69), ...notes.slice(1)]).high.length, 1);
console.log("Unison gap checks passed");
