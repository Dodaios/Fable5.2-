// Sternpost: brute-force solver over the launch grid, using the same simulation core as the game.
// Run: node tests/orbit.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const ctx = { console, Math, JSON };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["src/js/core.js", "src/js/demos/orbit.js"]) vm.runInContext(fs.readFileSync(rootDir + f, "utf8"), ctx, { filename: f });

const demo = ctx.Werkschau.demos.orbit;
const core = ctx.Werkschau.orbit.core;
assert.equal(typeof demo.mount, "function");
assert.equal(core.levels.length, 6);

const A0 = -180, A1 = 180, P0 = 20, P1 = 100;           // 361 angles × 81 thrust values
const total = (A1 - A0 + 1) * (P1 - P0 + 1);
const rows = [];
const shares = [];

core.levels.forEach((lv, i) => {
  // 1) solver: how much of the launch grid delivers the capsule?
  let hits = 0;
  for (let a = A0; a <= A1; a++) for (let p = P0; p <= P1; p++) if (core.simulate(lv, a, p).result === "hit") hits++;
  assert.ok(hits > 0, `Level ${i + 1} hat keine Lösung im Raster`);
  shares.push(hits / total);

  // 2) the stored solution delivers, stays inside the visible field, and is reproducible
  const s = lv.solution;
  const run = core.simulate(lv, s.angle, s.power, { path: true });
  assert.equal(run.result, "hit", `Level ${i + 1}: gespeicherte Lösung trifft nicht`);
  for (let k = 0; k < run.path.length; k += 2) {
    assert.ok(run.path[k] >= 0 && run.path[k] <= core.WORLD.w && run.path[k + 1] >= 0 && run.path[k + 1] <= core.WORLD.h,
      `Level ${i + 1}: Lösung verlässt das Feld`);
  }
  const again = core.simulate(lv, s.angle, s.power);
  assert.equal(again.steps, run.steps, `Level ${i + 1}: Simulation nicht deterministisch`);
  assert.deepEqual(again.end, run.end);

  // 3) stepping the flight by hand (what the game loop does) gives the same flight
  const f = core.createFlight(lv, s.angle, s.power);
  while (!core.step(lv, f)) { /* fly */ }
  assert.equal(f.result, "hit");
  assert.equal(f.step, run.steps);

  // 4) the opening aim is not already a solution; aiming straight at the station at full thrust only works in level 1
  assert.notEqual(core.simulate(lv, lv.aim.angle, lv.aim.power).result, "hit", `Level ${i + 1}: Startzielung löst das Level`);
  const direct = Math.atan2(-(lv.target.y - lv.pad.y), lv.target.x - lv.pad.x) * 180 / Math.PI;
  const straight = core.simulate(lv, direct, P1).result;
  if (i === 0) assert.equal(straight, "hit", "Level 1 soll mit einem geraden Schuss lösbar sein");
  else assert.notEqual(straight, "hit", `Level ${i + 1} ist mit einem geraden Vollschub-Schuss lösbar`);

  rows.push({
    Level: `${i + 1} ${lv.name}`, Par: lv.par,
    "Treffer im Raster": hits, "Anteil %": (100 * hits / total).toFixed(2),
    "Lösung": `${s.angle}° / ${s.power}`, "Flugzeit s": (run.steps * core.DT).toFixed(1),
    "Gerader Vollschub": straight
  });
});

// 5) every later level is clearly harder than level 1
for (let i = 1; i < shares.length; i++) {
  assert.ok(shares[i] <= shares[0] * 0.6, `Level ${i + 1} ist nicht deutlich schwerer als Level 1`);
}

console.table(rows);
console.log(`Raster: ${A1 - A0 + 1} Winkel × ${P1 - P0 + 1} Schubwerte = ${total} Starts je Level`);
console.log("ok");
