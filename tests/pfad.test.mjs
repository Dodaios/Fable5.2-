// Checks the Wegfinder search core against independent reference searches.
// Run: node tests/pfad.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ["../src/js/core.js", "../src/js/demos/pfad.js"]) {
  vm.runInContext(readFileSync(path.join(here, file), "utf8"), sandbox, { filename: file });
}
const { search, makeMaze, makeTerrain, verdict, Heap } = sandbox.Werkschau.pfad.core;
const ALGOS = ["astar", "dijkstra", "bfs", "greedy"];
const COST = [1, 0, 5];
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function rng(seed) { // a different generator than the demo uses (xorshift32)
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// Reference 1: plain breadth-first search → fewest steps (or -1) and the number of reachable cells.
function refBfs(grid, s, t) {
  const dist = new Int32Array(grid.w * grid.h).fill(-1), queue = [s];
  dist[s] = 0;
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q], ux = u % grid.w, uy = (u - ux) / grid.w;
    for (const [dx, dy] of DIRS) {
      const x = ux + dx, y = uy + dy;
      if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
      const v = y * grid.w + x;
      if (grid.cells[v] === 1 || dist[v] !== -1) continue;
      dist[v] = dist[u] + 1; queue.push(v);
    }
  }
  return { steps: dist[t], reachable: queue.length };
}
// Reference 2: Dijkstra without a heap (linear scan) → cheapest cost (or Infinity).
function refCost(grid, s, t) {
  const n = grid.w * grid.h, dist = new Float64Array(n).fill(Infinity), closed = new Uint8Array(n);
  dist[s] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!closed[i] && dist[i] < Infinity && (u === -1 || dist[i] < dist[u])) u = i;
    if (u === -1) break;
    closed[u] = 1;
    const ux = u % grid.w, uy = (u - ux) / grid.w;
    for (const [dx, dy] of DIRS) {
      const x = ux + dx, y = uy + dy;
      if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
      const v = y * grid.w + x;
      if (grid.cells[v] === 1) continue;
      dist[v] = Math.min(dist[v], dist[u] + COST[grid.cells[v]]);
    }
  }
  return dist[t];
}
function checkPath(grid, run, s, t, label) {
  const p = run.path;
  assert.ok(Array.isArray(p) && p.length >= 1, label + ": path missing");
  assert.equal(p[0], s, label + ": path must begin at the start");
  assert.equal(p[p.length - 1], t, label + ": path must end at the goal");
  let cost = 0;
  for (let i = 0; i < p.length; i++) {
    assert.notEqual(grid.cells[p[i]], 1, label + ": path runs through a wall");
    if (!i) continue;
    const ax = p[i - 1] % grid.w, ay = (p[i - 1] - ax) / grid.w, bx = p[i] % grid.w, by = (p[i] - bx) / grid.w;
    assert.equal(Math.abs(ax - bx) + Math.abs(ay - by), 1, label + ": path is not contiguous");
    cost += COST[grid.cells[p[i]]];
  }
  assert.equal(cost, run.cost, label + ": summed terrain cost differs from .cost");
  assert.equal(run.steps, p.length - 1, label + ": .steps differs from the path length");
  assert.equal(new Set(p).size, p.length, label + ": path visits a cell twice");
}

// --- heap: pops in (k1, k2, insertion) order
{
  const h = new Heap(), r = rng(7), items = [];
  for (let i = 0; i < 500; i++) { const e = { n: i, k1: Math.floor(r() * 20), k2: Math.floor(r() * 3) }; items.push(e); h.push(e.n, e.k1, e.k2); }
  items.sort((a, b) => a.k1 - b.k1 || a.k2 - b.k2 || a.n - b.n);
  for (const e of items) assert.equal(h.pop(), e.n, "heap order");
  assert.equal(h.size(), 0);
}

