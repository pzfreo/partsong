import assert from "node:assert/strict";
import { alignWords, selectedNotes, chooseLyricRegions } from "../lyrics.js";

const notes = [0, 2, 4].map((t, i) => ({ t, dur: 2, midi: 60 + i, pos: { x: 100 + i * 100 } }));
const system = { index: 0, start: 0, end: 6 };
const score = { systems: [system], lines: [{ notes }], measures: [{ sheet: 0, system: 0, start: 0, length: 6, number: 1 }] };
assert.equal(selectedNotes(score, { 0: 0 }, system).length, 3);
assert.equal(alignWords([{ text: "Al-pha", x0: 50, x1: 250 }], notes), "Al- pha _");
const passageNotes = [0, 1, 2, 3].map((t) => ({ t }));
const bars = [{ start: 0, length: 2 }, { start: 2, length: 2 }];
assert.deepEqual(chooseLyricRegions(["shared words other voice"], ["_ _ tenor words"], passageNotes, bars), ["shared words tenor words"]);
assert.deepEqual(chooseLyricRegions(["wrong voice other words"], ["tenor _ own _"], passageNotes, bars), ["tenor _ own _"]);
assert.deepEqual(chooseLyricRegions([], [], passageNotes, bars), []);
console.log("Lyric alignment checks passed");
