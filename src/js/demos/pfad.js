/* Wegfinder: two graph searches race on one shared grid map. No dependencies. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var W = root.Werkschau;

  var FREE = 0, WALL = 1, SWAMP = 2;
  var COST = [1, 0, 5]; // cost to ENTER a cell, by terrain (walls are never entered)
  var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  var ALGO_IDS = ["astar", "dijkstra", "bfs", "greedy"];
  var ALGOS = {
    astar: { name: "A*", subj: "A*", mid: "A*" },
    dijkstra: { name: "Dijkstra", subj: "Dijkstra", mid: "Dijkstra" },
    bfs: { name: "Breitensuche", subj: "Die Breitensuche", mid: "die Breitensuche" },
    greedy: { name: "Gierige Bestensuche", subj: "Die gierige Bestensuche", mid: "die gierige Bestensuche" }
  };

  /* ---------- core: RNG, heap, searches, map generators (pure, DOM-free) ---------- */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Binary min-heap ordered by (k1, k2, insertion order): deterministic, stable ties. */
  function Heap() { this.a = []; this.seq = 0; }
  function less(x, y) {
    if (x.k1 !== y.k1) return x.k1 < y.k1;
    if (x.k2 !== y.k2) return x.k2 < y.k2;
    return x.q < y.q;
  }
  Heap.prototype.size = function () { return this.a.length; };
  Heap.prototype.peek = function () { return this.a[0].n; };
  Heap.prototype.push = function (node, k1, k2) {
    var a = this.a, e = { n: node, k1: k1, k2: k2, q: this.seq++ }, i = a.length;
    a.push(e);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (!less(e, a[p])) break;
      a[i] = a[p]; i = p;
    }
    a[i] = e;
  };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop(), n = a.length, i = 0;
    if (n) {
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = l;
        if (l >= n) break;
        if (r < n && less(a[r], a[l])) m = r;
        if (!less(a[m], last)) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top.n;
  };

  /* A search as a state machine: every step() expands exactly one cell.
     state[i]: 0 unseen, 1 frontier, 2 visited. order[i]: when it was visited. */
  function search(grid, start, goal, algo) {
    var w = grid.w, h = grid.h, cells = grid.cells, n = w * h, i;
    var s = start.y * w + start.x, t = goal.y * w + goal.x, gx = goal.x, gy = goal.y;
    var g = new Float64Array(n), parent = new Int32Array(n), state = new Uint8Array(n), order = new Int32Array(n);
    for (i = 0; i < n; i++) { g[i] = Infinity; parent[i] = -1; order[i] = -1; }
    var heap = new Heap();
    var relax = algo === "astar" || algo === "dijkstra"; // these two compare path costs
    var st = {
      algo: algo, done: false, found: false, visitedCount: 0,
      path: null, cost: null, steps: null, state: state, order: order,
      step: step, run: function () { while (!st.done) step(); return st; }
    };

    function push(v) {
      var x = v % w, hh = Math.abs(x - gx) + Math.abs((v - x) / w - gy); // Manhattan distance
      if (algo === "astar") heap.push(v, g[v] + hh, hh);
      else if (algo === "dijkstra") heap.push(v, g[v], 0);
      else if (algo === "greedy") heap.push(v, hh, 0);
      else heap.push(v, 0, 0); // breadth-first: pure insertion order
    }
    function finish(found) {
      st.done = true; st.found = found;
      if (!found) { st.cost = Infinity; st.steps = Infinity; return; }
      var p = [], c = t;
      while (c !== -1) { p.push(c); c = parent[c]; }
      p.reverse();
      st.path = p; st.cost = g[t]; st.steps = p.length - 1;
    }
    function step() {
      if (st.done) return false;
      while (heap.size()) {
        var u = heap.pop();
        if (state[u] === 2) continue; // outdated duplicate
        state[u] = 2; order[u] = st.visitedCount++;
        if (u === t) { finish(true); return true; }
        var ux = u % w, uy = (u - ux) / w;
        for (var d = 0; d < 4; d++) {
          var vx = ux + DX[d], vy = uy + DY[d];
          if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
          var v = vy * w + vx;
          if (cells[v] === WALL || state[v] === 2) continue;
          var ng = g[u] + COST[cells[v]];
          if (relax ? ng < g[v] : state[v] === 0) { g[v] = ng; parent[v] = u; state[v] = 1; push(v); }
        }
        while (heap.size() && state[heap.peek()] === 2) heap.pop();
        if (!heap.size()) finish(false);
        return true;
      }
      finish(false);
      return false;
    }

    if (cells[s] === WALL || cells[t] === WALL) finish(false);
    else { g[s] = 0; state[s] = 1; push(s); }
    return st;
  }

  /* Recursive backtracker on the odd-coordinate lattice, then a few extra openings and swamp cells. */
  function makeMaze(w, h, seed) {
    var rnd = mulberry32(seed), cells = new Uint8Array(w * h), i, x, y;
    var rw = (w - 1) >> 1, rh = (h - 1) >> 1;
    if (rw < 1 || rh < 1) return { w: w, h: h, cells: cells };
    for (i = 0; i < cells.length; i++) cells[i] = WALL;
    var seen = new Uint8Array(rw * rh), stack = [0];
    seen[0] = 1; cells[w + 1] = FREE;
    while (stack.length) {
      var cur = stack[stack.length - 1], cx = cur % rw, cy = (cur - cx) / rw, opts = [];
      for (var d = 0; d < 4; d++) {
        var nx = cx + DX[d], ny = cy + DY[d];
        if (nx >= 0 && ny >= 0 && nx < rw && ny < rh && !seen[ny * rw + nx]) opts.push(d);
      }
      if (!opts.length) { stack.pop(); continue; }
      var dir = opts[Math.floor(rnd() * opts.length)], tx = cx + DX[dir], ty = cy + DY[dir];
      cells[(2 * cy + 1 + DY[dir]) * w + (2 * cx + 1 + DX[dir])] = FREE;
      cells[(2 * ty + 1) * w + (2 * tx + 1)] = FREE;
      seen[ty * rw + tx] = 1; stack.push(ty * rw + tx);
    }
    for (y = 1; y < 2 * rh; y++) for (x = 1; x < 2 * rw; x++) {
      var between = (x % 2 === 0) !== (y % 2 === 0); // a wall separating two rooms
      if (between && cells[y * w + x] === WALL && rnd() < 0.09) cells[y * w + x] = FREE;
    }
    for (i = 0; i < cells.length; i++) if (cells[i] === FREE && rnd() < 0.07) cells[i] = SWAMP;
    return { w: w, h: h, cells: cells };
  }

  /* Open terrain: swamp patches plus straight wall segments. */
  function makeTerrain(w, h, seed) {
    var rnd = mulberry32(seed), cells = new Uint8Array(w * h), i, x, y, k;
    var blobs = 3 + Math.floor(rnd() * 3);
    for (i = 0; i < blobs; i++) {
      var bx = rnd() * w, by = rnd() * h, r = 2.2 + rnd() * 3;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        if (Math.hypot(x - bx, (y - by) * 1.15) + rnd() * 1.2 < r) cells[y * w + x] = SWAMP;
      }
    }
    var segs = Math.round((w * h) / 40);
    for (i = 0; i < segs; i++) {
      x = Math.floor(rnd() * w); y = Math.floor(rnd() * h);
      var horiz = rnd() < 0.5, len = 3 + Math.floor(rnd() * 7);
      for (k = 0; k < len; k++) {
        var xx = horiz ? x + k : x, yy = horiz ? y : y + k;
        if (xx < w && yy < h) cells[yy * w + xx] = WALL;
      }
    }
    return { w: w, h: h, cells: cells };
  }

  /* One German verdict from two finished results and the true optimum.
     a, b, opt: { algo, found, visited, cost, steps }. */
  function verdict(a, b, opt) {
    var f = W.fmt, A = ALGOS[a.algo], B = ALGOS[b.algo];
    if (!a.found || !b.found) {
      if (a.visited <= 1) return "Kein Weg: Der Start ist ringsum eingemauert.";
      return "Kein Weg: Start und Ziel sind durch Mauern getrennt. " + (a.visited === b.visited
        ? "Beide Seiten haben alle " + f(a.visited) + " erreichbaren Felder abgesucht."
        : "Links wurden " + f(a.visited) + " Felder abgesucht, rechts " + f(b.visited) + ".");
    }
    if (a.algo === b.algo) {
      return "Links und rechts läuft derselbe Algorithmus (" + A.name + "): Kosten " + f(a.cost) + ", " +
        f(a.steps) + " Schritte, " + f(a.visited) + " besuchte Felder. " + (a.cost > opt.cost
          ? "Der günstigste Weg kostet " + f(opt.cost) + "."
          : "Wähle auf einer Seite einen anderen für den Vergleich.");
    }
    var aOpt = a.cost === opt.cost, bOpt = b.cost === opt.cost;
    if (aOpt !== bOpt) {
      var good = aOpt ? a : b, bad = aOpt ? b : a;
      var why = bad.algo === "bfs"
        ? "Die Breitensuche zählt nur Schritte: Ihr Weg ist so kurz wie möglich (" + f(bad.steps) + " Schritte), kostet aber " + f(bad.cost) + "."
        : ALGOS[bad.algo].subj + " schaut nur auf die Entfernung zum Ziel, nicht auf die bisherigen Kosten: Ihr Weg kostet " + f(bad.cost) + ".";
      var near = Math.abs(bad.visited - good.visited) < 0.1 * Math.max(bad.visited, good.visited);
      var work = bad.visited === good.visited
        ? "Beide besuchen " + f(bad.visited) + " Felder."
        : near
          ? "Die Arbeit ist fast gleich: " + f(bad.visited) + " besuchte Felder gegenüber " + f(good.visited) + "."
          : bad.visited < good.visited
            ? "Dafür ist sie schneller fertig: " + f(bad.visited) + " besuchte Felder statt " + f(good.visited) + "."
            : "Dabei besucht sie sogar mehr Felder: " + f(bad.visited) + " statt " + f(good.visited) + ".";
      return ALGOS[good.algo].subj + " findet den günstigsten Weg (Kosten " + f(opt.cost) + "). " + why + " " + work;
    }
    var quality = aOpt
      ? "Beide finden den günstigsten Weg (Kosten " + f(opt.cost) + ")."
      : "Keine der beiden findet den günstigsten Weg (Kosten " + f(opt.cost) + "): " + A.subj + " kommt auf " + f(a.cost) + ", " + B.mid + " auf " + f(b.cost) + ".";
    if (a.visited === b.visited) return quality + " Beide besuchen " + (aOpt ? "dafür " : "") + f(a.visited) + " Felder.";
    var few = a.visited < b.visited ? a : b, many = few === a ? b : a;
    var pct = Math.round((1 - few.visited / many.visited) * 100);
    return quality + " " + ALGOS[few.algo].subj + " besucht " + (aOpt ? "dafür " : "") + f(few.visited) + " Felder, " +
      ALGOS[many.algo].mid + " " + f(many.visited) + "." +
      (pct >= 1 ? " Das sind " + pct + " % weniger Arbeit für " + ALGOS[few.algo].mid + "." : "");
  }

  function summary(run) {
    return { algo: run.algo, found: run.found, visited: run.visitedCount, cost: run.cost, steps: run.steps };
  }

  W.pfad = { core: { search: search, makeMaze: makeMaze, makeTerrain: makeTerrain, verdict: verdict, Heap: Heap, algorithms: ALGO_IDS.slice() } };

  /* ---------- the demo UI ---------- */

  var GW = 35, GH = 21;           // odd sizes, so the maze gets a closed border
  var FIRST_SEED = 2045;          // the map shown at rest
  var SPEEDS = [0.2, 0.34, 0.5, 1, 2, 3, 5, 8, 14, 30]; // cells per frame for Tempo 1–10
  var TOKENS = ["--surface", "--surface-2", "--ink", "--ink-2", "--ink-3", "--line", "--sun", "--sun-ink", "--accent", "--series-fable", "--series-opus"];

  function mount(rootEl) {
    var el = W.el;
    var seed = FIRST_SEED, grid, start, goal, optimum;
    var tool = WALL, mode = "done", raf = 0, onScreen = true, acc = 0, speed = SPEEDS[4];
    var colors = {}, cursor = { x: 1, y: 1 }, drag = null, destroyed = false;
    var sides = [
      { algo: "astar", token: "--series-fable", mod: "a", where: "links" },
      { algo: "dijkstra", token: "--series-opus", mod: "b", where: "rechts" }
    ];

    /* --- controls --- */
    var toolBtns = [[WALL, "Mauer"], [SWAMP, "Sumpf"], [FREE, "Radierer"]].map(function (t) {
      return el("button", { type: "button", "aria-pressed": String(t[0] === tool), onclick: function () {
        tool = t[0];
        toolBtns.forEach(function (b, i) { b.setAttribute("aria-pressed", String([WALL, SWAMP, FREE][i] === tool)); });
      } }, t[1]);
    });
    var startBtn = el("button", { type: "button", class: "btn btn--primary", onclick: onStart }, "Start");
    var stepBtn = el("button", { type: "button", class: "btn", onclick: onStep }, "Schritt");
    var tempoOut = el("output", { for: "d-pfad-tempo" }, "5");
    var tempo = el("input", { type: "range", id: "d-pfad-tempo", min: "1", max: "10", step: "1", value: "5", oninput: function () {
      speed = SPEEDS[tempo.value - 1]; tempoOut.textContent = tempo.value;
    } });
    var verdictEl = el("p", { class: "d-pfad-verdict", role: "status", "aria-live": "polite" });

    sides.forEach(function (sd) {
      sd.select = el("select", { class: "select", id: "d-pfad-algo-" + sd.mod, "aria-label": "Algorithmus " + sd.where,
        onchange: function () { sd.algo = sd.select.value; recompute(); } },
        ALGO_IDS.map(function (id) { return el("option", { value: id }, ALGOS[id].name); }));
      sd.select.value = sd.algo;
      sd.canvas = el("canvas", { tabindex: "0", role: "application", "aria-label": "Karte " + sd.where +
        ". Pfeiltasten bewegen den Cursor, die Leertaste malt mit dem gewählten Werkzeug, S setzt den Start, Z das Ziel." });
      sd.ctx = sd.canvas.getContext("2d");
      sd.vVisited = el("dd"); sd.vCost = el("dd"); sd.vSteps = el("dd");
      sd.panel = el("section", { class: "d-pfad-side", "aria-label": "Suche " + sd.where },
        el("div", { class: "d-pfad-head" },
          el("span", { class: "d-pfad-swatch d-pfad-swatch--" + sd.mod, "aria-hidden": "true" }),
          el("span", { class: "demo-h" }, sd.where === "links" ? "Links" : "Rechts"),
          sd.select),
        el("div", { class: "demo-canvas d-pfad-map" }, sd.canvas),
        el("dl", { class: "kv" },
          el("dt", null, "Besuchte Felder"), sd.vVisited,
          el("dt", null, "Wegkosten"), sd.vCost,
          el("dt", null, "Weglänge"), sd.vSteps));
      sd.col = el("div", { class: "d-pfad-col" }, sd.panel);
      wireCanvas(sd);
    });

    function key(mod, label) { return el("li", { class: "d-pfad-key d-pfad-key--" + mod }, el("i", { "aria-hidden": "true" }), label); }
    var duo = el("div", { class: "d-pfad-duo" }, sides[0].col, sides[1].col);
    var wrap = el("div", { class: "d-pfad" },
      el("div", { class: "demo-bar d-pfad-tools" },
        el("div", { class: "seg", role: "group", "aria-label": "Werkzeug" }, toolBtns),
        el("div", { class: "d-pfad-group", role: "group", "aria-label": "Karte" },
          el("button", { type: "button", class: "btn btn--sm", onclick: function () { generate("maze"); } }, "Labyrinth"),
          el("button", { type: "button", class: "btn btn--sm", onclick: function () { generate("terrain"); } }, "Gelände"),
          el("button", { type: "button", class: "btn btn--sm", onclick: clearMap }, "Leeren")),
        el("span", { class: "spacer" }),
        el("div", { class: "d-pfad-group d-pfad-group--run", role: "group", "aria-label": "Ablauf" },
          el("label", { class: "field d-pfad-tempo" }, el("span", { class: "field-row" }, "Tempo", tempoOut), tempo),
          stepBtn, startBtn)),
      duo,
      verdictEl,
      el("ul", { class: "d-pfad-legend", "aria-label": "Legende" },
        key("start", "Start"), key("goal", "Ziel"), key("wall", "Mauer"), key("swamp", "Sumpf (kostet 5 statt 1)"),
        key("va", "besucht, links"), key("vb", "besucht, rechts"), key("front", "Rand der Suche"), key("path", "gefundener Weg")),
      el("p", { class: "note" }, "Male mit Maus oder Finger auf eine der beiden Karten, beide teilen sich dieselbe. Start und Ziel lassen sich ziehen. " +
        "Tastatur: Pfeiltasten bewegen den Cursor, die Leertaste malt, S und Z setzen Start und Ziel."));
    rootEl.appendChild(wrap);

    /* --- map + search state --- */
    function at(p) { return p.y * GW + p.x; }
    function build(kind, s) {
      grid = kind === "maze" ? makeMaze(GW, GH, s) : makeTerrain(GW, GH, s);
      if (kind === "maze") { start = { x: 1, y: 1 }; goal = { x: GW - 2, y: GH - 2 }; }
      else {
        var r = mulberry32(s ^ 0x9e3779b9);
        start = { x: 1 + Math.floor(r() * 4), y: 1 + Math.floor(r() * (GH - 2)) };
        goal = { x: GW - 2 - Math.floor(r() * 4), y: 1 + Math.floor(r() * (GH - 2)) };
      }
      grid.cells[at(start)] = FREE; grid.cells[at(goal)] = FREE;
      return search(grid, start, goal, "bfs").run().found;
    }
    function generate(kind) {
      for (var tries = 0; tries < 40; tries++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        if (build(kind, seed)) break; // re-roll maps on which no way exists
      }
      recompute();
    }
    function clearMap() { grid.cells.fill(FREE); recompute(); }
    function fresh() { sides.forEach(function (sd) { sd.run = search(grid, start, goal, sd.algo); }); }
    function allDone() { return sides[0].run.done && sides[1].run.done; }
    function advance() { sides.forEach(function (sd) { if (!sd.run.done) sd.run.step(); }); }
    /* Any change to map, endpoints or algorithms lands here: never a stale result on screen. */
    function recompute() {
      stop(); fresh();
      sides.forEach(function (sd) { sd.run.run(); });
      optimum = summary(search(grid, start, goal, "dijkstra").run());
      mode = "done"; refresh();
    }

    /* --- race control --- */
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    function kick() { if (!raf && onScreen && mode === "running" && !destroyed) raf = requestAnimationFrame(frame); }
    function frame() {
      raf = 0;
      if (mode !== "running" || destroyed) return;
      acc += speed;
      var k = Math.floor(acc); acc -= k;
      while (k-- > 0) advance();
      if (allDone()) { mode = "done"; refresh(); return; }
      drawAll(); updateStats(); kick();
    }
    function onStart() {
      if (mode === "running") { stop(); mode = "paused"; refresh(); return; }
      if (mode === "done") {
        if (W.reducedMotion()) { recompute(); return; } // no animation: show the finished result
        fresh(); acc = 0;
      }
      mode = "running"; refresh(); kick();
    }
    function onStep() {
      stop();
      if (mode === "done") fresh();
      mode = "paused"; advance();
      if (allDone()) mode = "done";
      refresh();
    }

    /* --- editing --- */
    function isEnd(x, y) { return (x === start.x && y === start.y) || (x === goal.x && y === goal.y); }
    function setCell(x, y, t) {
      var i = y * GW + x;
      if (isEnd(x, y) || grid.cells[i] === t) return false;
      grid.cells[i] = t; return true;
    }
    function moveEnd(which, x, y) {
      if (grid.cells[y * GW + x] === WALL || isEnd(x, y)) return false;
      var p = which === "start" ? start : goal;
      p.x = x; p.y = y; return true;
    }
    function paintLine(a, b) { // Bresenham, so fast drags leave no gaps
      var x = a.x, y = a.y, dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y);
      var sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1, err = dx + dy, changed = false;
      for (;;) {
        if (setCell(x, y, tool)) changed = true;
        if (x === b.x && y === b.y) break;
        var e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
      }
      return changed;
    }
    function cellAt(cv, ev) {
      var r = cv.getBoundingClientRect();
      var x = Math.floor(((ev.clientX - r.left) / r.width) * GW), y = Math.floor(((ev.clientY - r.top) / r.height) * GH);
      return { x: Math.max(0, Math.min(GW - 1, x)), y: Math.max(0, Math.min(GH - 1, y)) };
    }
    function wireCanvas(sd) {
      var cv = sd.canvas;
      cv.addEventListener("pointerdown", function (ev) {
        if (ev.button) return;
        var c = cellAt(cv, ev);
        sd.kb = false;
        try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic pointer */ }
        if (c.x === start.x && c.y === start.y) drag = { type: "start" };
        else if (c.x === goal.x && c.y === goal.y) drag = { type: "goal" };
        else { drag = { type: "paint", last: c }; if (setCell(c.x, c.y, tool)) recompute(); }
      });
      cv.addEventListener("pointermove", function (ev) {
        if (!drag) return;
        var c = cellAt(cv, ev);
        if (drag.type === "paint") {
          var changed = paintLine(drag.last, c);
          drag.last = c;
          if (changed) recompute();
        } else if (moveEnd(drag.type, c.x, c.y)) recompute();
      });
      function end() { drag = null; }
      cv.addEventListener("pointerup", end);
      cv.addEventListener("pointercancel", end);
      cv.addEventListener("keydown", function (ev) {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return; // leave browser shortcuts alone
        var k = ev.key, used = true;
        if (k === "ArrowLeft") cursor.x = Math.max(0, cursor.x - 1);
        else if (k === "ArrowRight") cursor.x = Math.min(GW - 1, cursor.x + 1);
        else if (k === "ArrowUp") cursor.y = Math.max(0, cursor.y - 1);
        else if (k === "ArrowDown") cursor.y = Math.min(GH - 1, cursor.y + 1);
        else if (k === " " || k === "Enter") { if (setCell(cursor.x, cursor.y, tool)) recompute(); }
        else if (k === "s" || k === "S") { if (moveEnd("start", cursor.x, cursor.y)) recompute(); }
        else if (k === "z" || k === "Z") { if (moveEnd("goal", cursor.x, cursor.y)) recompute(); }
        else used = false;
        if (used) { ev.preventDefault(); sd.kb = true; drawAll(); }
      });
      cv.addEventListener("focus", function () {
        try { sd.kb = cv.matches(":focus-visible"); } catch (e) { sd.kb = true; }
        draw(sd);
      });
      cv.addEventListener("blur", function () { sd.kb = false; draw(sd); });
    }

    /* --- drawing --- */
    function readColors() { TOKENS.forEach(function (n) { colors[n] = W.token(n); }); }
    function draw(sd) {
      var c = sd.cell, ctx = sd.ctx, r = sd.run;
      if (!c || !r) return;
      var cells = grid.cells, n = GW * GH, i, x, y, tint = colors[sd.token];
      var total = Math.max(1, r.visitedCount - 1), pad = c >= 10 ? 2 : 1;
      ctx.setTransform(sd.dpr, 0, 0, sd.dpr, 0, 0);
      ctx.globalAlpha = 1; ctx.fillStyle = colors["--surface"]; ctx.fillRect(0, 0, GW * c, GH * c);
      for (i = 0; i < n; i++) { // terrain tint, then the search wash on top
        if (cells[i] === WALL) continue;
        x = (i % GW) * c; y = Math.floor(i / GW) * c;
        if (cells[i] === SWAMP) { ctx.globalAlpha = 1; ctx.fillStyle = colors["--surface-2"]; ctx.fillRect(x, y, c, c); }
        if (r.state[i] === 2) { ctx.globalAlpha = 0.16 + 0.36 * (r.order[i] / total); ctx.fillStyle = tint; ctx.fillRect(x, y, c, c); }
        else if (r.state[i] === 1) { ctx.globalAlpha = 0.9; ctx.fillStyle = tint; ctx.fillRect(x + pad, y + pad, c - 2 * pad, c - 2 * pad); }
      }
      ctx.globalAlpha = 0.7; ctx.strokeStyle = colors["--line"]; ctx.lineWidth = 1; ctx.beginPath();
      for (x = 1; x < GW; x++) { ctx.moveTo(x * c + 0.5, 0); ctx.lineTo(x * c + 0.5, GH * c); }
      for (y = 1; y < GH; y++) { ctx.moveTo(0, y * c + 0.5); ctx.lineTo(GW * c, y * c + 0.5); }
      ctx.stroke();
      ctx.globalAlpha = 0.75; ctx.strokeStyle = colors["--ink-3"]; ctx.beginPath(); // swamp hatch, 45°
      for (i = 0; i < n; i++) {
        if (cells[i] !== SWAMP) continue;
        x = (i % GW) * c; y = Math.floor(i / GW) * c;
        ctx.moveTo(x + 2, y + c - 1.5); ctx.lineTo(x + c - 1.5, y + 2);
      }
      ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = colors["--ink-2"];
      for (i = 0; i < n; i++) if (cells[i] === WALL) ctx.fillRect((i % GW) * c, Math.floor(i / GW) * c, c, c);
      if (r.done && r.found) { // the way: sun line on a dark casing, readable in both themes
        ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
        r.path.forEach(function (p, j) {
          var px = (p % GW + 0.5) * c, py = (Math.floor(p / GW) + 0.5) * c;
          if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        });
        var lw = c >= 12 ? 3 : 2.5;
        ctx.strokeStyle = colors["--sun-ink"]; ctx.lineWidth = lw + 2.5; ctx.stroke();
        ctx.strokeStyle = colors["--sun"]; ctx.lineWidth = lw; ctx.stroke();
      }
      var rad = Math.max(4.5, c * 0.46), sx = (start.x + 0.5) * c, sy = (start.y + 0.5) * c, gx = (goal.x + 0.5) * c, gy = (goal.y + 0.5) * c;
      ctx.fillStyle = colors["--surface"]; ctx.beginPath(); ctx.arc(sx, sy, rad + 2, 0, 7); ctx.fill(); // start: solid dot
      ctx.fillStyle = colors["--ink"]; ctx.beginPath(); ctx.arc(sx, sy, rad, 0, 7); ctx.fill();
      ctx.fillStyle = colors["--surface"]; ctx.beginPath(); ctx.arc(gx, gy, rad + 2, 0, 7); ctx.fill();    // goal: ring + centre
      ctx.strokeStyle = colors["--ink"]; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gx, gy, rad - 1, 0, 7); ctx.stroke();
      ctx.fillStyle = colors["--ink"]; ctx.beginPath(); ctx.arc(gx, gy, Math.max(1.5, rad * 0.32), 0, 7); ctx.fill();
      if (sd.kb) {
        ctx.strokeStyle = colors["--accent"]; ctx.lineWidth = 2;
        ctx.strokeRect(cursor.x * c + 1, cursor.y * c + 1, c - 2, c - 2);
      }
    }
    function drawAll() { sides.forEach(draw); }
    function updateStats() {
      sides.forEach(function (sd) {
        var r = sd.run;
        sd.vVisited.textContent = W.fmt(r.visitedCount);
        sd.vCost.textContent = !r.done ? "…" : r.found ? W.fmt(r.cost) : "kein Weg";
        sd.vSteps.textContent = !r.done ? "…" : r.found ? W.fmt(r.steps) + " Schritte" : "kein Weg";
      });
    }
    function refresh() {
      drawAll(); updateStats();
      startBtn.textContent = mode === "running" ? "Pause" : mode === "paused" ? "Weiter" : "Start";
      verdictEl.textContent = mode === "done" ? verdict(summary(sides[0].run), summary(sides[1].run), optimum)
        : mode === "running" ? "Die Suche läuft. Die Zahlen unter den Karten zählen mit."
          : "Angehalten. „Weiter“ setzt die Suche fort, „Schritt“ geht genau ein Feld weiter.";
    }
    function layout() {
      sides.forEach(function (sd) {
        var cell = Math.max(5, Math.min(22, Math.floor((sd.col.clientWidth - 2) / GW)));
        if (cell === sd.cell) return;
        sd.cell = cell;
        sd.canvas.style.width = cell * GW + "px"; sd.canvas.style.height = cell * GH + "px";
        sd.dpr = W.fitCanvas(sd.canvas, cell * GW, cell * GH, 2);
      });
      drawAll();
    }

    /* --- lifecycle --- */
    readColors();
    build("terrain", seed);
    recompute();
    layout();
    var ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(layout); ro.observe(duo); }
    else root.addEventListener("resize", layout);
    var offTheme = W.onTheme(function () { readColors(); drawAll(); });
    var offVisible = W.visible(wrap, function (v) { onScreen = v; if (v) kick(); else stop(); });

    return {
      destroy: function () {
        destroyed = true; stop();
        if (ro) ro.disconnect(); else root.removeEventListener("resize", layout);
        offTheme(); offVisible();
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }
    };
  }

  W.register("pfad", {
    title: "Wegfinder",
    kind: "Algorithmen & Datenstrukturen",
    lead: "Ich lasse zwei Suchalgorithmen auf derselben Karte gegeneinander antreten. Male Mauern und Sumpf, verschiebe Start und Ziel und vergleiche, wie viele Felder jeder absuchen muss.",
    facts: [
      "4 Algorithmen als Schritt-Automaten auf einem gemeinsamen binären Heap",
      "Karten aus einem Zufallsgenerator mit Startwert, also wiederholbar",
      "Test: 300 Zufallskarten gegen eine unabhängige Referenzsuche"
    ],
    moral: "Wer die Richtung kennt, sucht weniger, und wer die Kosten mitzählt, kommt günstiger an.",
    mount: mount
  });
})();