// --- 300 random maps: optimality, effort, validity, determinism
const GRIDS = 300;
let reachableMaps = 0, blockedMaps = 0, bfsWorse = 0, greedyWorse = 0;
for (let seed = 1; seed <= GRIDS; seed++) {
  const r = rng(seed), w = 6 + Math.floor(r() * 30), h = 5 + Math.floor(r() * 18);
  const pWall = 0.08 + r() * 0.3, pSwamp = r() * 0.3, cells = new Uint8Array(w * h);
  for (let i = 0; i < cells.length; i++) { const x = r(); cells[i] = x < pWall ? 1 : x < pWall + pSwamp ? 2 : 0; }
  const s = Math.floor(r() * cells.length);
  let t = Math.floor(r() * cells.length);
  if (t === s) t = (s + 1) % cells.length;
  cells[s] = 0; cells[t] = 0;
  const grid = { w, h, cells }, start = { x: s % w, y: Math.floor(s / w) }, goal = { x: t % w, y: Math.floor(t / w) };
  const ref = refBfs(grid, s, t), best = refCost(grid, s, t), label = "seed " + seed;
  const runs = Object.fromEntries(ALGOS.map((a) => [a, search(grid, start, goal, a).run()]));

  for (const a of ALGOS) {
    const run = runs[a], l = label + " " + a;
    assert.equal(run.done, true, l + ": not done");
    assert.equal(run.found, ref.steps !== -1, l + ": found flag disagrees with reachability");
    let closed = 0;
    for (let i = 0; i < run.state.length; i++) if (run.state[i] === 2) closed++;
    assert.equal(run.visitedCount, closed, l + ": visitedCount differs from the visited cells");
    if (run.found) checkPath(grid, run, s, t, l);
    else {
      assert.equal(run.path, null, l); assert.equal(run.cost, Infinity, l);
      assert.equal(run.visitedCount, ref.reachable, l + ": an exhausted search visits every reachable cell");
    }
    // stepping one cell at a time gives the identical result, and every step visits exactly one cell
    const again = search(grid, start, goal, a);
    let steps = 0;
    while (!again.done) { const before = again.visitedCount; again.step(); steps++; assert.equal(again.visitedCount, before + 1, l + ": one cell per step"); }
    assert.equal(steps, run.visitedCount, l);
    assert.equal(again.cost, run.cost, l + ": not deterministic");
    assert.equal(JSON.stringify(again.path), JSON.stringify(run.path), l + ": not deterministic");
    assert.equal(again.step(), false, l + ": step() after the end must be a no-op");
  }
  if (ref.steps === -1) { blockedMaps++; continue; }
  reachableMaps++;
  assert.equal(runs.dijkstra.cost, best, label + ": Dijkstra is not optimal");
  assert.equal(runs.astar.cost, runs.dijkstra.cost, label + ": A* and Dijkstra disagree on the cost");
  assert.ok(runs.astar.visitedCount <= runs.dijkstra.visitedCount, label + ": A* visited more cells than Dijkstra");
  assert.equal(runs.bfs.steps, ref.steps, label + ": breadth-first search did not find the fewest steps");
  assert.ok(runs.bfs.cost >= best && runs.greedy.cost >= best, label + ": cheaper than the optimum is impossible");
  assert.ok(runs.greedy.steps >= ref.steps, label);
  if (runs.bfs.cost > best) bfsWorse++;
  if (runs.greedy.cost > best) greedyWorse++;

  // the verdict sentence must not contradict the numbers, for every pairing
  const sum = (run) => ({ algo: run.algo, found: run.found, visited: run.visitedCount, cost: run.cost, steps: run.steps });
  for (const a of ALGOS) for (const b of ALGOS) {
    const text = verdict(sum(runs[a]), sum(runs[b]), sum(runs.dijkstra));
    assert.ok(text.length > 20 && !/undefined|NaN|Infinity|null/.test(text), label + ` verdict ${a}/${b}: ${text}`);
    const bothBest = runs[a].cost === best && runs[b].cost === best;
    if (a !== b) assert.equal(text.startsWith("Beide finden den günstigsten Weg"), bothBest, label + ` verdict ${a}/${b}: ${text}`);
    if (a !== b && runs[a].cost > best && runs[b].cost > best) assert.ok(text.startsWith("Keine der beiden"), text);
  }
}
assert.ok(reachableMaps >= 150 && blockedMaps >= 10, `need both kinds of maps (reachable ${reachableMaps}, blocked ${blockedMaps})`);
assert.ok(bfsWorse > 0 && greedyWorse > 0, "the random maps should include cases where BFS and greedy are not optimal");

