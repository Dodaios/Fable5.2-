/* Sternpost: a gravity courier puzzle. Simulation core first (no DOM), then the game UI. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var W = root.Werkschau;

  /* ------------------------------------------------------------------ core */
  var WORLD_W = 1000, WORLD_H = 625;
  var DT = 1 / 120;        // fixed timestep in seconds
  var SOFT2 = 64;          // gravity softening (8 world units, squared)
  var MARGIN = 260;        // how far outside the field a capsule may drift
  var SPEED = 4;           // launch speed in units/s per point of thrust
  var CAPSULE_R = 4;
  var ANGLE_MIN = -180, ANGLE_MAX = 180, POWER_MIN = 20, POWER_MAX = 100;

  /* Bodies: static {x, y} or moving {orbit: {cx, cy, R, omega, phase}}; mu = G·M.
     solution values come from the solver in tests/orbit.test.mjs. */
  var levels = [
    {
      name: "Erste Zustellung", par: 2, maxSteps: 1440,
      pad: { x: 110, y: 430 }, target: { x: 800, y: 215, r: 48 },
      bodies: [{ name: "Kiesel", x: 480, y: 560, r: 30, mu: 0.9e6, tone: "hell" }],
      aim: { angle: 0, power: 60 }, solution: { angle: 22, power: 61 }
    },
    {
      name: "Der Umweg", par: 3, maxSteps: 1680,
      pad: { x: 100, y: 312 }, target: { x: 900, y: 312, r: 21 },
      bodies: [{ name: "Brocken", x: 500, y: 312, r: 62, mu: 3.2e6, tone: "glut" }],
      aim: { angle: 0, power: 60 }, solution: { angle: 19, power: 68.5 }
    },
    {
      name: "Zwischen zwei Welten", par: 3, maxSteps: 1680,
      pad: { x: 90, y: 540 }, target: { x: 910, y: 90, r: 21 },
      bodies: [
        { name: "Zwilling West", x: 370, y: 410, r: 54, mu: 1.7e6, tone: "blau" },
        { name: "Zwilling Ost", x: 690, y: 200, r: 46, mu: 1.3e6, tone: "hell" }
      ],
      aim: { angle: 30, power: 60 }, solution: { angle: -11, power: 39 }
    },
    {
      name: "Mondfahrplan", par: 4, maxSteps: 1920,
      pad: { x: 90, y: 330 }, target: { x: 910, y: 410, r: 20 },
      bodies: [
        { name: "Anker", x: 515, y: 290, r: 50, mu: 3.0e6, tone: "blau" },
        { name: "Mond Flink", orbit: { cx: 515, cy: 290, R: 155, omega: -0.9, phase: 4.9 }, r: 18, mu: 0.6e6, tone: "mond" }
      ],
      aim: { angle: 0, power: 60 }, solution: { angle: -19, power: 71.5 }
    },
    {
      name: "Schwungholen", par: 4, maxSteps: 1920,
      pad: { x: 100, y: 500 }, target: { x: 695, y: 300, r: 18 },
      bodies: [{ name: "Koloss", x: 590, y: 300, r: 85, mu: 5.0e6, tone: "glut" }],
      aim: { angle: 20, power: 60 }, solution: { angle: -5, power: 32.5 }
    },
    {
      name: "Die große Runde", par: 5, maxSteps: 2160,
      pad: { x: 80, y: 560 }, target: { x: 935, y: 75, r: 16 },
      bodies: [
        { name: "Wächter", x: 330, y: 250, r: 50, mu: 2.4e6, tone: "hell" },
        { name: "Koloss", x: 660, y: 400, r: 70, mu: 5.5e6, tone: "glut" },
        { name: "Mond Trab", orbit: { cx: 660, cy: 400, R: 125, omega: -1.1, phase: 0.4 }, r: 15, mu: 0.3e6, tone: "mond" },
        { name: "Pförtner", x: 860, y: 160, r: 30, mu: 1.0e6, tone: "blau" }
      ],
      aim: { angle: 30, power: 60 }, solution: { angle: 30, power: 30 }
    }
  ];

  function bodyPos(b, step, out) {
    if (b.orbit) {
      var a = b.orbit.phase + b.orbit.omega * step * DT;
      out.x = b.orbit.cx + b.orbit.R * Math.cos(a);
      out.y = b.orbit.cy + b.orbit.R * Math.sin(a);
    } else {
      out.x = b.x; out.y = b.y;
    }
    return out;
  }

  /* Angle in degrees, 0 = right, 90 = up on screen. */
  function createFlight(level, angleDeg, power) {
    var a = angleDeg * Math.PI / 180, s = power * SPEED;
    return { x: level.pad.x, y: level.pad.y, vx: Math.cos(a) * s, vy: -Math.sin(a) * s, step: 0, result: null, hitBody: -1 };
  }

  var tmp = { x: 0, y: 0 };
  /* Advance one fixed step (semi-implicit Euler). Returns null while flying, else the result. */
  function step(level, f) {
    if (f.result) return f.result;
    var bodies = level.bodies, n = bodies.length, i, b, dx, dy, r2, inv, ax = 0, ay = 0, rr;
    for (i = 0; i < n; i++) {
      b = bodies[i]; bodyPos(b, f.step, tmp);
      dx = tmp.x - f.x; dy = tmp.y - f.y;
      r2 = dx * dx + dy * dy + SOFT2;
      inv = b.mu / (r2 * Math.sqrt(r2));
      ax += dx * inv; ay += dy * inv;
    }
    f.vx += ax * DT; f.vy += ay * DT;
    f.x += f.vx * DT; f.y += f.vy * DT;
    f.step++;
    dx = level.target.x - f.x; dy = level.target.y - f.y;
    if (dx * dx + dy * dy < level.target.r * level.target.r) { f.result = "hit"; return f.result; }
    for (i = 0; i < n; i++) {
      b = bodies[i]; bodyPos(b, f.step, tmp);
      dx = tmp.x - f.x; dy = tmp.y - f.y; rr = b.r + CAPSULE_R;
      if (dx * dx + dy * dy < rr * rr) { f.result = "crash"; f.hitBody = i; return f.result; }
    }
    if (f.x < -MARGIN || f.x > WORLD_W + MARGIN || f.y < -MARGIN || f.y > WORLD_H + MARGIN) { f.result = "lost"; return f.result; }
    if (f.step >= level.maxSteps) { f.result = "timeout"; return f.result; }
    return null;
  }

  /* opts: {path: true, every: n, maxSteps: n}. A run cut short by opts.maxSteps reports "timeout". */
  function simulate(level, angleDeg, power, opts) {
    opts = opts || {};
    var f = createFlight(level, angleDeg, power);
    var limit = opts.maxSteps || level.maxSteps, every = opts.every || 1;
    var path = opts.path ? [f.x, f.y] : null;
    while (!f.result && f.step < limit) {
      step(level, f);
      if (path && (f.step % every === 0 || f.result)) path.push(f.x, f.y);
    }
    var out = { result: f.result || "timeout", steps: f.step, end: { x: f.x, y: f.y }, hitBody: f.hitBody };
    if (path) out.path = path;
    return out;
  }

  var core = {
    levels: levels, simulate: simulate, createFlight: createFlight, step: step, bodyPos: bodyPos,
    DT: DT, SPEED: SPEED, WORLD: { w: WORLD_W, h: WORLD_H },
    LIMITS: { angleMin: ANGLE_MIN, angleMax: ANGLE_MAX, powerMin: POWER_MIN, powerMax: POWER_MAX }
  };
  W.orbit = { core: core };

  /* -------------------------------------------------------------- helpers */
  var TAU = Math.PI * 2;
  var STEP_MS = 1000 * DT;
  var STORE_KEY = "werkschau-sternpost";

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function half(v) { return Math.round(v * 2) / 2; }
  function parseColor(s, fallback) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((s || "").trim());
    if (!m) return fallback;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgba(c, alpha) {
    return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + (alpha == null ? 1 : alpha) + ")";
  }
  function rng(seed) { // mulberry32
    var t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function loadBest() {
    try { return JSON.parse(root.localStorage.getItem(STORE_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveBest(best) {
    try { root.localStorage.setItem(STORE_KEY, JSON.stringify(best)); } catch (e) { /* the game works without storage */ }
  }

  /* ----------------------------------------------------------------- game */
  function mount(rootEl) {
    var el = W.el;
    var destroyed = false, isVisible = true, raf = 0, lastT = 0, acc = 0;
    var levelIndex = 0, level = levels[0];
    var aim = { angle: level.aim.angle, power: level.aim.power };
    var attempts = 0, solved = {}, best = loadBest();
    var flight = null;        // {f, path, ghost}
    var trails = [];          // finished attempts on this level (last three)
    var ghostTrail = null;    // finished solution replay
    var burst = null;         // {t0}
    var dragging = false, pointerId = null;
    var stars = [], colors = {}, fontFamily = "sans-serif";
    var scale = 1, dpr = 1, cssW = 0;

    /* --- DOM --- */
    var canvas = el("canvas", { tabindex: "0", role: "application", class: "d-orbit-canvas" });
    var ctx = canvas.getContext("2d");
    var hudName = el("span", { class: "d-orbit-hud-name" });
    var hudTry = el("span", { class: "d-orbit-hud-try" });
    var toast = el("div", { class: "d-orbit-toast", hidden: true });
    var field = el("div", { class: "demo-canvas d-orbit-field" },
      canvas, el("div", { class: "d-orbit-hud", "aria-hidden": "true" }, hudName, hudTry), toast);

    var levelButtons = levels.map(function (lv, i) {
      return el("button", { type: "button", "aria-pressed": "false", "aria-label": "Level " + (i + 1) + ": " + lv.name,
        onclick: function () { setLevel(i); } }, String(i + 1));
    });
    var levelName = el("p", { class: "d-orbit-level-name" });
    var outAttempts = el("dd"), outPar = el("dd"), outBest = el("dd");
    var angleOut = el("output", { for: "d-orbit-angle" });
    var angleIn = el("input", { type: "range", id: "d-orbit-angle", min: ANGLE_MIN, max: ANGLE_MAX, step: "0.5",
      oninput: function () { setAim(parseFloat(angleIn.value), aim.power); } });
    var powerOut = el("output", { for: "d-orbit-power" });
    var powerIn = el("input", { type: "range", id: "d-orbit-power", min: POWER_MIN, max: POWER_MAX, step: "0.5",
      oninput: function () { setAim(aim.angle, parseFloat(powerIn.value)); } });
    var startBtn = el("button", { type: "button", class: "btn btn--primary", id: "d-orbit-start",
      onclick: function () { if (flight) abortFlight(); else launch(false); } }, "Start");
    var solveBtn = el("button", { type: "button", class: "btn btn--sm", id: "d-orbit-solve",
      onclick: function () { launch(true); } }, "Lösung zeigen");
    var resetBtn = el("button", { type: "button", class: "btn btn--sm btn--ghost", id: "d-orbit-reset",
      onclick: resetLevel }, "Zurücksetzen");
    var msg = el("p", { class: "d-orbit-msg", id: "d-orbit-msg", role: "status", "aria-live": "polite" });
    var nextBtn = el("button", { type: "button", class: "btn btn--sun", id: "d-orbit-next", hidden: true,
      onclick: function () { setLevel(levelIndex + 1); canvas.focus({ preventScroll: true }); } }, "Nächstes Level");

    var side = el("div", { class: "demo-side" },
      el("div", { class: "d-orbit-levels" },
        el("p", { class: "demo-h" }, "Level"),
        el("div", { class: "seg d-orbit-seg", role: "group", "aria-label": "Level wählen" }, levelButtons),
        levelName),
      el("dl", { class: "kv" },
        el("dt", null, "Versuche"), outAttempts,
        el("dt", null, "Par"), outPar,
        el("dt", null, "Bestwert"), outBest),
      el("div", { class: "field" },
        el("div", { class: "field-row" }, el("label", { for: "d-orbit-angle" }, "Winkel"), angleOut), angleIn),
      el("div", { class: "field" },
        el("div", { class: "field-row" }, el("label", { for: "d-orbit-power" }, "Schub"), powerOut), powerIn),
      el("div", { class: "demo-bar" }, startBtn, solveBtn, resetBtn),
      msg, nextBtn);

    var hint = el("p", { class: "note d-orbit-hint" },
      "Im Feld ziehen und loslassen startet die Kapsel. Tastatur im Feld: ← → Winkel, ↑ ↓ Schub, Leertaste Start, R zurücksetzen. Umschalt verfeinert.");
    rootEl.appendChild(el("div", { class: "demo-grid d-orbit" }, el("div", { class: "d-orbit-main" }, field, hint), side));

    /* --- state changes --- */
    function setMsg(kind, text) { msg.setAttribute("data-kind", kind); msg.textContent = text; }
    function setToast(kind, text) {
      if (!text) { toast.hidden = true; return; }
      toast.hidden = false; toast.setAttribute("data-kind", kind); toast.textContent = text;
    }

    function setAim(angle, power) {
      aim.angle = clamp(half(angle), ANGLE_MIN, ANGLE_MAX);
      aim.power = clamp(half(power), POWER_MIN, POWER_MAX);
      syncControls();
      draw();
    }

    function setLevel(i) {
      if (i < 0 || i >= levels.length) return;
      stopFlight();
      levelIndex = i; level = levels[i];
      aim.angle = level.aim.angle; aim.power = level.aim.power;
      attempts = 0; trails = []; ghostTrail = null; burst = null;
      makeStars();
      nextBtn.hidden = true;
      setToast("", "");
      setMsg("info", "Bring die Kapsel zur Station. Par: " + level.par + " Versuche.");
      syncControls();
      draw();
    }

    function resetLevel() {
      stopFlight();
      aim.angle = level.aim.angle; aim.power = level.aim.power;
      attempts = 0; trails = []; ghostTrail = null; burst = null;
      nextBtn.hidden = true;
      setToast("", "");
      setMsg("info", "Zurückgesetzt. Par: " + level.par + " Versuche.");
      syncControls();
      draw();
    }

    function stopFlight() { flight = null; acc = 0; }

    function abortFlight() {
      if (!flight) return;
      var wasGhost = flight.ghost;
      stopFlight();
      setToast("", "");
      setMsg("info", wasGhost ? "Vorführung abgebrochen." : "Flug abgebrochen.");
      syncControls();
      draw();
    }

    function launch(ghost) {
      if (flight) return;
      var a = ghost ? level.solution.angle : aim.angle, p = ghost ? level.solution.power : aim.power;
      var f = createFlight(level, a, p);
      flight = { f: f, path: [f.x, f.y], ghost: ghost };
      burst = null; acc = 0;
      if (ghost) { ghostTrail = null; setMsg("info", "So fliegt eine mögliche Lösung."); }
      else { attempts++; setMsg("info", "Unterwegs …"); }
      setToast("", "");
      syncControls();
      kick();
    }

    function finishFlight() {
      var f = flight.f, rec = { path: flight.path, result: f.result, x: f.x, y: f.y };
      var ghost = flight.ghost;
      flight = null;
      if (ghost) {
        ghostTrail = rec;
        setMsg("info", "Lösung: Winkel " + W.fmt(level.solution.angle, 1) + "°, Schub " + W.fmt(level.solution.power, 1) + ". Jetzt du.");
        syncControls();
        return;
      }
      trails.push(rec);
      if (trails.length > 3) trails.shift();
      if (f.result === "hit") {
        solved[levelIndex] = true;
        if (!best[levelIndex] || attempts < best[levelIndex]) { best[levelIndex] = attempts; saveBest(best); }
        var parText = attempts < level.par ? " Unter Par." : attempts === level.par ? " Genau Par." : " Par wäre " + level.par + ".";
        var last = levelIndex === levels.length - 1;
        setMsg("hit", "Zugestellt in Versuch " + attempts + "." + parText + (last ? " Das war die letzte Sendung." : ""));
        setToast("hit", "Zugestellt");
        nextBtn.hidden = last;
        if (!W.reducedMotion()) burst = { t0: 0 };
      } else if (f.result === "crash") {
        setMsg("fail", "Absturz auf " + level.bodies[f.hitBody].name + ". Mehr Abstand oder mehr Schub.");
        setToast("fail", "Absturz");
      } else if (f.result === "lost") {
        setMsg("fail", "Verloren im All. Weniger Schub oder näher an einen Planeten.");
        setToast("fail", "Verloren im All");
      } else {
        setMsg("fail", "Treibstoff leer. Die Kapsel hat die Station nicht erreicht.");
        setToast("fail", "Treibstoff leer");
      }
      syncControls();
    }

    function syncControls() {
      var busy = !!flight;
      angleIn.value = String(aim.angle); powerIn.value = String(aim.power);
      angleOut.textContent = W.fmt(aim.angle, 1) + "°";
      powerOut.textContent = W.fmt(aim.power, 1);
      angleIn.disabled = busy; powerIn.disabled = busy;
      startBtn.textContent = busy ? "Abbrechen" : "Start";
      solveBtn.disabled = busy;
      outAttempts.textContent = String(attempts);
      outPar.textContent = String(level.par);
      outBest.textContent = best[levelIndex] ? String(best[levelIndex]) : "–";
      levelName.textContent = level.name;
      hudName.textContent = "Level " + (levelIndex + 1) + " · " + level.name;
      hudTry.textContent = attempts === 1 ? "1 Versuch" : attempts + " Versuche";
      canvas.setAttribute("aria-label", "Spielfeld, Level " + (levelIndex + 1) + ": " + level.name +
        ". Pfeiltasten zielen, Leertaste startet.");
      levelButtons.forEach(function (b, i) {
        b.setAttribute("aria-pressed", i === levelIndex ? "true" : "false");
        b.classList.toggle("d-orbit-solved", !!(solved[i] || best[i]));
      });
    }

    /* --- loop: steps the same core as the solver, at 120 steps per second --- */
    function kick() {
      if (!raf && isVisible && !destroyed) { lastT = 0; raf = root.requestAnimationFrame(frame); }
    }
    function frame(t) {
      raf = 0;
      if (destroyed) return;
      if (!lastT) lastT = t;
      var elapsed = Math.min(100, t - lastT);
      lastT = t;
      if (flight) {
        acc += elapsed;
        var n = Math.min(24, Math.floor(acc / STEP_MS));
        acc = Math.min(acc - n * STEP_MS, STEP_MS);
        var f = flight.f;
        for (var i = 0; i < n && !f.result; i++) {
          step(level, f);
          if (f.step % 2 === 0 || f.result) flight.path.push(f.x, f.y);
        }
        if (f.result) finishFlight();
      }
      if (burst) {
        if (!burst.t0) burst.t0 = t;
        if (t - burst.t0 > 750) burst = null;
      }
      draw(t);
      if ((flight || burst) && isVisible) raf = root.requestAnimationFrame(frame);
    }

    /* --- rendering --- */
    function readColors() {
      var band2 = parseColor(W.token("--band-2"), [26, 41, 180]);
      var band = parseColor(W.token("--band"), [35, 54, 220]);
      var soft = parseColor(W.token("--band-ink-2"), [205, 212, 255]);
      var prev = parseColor(W.token("--series-prev"), [154, 161, 188]);
      colors = {
        space: mix(band2, [0, 0, 0], 0.6),
        spaceEdge: mix(band2, [0, 0, 0], 0.8),
        ink: parseColor(W.token("--band-ink"), [255, 255, 255]),
        soft: soft,
        sun: parseColor(W.token("--sun"), [255, 194, 51]),
        crit: parseColor(W.token("--crit"), [208, 59, 59]),
        tones: {
          hell: soft,
          blau: mix(band, soft, 0.4),
          glut: parseColor(W.token("--series-opus"), [235, 104, 52]),
          mond: mix(prev, soft, 0.45)
        }
      };
      fontFamily = W.token("--font-body") || "sans-serif";
    }

    function makeStars() {
      var r = rng(1000 + levelIndex * 77), n = 110;
      stars = [];
      for (var i = 0; i < n; i++) stars.push({ x: r() * WORLD_W, y: r() * WORLD_H, r: 0.5 + r() * 1.3, a: 0.2 + r() * 0.6 });
    }

    function fit() {
      cssW = field.clientWidth;
      if (!cssW) return;
      dpr = W.fitCanvas(canvas, cssW, cssW * WORLD_H / WORLD_W, 2);
      scale = cssW / WORLD_W;
      draw();
    }

    function strokePath(path, from, to) {
      if (to - from < 4) return;
      ctx.beginPath();
      ctx.moveTo(path[from], path[from + 1]);
      for (var i = from + 2; i < to; i += 2) ctx.lineTo(path[i], path[i + 1]);
      ctx.stroke();
    }

    function drawBody(b, x, y) {
      var base = colors.tones[b.tone] || colors.soft;
      var g = ctx.createRadialGradient(x - b.r * 0.38, y - b.r * 0.4, b.r * 0.08, x, y, b.r);
      g.addColorStop(0, rgba(mix(base, [255, 255, 255], 0.45)));
      g.addColorStop(0.55, rgba(base));
      g.addColorStop(1, rgba(mix(base, colors.spaceEdge, 0.62)));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, b.r, 0, TAU); ctx.fill();
    }

    function draw(now) {
      if (destroyed || !cssW) return;
      var k = dpr * scale, px = 1 / scale, i, b, p = tmp2, curStep = flight ? flight.f.step : 0;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineCap = "round"; ctx.lineJoin = "round";

      var bg = ctx.createRadialGradient(480, 290, 60, 500, 312, 660);
      bg.addColorStop(0, rgba(colors.space)); bg.addColorStop(1, rgba(colors.spaceEdge));
      ctx.fillStyle = bg; ctx.fillRect(0, 0, WORLD_W, WORLD_H);

      ctx.fillStyle = rgba(colors.soft);
      for (i = 0; i < stars.length; i++) {
        ctx.globalAlpha = stars[i].a;
        ctx.beginPath(); ctx.arc(stars[i].x, stars[i].y, Math.max(stars[i].r, 0.7 * px), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // gravity hints: rings where the pull equals fixed strengths, and the moons' timetables
      ctx.lineWidth = px;
      for (i = 0; i < level.bodies.length; i++) {
        b = level.bodies[i]; bodyPos(b, curStep, p);
        var pulls = [70, 35, 17];
        for (var j = 0; j < pulls.length; j++) {
          var rr = Math.sqrt(b.mu / pulls[j]);
          if (rr < b.r + 8 || rr > 420) continue;
          ctx.strokeStyle = rgba(colors.soft, 0.17 - j * 0.045);
          ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, TAU); ctx.stroke();
        }
        if (b.orbit) {
          ctx.setLineDash([4 * px, 6 * px]);
          ctx.strokeStyle = rgba(colors.soft, 0.3);
          ctx.beginPath(); ctx.arc(b.orbit.cx, b.orbit.cy, b.orbit.R, 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // earlier attempts, faint
      ctx.lineWidth = 1.2 * px;
      for (i = 0; i < trails.length; i++) {
        var last = i === trails.length - 1 && !flight;
        ctx.strokeStyle = last ? rgba(colors.sun, 0.75) : rgba(colors.soft, 0.26);
        ctx.lineWidth = (last ? 2 : 1.2) * px;
        strokePath(trails[i].path, 0, trails[i].path.length);
      }
      if (ghostTrail && !(flight && flight.ghost)) {
        ctx.setLineDash([6 * px, 6 * px]); ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = rgba(colors.ink, 0.7);
        strokePath(ghostTrail.path, 0, ghostTrail.path.length);
        ctx.setLineDash([]);
      }

      for (i = 0; i < level.bodies.length; i++) { b = level.bodies[i]; bodyPos(b, curStep, p); drawBody(b, p.x, p.y); }

      // station
      var tg = level.target, won = trails.length && trails[trails.length - 1].result === "hit" && !flight;
      if (won) { ctx.fillStyle = rgba(colors.sun, 0.28); ctx.beginPath(); ctx.arc(tg.x, tg.y, tg.r, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = rgba(colors.sun); ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.arc(tg.x, tg.y, tg.r, 0, TAU); ctx.stroke();
      ctx.beginPath();
      for (i = 0; i < 4; i++) {
        var ta = i * Math.PI / 2 + Math.PI / 4;
        ctx.moveTo(tg.x + Math.cos(ta) * (tg.r + 3 * px), tg.y + Math.sin(ta) * (tg.r + 3 * px));
        ctx.lineTo(tg.x + Math.cos(ta) * (tg.r + 9 * px), tg.y + Math.sin(ta) * (tg.r + 9 * px));
      }
      ctx.stroke();
      ctx.fillStyle = rgba(colors.sun);
      ctx.beginPath(); ctx.arc(tg.x, tg.y, Math.max(3.2 * px, 3), 0, TAU); ctx.fill();

      // labels
      ctx.font = "600 " + (11 * px) + "px " + fontFamily;
      ctx.fillStyle = rgba(colors.ink, 0.86); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var tgLabelY = tg.y - tg.r - 18 * px < 34 * px ? tg.y + tg.r + 18 * px : tg.y - tg.r - 18 * px;
      ctx.fillText("Station", tg.x, tgLabelY);
      var pad = level.pad;
      ctx.fillText("Start", pad.x, pad.y + 22 * px > WORLD_H - 8 * px ? pad.y - 22 * px : pad.y + 22 * px);

      // launch pad and aim (hidden while the player's capsule is flying)
      var showAim = !(flight && !flight.ghost);
      if (showAim) {
        var rad = aim.angle * Math.PI / 180, ux = Math.cos(rad), uy = -Math.sin(rad), len = aim.power * 3;
        var pre = simulate(level, aim.angle, aim.power, { path: true, every: 6, maxSteps: 96 }).path;
        ctx.fillStyle = rgba(colors.sun);
        for (i = 2; i < pre.length; i += 2) {
          var dxp = pre[i] - pad.x, dyp = pre[i + 1] - pad.y;
          if (dxp * dxp + dyp * dyp < (len + 10) * (len + 10)) continue; // dots continue where the arrow ends
          ctx.globalAlpha = 0.9 * (1 - i / pre.length) + 0.1;
          ctx.beginPath(); ctx.arc(pre[i], pre[i + 1], 1.9 * px, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
        var tx = pad.x + ux * len, ty = pad.y + uy * len, hs = 9 * px;
        ctx.strokeStyle = rgba(colors.ink); ctx.lineWidth = 2 * px;
        ctx.beginPath(); ctx.moveTo(pad.x, pad.y); ctx.lineTo(tx - ux * hs * 0.6, ty - uy * hs * 0.6); ctx.stroke();
        ctx.fillStyle = rgba(colors.ink);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - ux * hs - uy * hs * 0.55, ty - uy * hs + ux * hs * 0.55);
        ctx.lineTo(tx - ux * hs + uy * hs * 0.55, ty - uy * hs - ux * hs * 0.55);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = rgba(colors.space); ctx.strokeStyle = rgba(colors.sun); ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.arc(pad.x, pad.y, 8 * px, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = rgba(colors.sun);
      ctx.beginPath(); ctx.arc(pad.x, pad.y, 3 * px, 0, TAU); ctx.fill();

      // capsule in flight: faint full path, bright tail
      if (flight) {
        var path = flight.path, nP = path.length, f = flight.f, c = flight.ghost ? colors.ink : colors.sun;
        if (flight.ghost) ctx.setLineDash([6 * px, 6 * px]);
        ctx.lineWidth = 1.5 * px; ctx.strokeStyle = rgba(c, 0.3);
        strokePath(path, 0, nP);
        ctx.setLineDash([]);
        var tail = Math.min(nP, 160), seg = 8, start = nP - tail;
        ctx.lineWidth = 2.4 * px;
        for (i = 0; i < seg; i++) {
          var a0 = start + Math.floor(tail * i / seg / 2) * 2, a1 = start + Math.floor(tail * (i + 1) / seg / 2) * 2 + 2;
          ctx.strokeStyle = rgba(c, 0.12 + 0.88 * (i + 1) / seg);
          strokePath(path, a0, Math.min(a1, nP));
        }
        ctx.fillStyle = rgba(c, 0.25);
        ctx.beginPath(); ctx.arc(f.x, f.y, 10 * px, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(c);
        ctx.beginPath(); ctx.arc(f.x, f.y, 4.6 * px, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(colors.ink);
        ctx.beginPath(); ctx.arc(f.x, f.y, 1.9 * px, 0, TAU); ctx.fill();
      } else if (trails.length) {
        var end = trails[trails.length - 1];
        if (end.result === "crash" || end.result === "timeout") {
          ctx.strokeStyle = rgba(end.result === "crash" ? colors.crit : colors.soft); ctx.lineWidth = 2 * px;
          ctx.beginPath(); ctx.arc(end.x, end.y, 9 * px, 0, TAU); ctx.stroke();
          if (end.result === "crash") {
            ctx.beginPath();
            ctx.moveTo(end.x - 4 * px, end.y - 4 * px); ctx.lineTo(end.x + 4 * px, end.y + 4 * px);
            ctx.moveTo(end.x + 4 * px, end.y - 4 * px); ctx.lineTo(end.x - 4 * px, end.y + 4 * px);
            ctx.stroke();
          }
        }
      }

      if (burst && burst.t0 && now) {
        var q = clamp((now - burst.t0) / 750, 0, 1), ease = 1 - (1 - q) * (1 - q);
        ctx.fillStyle = rgba(colors.sun, 1 - q);
        for (i = 0; i < 16; i++) {
          var ba = i * TAU / 16 + 0.2, bd = tg.r + (26 + (i % 3) * 16) * ease * px * 2.2;
          ctx.beginPath(); ctx.arc(tg.x + Math.cos(ba) * bd, tg.y + Math.sin(ba) * bd, 2.4 * px, 0, TAU); ctx.fill();
        }
      }
    }
    var tmp2 = { x: 0, y: 0 };

    /* --- input --- */
    function aimFromPointer(e) {
      var rect = canvas.getBoundingClientRect();
      var wx = (e.clientX - rect.left) / rect.width * WORLD_W, wy = (e.clientY - rect.top) / rect.height * WORLD_H;
      var dx = wx - level.pad.x, dy = wy - level.pad.y, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 12) return dist;
      setAim(Math.atan2(-dy, dx) * 180 / Math.PI, dist / 3);
      return dist;
    }
    function onDown(e) {
      if (flight || (e.pointerType === "mouse" && e.button !== 0)) return;
      dragging = true; pointerId = e.pointerId;
      try { canvas.setPointerCapture(pointerId); } catch (err) { /* older browsers */ }
      setToast("", "");
      aimFromPointer(e);
      e.preventDefault();
    }
    function onMove(e) { if (dragging && e.pointerId === pointerId) aimFromPointer(e); }
    function onUp(e) {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      var dist = aimFromPointer(e);
      if (dist >= 40) launch(false); // a short tap only aims
    }
    function onCancel() { dragging = false; }
    function onKey(e) {
      var fine = e.shiftKey ? 0.5 : 1, used = true;
      if (e.key === "r" || e.key === "R") resetLevel();
      else if (e.key === "Escape" && flight) abortFlight();
      else if (flight) used = e.key === " " || e.key.indexOf("Arrow") === 0;
      else if (e.key === "ArrowLeft") setAim(aim.angle + fine, aim.power);
      else if (e.key === "ArrowRight") setAim(aim.angle - fine, aim.power);
      else if (e.key === "ArrowUp") setAim(aim.angle, aim.power + fine);
      else if (e.key === "ArrowDown") setAim(aim.angle, aim.power - fine);
      else if (e.key === " " || e.key === "Enter") launch(false);
      else used = false;
      if (used) e.preventDefault();
    }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("keydown", onKey);

    /* --- lifecycle --- */
    var ro = root.ResizeObserver ? new root.ResizeObserver(fit) : null;
    if (ro) ro.observe(field);
    var offTheme = W.onTheme(function () { readColors(); draw(); });
    var offVisible = W.visible(field, function (v) { isVisible = v; if (v && (flight || burst)) kick(); });

    readColors();
    setLevel(0);
    fit();

    return {
      destroy: function () {
        destroyed = true;
        if (raf) root.cancelAnimationFrame(raf);
        raf = 0; flight = null; burst = null;
        if (ro) ro.disconnect();
        offTheme(); offVisible();
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onCancel);
        canvas.removeEventListener("keydown", onKey);
        rootEl.textContent = "";
      }
    };
  }

  W.register("orbit", {
    title: "Sternpost",
    kind: "Spiel · Physik",
    lead: "Ich habe ein kleines Schwerkraft-Puzzle gebaut: Du schießt eine Postkapsel zur Station, und die Planeten biegen ihre Bahn. Ziele durch Ziehen im Feld, mit den Reglern oder mit den Pfeiltasten.",
    facts: [
      "Feste Schrittweite von 1/120 s: jede Flugbahn ist exakt wiederholbar",
      "Alle sechs Level per Suchlauf über 361 × 81 Starts als lösbar geprüft",
      "Reines Canvas, keine Bibliothek"
    ],
    moral: "Wer die Schwerkraft nicht besiegen kann, lässt sie für sich arbeiten.",
    mount: mount
  });
})();
