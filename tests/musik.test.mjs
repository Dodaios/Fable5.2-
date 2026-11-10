// Unit tests for the pure parts of the Taktwerk demo: node tests/musik.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const base = fileURLToPath(new URL("../src/js/", import.meta.url));
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ["core.js", "demos/musik.js"]) {
  vm.runInContext(fs.readFileSync(base + file, "utf8"), sandbox, { filename: file });
}
const { euclid, generate, stepTime, scaleNotes } = sandbox.Werkschau.musik;
const show = (pattern) => Array.from(pattern, (hit) => (hit ? "x" : ".")).join("");
const plain = (value) => JSON.parse(JSON.stringify(value));   // objects from the vm realm → this realm

// --- Euclidean rhythms (Bjorklund), against the patterns from Toussaint's paper
assert.equal(show(euclid(3, 8)), "x..x..x.");
assert.equal(show(euclid(5, 8)), "x.xx.xx.");
assert.equal(show(euclid(2, 5)), "x.x..");
assert.equal(show(euclid(4, 16)), "x...x...x...x...");
assert.equal(show(euclid(7, 16)), "x..x.x.x..x.x.x.");
assert.equal(show(euclid(0, 8)), "........");
assert.equal(show(euclid(8, 8)), "xxxxxxxx");
assert.equal(show(euclid(12, 8)), "xxxxxxxx", "k is capped at n");
assert.equal(euclid(3, 0).length, 0);
assert.equal(show(euclid(2, 16, 4)), "....x.......x...", "rotation moves the pattern later");
assert.equal(show(euclid(3, 8, 1)), ".x..x..x");
assert.equal(show(euclid(3, 8, 9)), ".x..x..x", "rotation wraps around");
assert.equal(show(euclid(3, 8, -1)), "..x..x.x", "negative rotation moves it earlier");
for (let n = 1; n <= 16; n++) {
  for (let k = 0; k <= n; k++) {
    const pattern = euclid(k, n);
    assert.equal(pattern.length, n);
    assert.equal(pattern.filter(Boolean).length, k, `E(${k},${n}) has ${k} onsets`);
    if (k > 0) assert.equal(pattern[0], 1, `E(${k},${n}) starts on an onset`);
  }
}

// --- generate: deterministic and inside its constraints
const CHORD_ROWS = [0, 3, 5];   // root, fifth, octave in both pentatonic scales
assert.deepEqual(plain(generate(21)), plain(generate(21)), "same seed, same idea");
assert.deepEqual(plain(generate(7, { density: 0.9 })), plain(generate(7, { density: 0.9 })));
assert.notDeepEqual(plain(generate(21)), plain(generate(22)));
const distinct = new Set();
for (let seed = 1; seed <= 400; seed++) {
  for (const density of [0, 0.5, 1]) {
    const idea = generate(seed, { density });
    for (const track of ["kick", "snare", "hat", "bass", "lead"]) assert.equal(idea[track].length, 16, track);
    for (const track of ["kick", "snare", "hat"]) assert.ok(idea[track].every((v) => v === 0 || v === 1), track);
    assert.equal(idea.kick[0], 1, "kick on the one");
    assert.ok(idea.bass.every((v) => Number.isInteger(v) && v >= -1 && v <= 2), "bass rows");
    assert.equal(idea.bass[0], 0, "bass opens on the root");
    assert.ok(idea.lead.every((v) => Number.isInteger(v) && v >= -1 && v <= 6), "melody stays inside its 7 rows");
    const sounding = idea.lead.filter((v) => v >= 0);
    assert.ok(sounding.length >= 2 && sounding.length < 16, `seed ${seed}: melody neither empty nor full`);
    assert.equal(sounding.length, idea.recipe.notes);
    assert.ok(CHORD_ROWS.includes(sounding[0]), `seed ${seed}: melody starts on a chord tone`);
    assert.ok(CHORD_ROWS.includes(sounding[sounding.length - 1]), `seed ${seed}: melody ends on a chord tone`);
    if (density === 0.5) distinct.add(JSON.stringify(idea.lead));
  }
}
assert.ok(distinct.size > 200, "seeds lead to different melodies");
const sparse = generate(5, { density: 0 }).recipe.notes;
const dense = generate(5, { density: 1 }).recipe.notes;
assert.ok(dense > sparse, "density fills up the melody");

// --- stepTime: sixteenth notes, off-beats pushed back by swing
for (let i = 0; i < 40; i++) assert.ok(Math.abs(stepTime(i, 120, 0) - i * 0.125) < 1e-12, "even sixteenths without swing");
assert.ok(Math.abs(stepTime(16, 100, 0) - 2.4) < 1e-12, "one bar at 100 BPM lasts 2.4 s");
assert.ok(Math.abs(stepTime(1, 120, 0.5) - 0.15625) < 1e-12, "off-beat is late by swing × half a sixteenth");
assert.ok(Math.abs(stepTime(2, 120, 0.5) - 0.25) < 1e-12, "on-beats do not move");
assert.equal(stepTime(3, 120, 5), stepTime(3, 120, 0.6), "swing is capped at 60 %");
for (const swing of [0, 0.18, 0.6]) {
  for (const bpm of [70, 104, 160]) {
    for (let i = 1; i < 64; i++) assert.ok(stepTime(i, bpm, swing) > stepTime(i - 1, bpm, swing), "time only moves forward");
  }
}

// --- scaleNotes: seven rows of a pentatonic scale
const cMinor = plain(scaleNotes("C", "moll"));
assert.deepEqual(cMinor.map((n) => n.semitone), [0, 3, 5, 7, 10, 12, 15]);
assert.deepEqual(cMinor.map((n) => n.midi), [60, 63, 65, 67, 70, 72, 75]);
assert.deepEqual(cMinor.map((n) => n.name), ["C4", "Es4", "F4", "G4", "B4", "C5", "Es5"]);
assert.ok(Math.abs(cMinor[0].freq - 261.6256) < 0.001, "C4");
assert.ok(Math.abs(cMinor[3].freq - 391.9954) < 0.001, "G4");
assert.ok(Math.abs(cMinor[5].freq - 523.2511) < 0.001, "C5");
assert.deepEqual(plain(scaleNotes("C", "Moll-Pentatonik")), cMinor, "the long scale name works too");
const aMajor = plain(scaleNotes("A", "dur"));
assert.deepEqual(aMajor.map((n) => n.semitone), [0, 2, 4, 7, 9, 12, 14]);
assert.deepEqual(aMajor.map((n) => n.name), ["A3", "H3", "Cis4", "E4", "Fis4", "A4", "H4"]);
assert.ok(Math.abs(aMajor[0].freq - 220) < 1e-9, "A3");
for (const key of ["C", "D", "E", "F", "G", "A"]) {
  for (const scale of ["moll", "dur"]) {
    const rows = scaleNotes(key, scale);
    assert.equal(rows.length, 7);
    for (let i = 1; i < 7; i++) assert.ok(rows[i].freq > rows[i - 1].freq, "rows rise in pitch");
  }
}

console.log("ok");