// --- an enclosed goal: nobody finds a way, everybody says so
{
  const w = 9, h = 7, cells = new Uint8Array(w * h);
  for (const [x, y] of [[5, 2], [6, 2], [7, 2], [5, 3], [7, 3], [5, 4], [6, 4], [7, 4]]) cells[y * w + x] = 1;
  const grid = { w, h, cells };
  for (const a of ALGOS) {
    const run = search(grid, { x: 1, y: 3 }, { x: 6, y: 3 }, a).run();
    assert.equal(run.found, false, a + ": enclosed goal");
    assert.equal(run.path, null); assert.equal(run.cost, Infinity);
    assert.equal(run.visitedCount, w * h - 9, a + ": visits all cells outside the box");
  }
  const none = { algo: "astar", found: false, visited: 54, cost: Infinity, steps: Infinity };
  assert.ok(verdict(none, { ...none, algo: "bfs" }, none).startsWith("Kein Weg"));
  cells[1 * 0 + 0] = 1; // a walled start cell ends at once
  assert.equal(search(grid, { x: 0, y: 0 }, { x: 3, y: 3 }, "astar").run().found, false);
}

// --- mazes: closed border, endpoints free, every open cell connected, seeded
for (const [w, h] of [[35, 21], [21, 13], [11, 11], [34, 20], [5, 5]]) {
  for (let seed = 1; seed <= 25; seed++) {
    const m = makeMaze(w, h, seed), label = `maze ${w}x${h} seed ${seed}`;
    assert.equal(m.w, w); assert.equal(m.h, h); assert.equal(m.cells.length, w * h);
    let open = 0;
    for (let i = 0; i < m.cells.length; i++) { assert.ok(m.cells[i] <= 2, label); if (m.cells[i] !== 1) open++; }
    for (let x = 0; x < w; x++) { assert.equal(m.cells[x], 1, label + ": top border"); assert.equal(m.cells[(h - 1) * w + x], 1, label + ": bottom border"); }
    for (let y = 0; y < h; y++) { assert.equal(m.cells[y * w], 1, label + ": left border"); assert.equal(m.cells[y * w + w - 1], 1, label + ": right border"); }
    assert.notEqual(m.cells[w + 1], 1, label + ": cell (1,1) is open");
    if (w % 2 && h % 2) assert.notEqual(m.cells[(h - 2) * w + w - 2], 1, label + ": far corner is open");
    assert.equal(refBfs(m, w + 1, w + 1).reachable, open, label + ": maze is not fully connected");
    assert.equal(JSON.stringify(Array.from(makeMaze(w, h, seed).cells)), JSON.stringify(Array.from(m.cells)), label + ": same seed, same maze");
  }
}
assert.notEqual(JSON.stringify(Array.from(makeMaze(35, 21, 1).cells)), JSON.stringify(Array.from(makeMaze(35, 21, 2).cells)), "seeds must matter");

// --- terrain: valid cells, seeded, with walls and swamp
{
  const a = makeTerrain(35, 21, 5), b = makeTerrain(35, 21, 5), c = makeTerrain(35, 21, 6);
  assert.equal(a.cells.length, 35 * 21);
  assert.equal(JSON.stringify(Array.from(a.cells)), JSON.stringify(Array.from(b.cells)));
  assert.notEqual(JSON.stringify(Array.from(a.cells)), JSON.stringify(Array.from(c.cells)));
  const kinds = new Set(Array.from(a.cells));
  assert.ok(kinds.has(0) && kinds.has(1) && kinds.has(2) && kinds.size === 3);
}

console.log(`ok (${GRIDS} random maps: ${reachableMaps} with a way, ${blockedMaps} without; BFS not cheapest on ${bfsWorse}, greedy on ${greedyWorse})`);
