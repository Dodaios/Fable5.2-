// Unit tests for the pure helpers of the shader demo. Run: node tests/shader.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = vm.createContext({ console });
for (const file of ["src/js/core.js", "src/js/demos/shader.js"]) {
  vm.runInContext(readFileSync(path.join(repo, file), "utf8"), ctx, { filename: file });
}
const W = ctx.Werkschau;
const S = W.shader;
const arr = (x) => Array.from(x);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const sum = (xs) => arr(xs).reduce((a, v) => a + v, 0);

// registration contract
const def = W.demos.shader;
assert.ok(def, "demo is registered");
assert.deepEqual(arr(W.order), ["shader"]);
for (const key of ["title", "kind", "lead", "moral"]) assert.equal(typeof def[key], "string");
assert.ok(def.facts.length >= 2 && def.facts.length <= 3);
assert.equal(typeof def.mount, "function");
assert.equal(typeof S.create, "function");

// hexToRgb
assert.deepEqual(arr(S.hexToRgb("#fff")), [1, 1, 1]);
assert.deepEqual(arr(S.hexToRgb("#000000")), [0, 0, 0]);
assert.deepEqual(arr(S.hexToRgb(" #FFC233 ")), [1, 0xc2 / 255, 0x33 / 255]);
assert.deepEqual(arr(S.hexToRgb("rgb(35, 54, 220)")), [35 / 255, 54 / 255, 220 / 255]);
assert.deepEqual(arr(S.hexToRgb("rgba(255 0 300 / 0.5)")), [1, 0, 1]);
assert.equal(S.hexToRgb(""), null);
assert.equal(S.hexToRgb("blue"), null);
assert.equal(S.hexToRgb("#12345"), null);
const lin = arr(S.toLinear([0, 0.5, 1]));
near(lin[0], 0); near(lin[2], 1);
assert.ok(lin[1] > 0.2 && lin[1] < 0.23, "mid grey is ~0.218 in linear light");

// clampParams
assert.deepEqual({ ...S.clampParams() }, { ...S.DEFAULTS });
assert.deepEqual({ ...S.clampParams({ shape: 9, unrest: -1, speed: 5, gloss: 2 }) }, { shape: 3, unrest: 0, speed: 2, gloss: 1 });
assert.deepEqual({ ...S.clampParams({ shape: "1.5", unrest: NaN, speed: "x", gloss: null }) },
  { shape: 1.5, unrest: S.DEFAULTS.unrest, speed: S.DEFAULTS.speed, gloss: S.DEFAULTS.gloss });
assert.deepEqual(Object.keys(S.clampParams({ extra: 1 })).sort(), ["gloss", "shape", "speed", "unrest"]);

// shapeWeights: always a partition of 1 over the four shapes
assert.equal(S.SHAPES.length, 4);
for (let i = 0; i < 4; i++) {
  const w = arr(S.shapeWeights(i));
  assert.equal(w[i], 1);
  near(sum(w), 1);
}
assert.deepEqual(arr(S.shapeWeights(1.25)), [0, 0.75, 0.25, 0]);
assert.deepEqual(arr(S.shapeWeights(-3)), [1, 0, 0, 0]);
assert.deepEqual(arr(S.shapeWeights(99)), [0, 0, 0, 1]);
assert.deepEqual(arr(S.shapeWeights("abc")), [1, 0, 0, 0]);
for (let s = 0; s <= 3; s += 0.1) near(sum(S.shapeWeights(s)), 1, 1e-9);

// mixWeights keeps the partition, ease is a monotonic 0..1 curve
const a = S.shapeWeights(0), b = S.shapeWeights(3);
assert.deepEqual(arr(S.mixWeights(a, b, 0)), arr(a));
assert.deepEqual(arr(S.mixWeights(a, b, 1)), arr(b));
for (let t = 0; t <= 1; t += 0.125) near(sum(S.mixWeights(a, b, t)), 1);
assert.equal(S.ease(0), 0);
assert.equal(S.ease(1), 1);
assert.equal(S.ease(-2), 0);
assert.equal(S.ease(7), 1);
near(S.ease(0.5), 0.5);
for (let t = 0, prev = -1; t <= 1; t += 0.05) { const v = S.ease(t); assert.ok(v >= prev); prev = v; }

// orbit camera: stays on its sphere, yaw 0 sits on +z, pitch is clamped above the floor plane
assert.deepEqual(arr(S.orbit(0, 0, 4)), [0, 0, 4]);
const quarter = arr(S.orbit(Math.PI / 2, 0, 4));
near(quarter[0], 4); near(quarter[1], 0); near(quarter[2], 0, 1e-9);
for (const [yaw, pitch] of [[0.3, 0.2], [2.5, 1.0], [-4, -0.2], [9, 0.7]]) {
  const p = arr(S.orbit(yaw, pitch, 4.6));
  near(Math.hypot(...p), 4.6, 1e-9);
}
assert.deepEqual(arr(S.orbit(1, 99, 3)), arr(S.orbit(1, 1.25, 3)));
assert.deepEqual(arr(S.orbit(1, -99, 3)), arr(S.orbit(1, -0.35, 3)));
assert.ok(S.orbit(0, -99, 4.6)[1] > -1.8, "camera never drops below the shadow plane");

// the GLSL source: ASCII only (WebGL 1 rejects anything else), and it carries the advertised constants
assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(S.FRAG), "fragment shader is plain ASCII");
assert.ok(S.FRAG.includes("void main()"));
assert.ok(S.FRAG.includes(`const int STEPS = ${S.STEPS};`));
for (const name of ["sdKugel", "sdRing", "sdKristall", "sdKnoten"]) assert.ok(S.FRAG.includes(`float ${name}(vec3 p)`));
assert.ok(def.facts.some((f) => f.includes(String(S.FRAG.trim().split("\n").length))), "line-count fact matches the source");
assert.ok(def.facts.some((f) => f.includes(String(S.STEPS))), "step-count fact matches the source");

console.log("ok");
