/* Flow Lab – application: user interface, time control, conversion to SI units. */
(function () {
  'use strict';
  const NS = window.NSLab;
  const $ = (id) => document.getElementById(id);

  const STIR_RATE = 2.0;   // tank: maximum cursor speed = 2 domain heights per second
  const G_ACC = 9.81;

  const TOOLS = [
    { id: 'stir', label: 'Stir', hint: 'Drag to move the fluid', icon: '<path d="M12 12c0-1.1.9-2 2-2s3 1.3 3 3.5-2.2 4.5-5 4.5-6-2.7-6-6 3.1-7 7-7 6.5 2 7.5 4"/>' },
    { id: 'dye', label: 'Dye', hint: 'Drag to add dye (without disturbing the flow)', icon: '<path d="M12 3.5c3 4.3 5.5 7.2 5.5 10.5a5.5 5.5 0 0 1-11 0c0-3.3 2.500-6.200 5.500-10.500z"/>' },
    { id: 'rod', label: 'Rod', hint: 'A solid round rod follows the cursor and sheds vortices behind it', icon: '<circle cx="12" cy="12" r="6.500"/><circle cx="12" cy="12" r="1" fill="currentColor"/>' },
    { id: 'wall', label: 'Wall', hint: 'Drag to draw solid obstacles', icon: '<path d="M4 7h16v10H4zM4 12h16M9 7v5M15 7v5M12 12v5"/>' },
    { id: 'erase', label: 'Eraser', hint: 'Drag to remove obstacles', icon: '<path d="M5.500 15.500l8-9 5.500 5-7 8H9zM11.500 19.500h8"/>' },
    { id: 'heat', label: 'Heat', thermal: true, hint: 'Drag to heat the fluid locally', icon: '<path d="M12 3c2 3.500 5 5.500 5 9.500a5 5 0 0 1-10 0c0-2 1-3.200 2-4.200 0 2 .8 3 2 3 .2-3-1-5 1-8.300z"/>' },
    { id: 'cool', label: 'Cool', thermal: true, hint: 'Drag to cool the fluid locally', icon: '<path d="M12 3v18M4.200 7.500l15.600 9M19.800 7.500l-15.600 9"/>' },
  ];
  const VIEWS = [
    { id: 0, label: 'Dye', title: 'Dye concentration (passive scalar)' },
    { id: 1, label: 'Vorticity', title: 'Vorticity ω = ∂v/∂x − ∂u/∂y' },
    { id: 2, label: 'Speed', title: 'Velocity magnitude |u|' },
    { id: 3, label: 'Pressure', title: 'Pressure p (relative to the mean)' },
    { id: 4, label: 'Temperature', title: 'Temperature', thermal: true },
  ];
  const SWATCHES = [
    { id: 'auto', cls: 'rainbow', title: 'Rainbow' },
    { id: 'cyan', col: [0.10, 0.75, 1.00] }, { id: 'magenta', col: [1.00, 0.22, 0.62] },
    { id: 'gold', col: [1.00, 0.78, 0.12] }, { id: 'green', col: [0.20, 1.00, 0.45] },
    { id: 'white', col: [0.95, 0.95, 0.95] },
    { id: 'clear', cls: 'clear', col: [0, 0, 0], title: 'Remove dye' },
  ];

  const state = {
    scenario: null,
    fluid: 'water', rho: 998.2, mu: 1.002e-3, beta: 2.07e-4, kappa: 1.43e-7,
    L: 0.1, U: 0.05, dT: 2,
    ny: 192, scheme: 'auto', cycles: 2,
    view: 0, particles: true, arrows: false,
    tool: 'stir', brush: 0.05, dye: 'auto',
    speed: 'realtime', paused: false,
  };
  const phys = { dx: 1, nu: 1e-6, U0: 1, T0: 1, Re: 1, ReH: 1, Ra: 0, Pr: 0, nuG: 0.01 };
  const run = {
    simTime: 0, speedEMA: 1, stepsEMA: 0, fiEMA: 16.7, budget: 3, lastT: 0, frameNo: 0,
    stats: null, ub: 1, ubHist: [], statsMinSteps: 0, ranges: { w: 0.05, u: 0.5, p: 0.1, T: 0.5 },
    hist: [], histSkip: 0, ke0: null, tgAcc: 0, acc0: 0, accLog: [],
    cross: [], fyMean: 0, fyPrev: 0, St: NaN, cdEMA: NaN, clAmp: NaN,
    stepOnce: false, pendingFrames: 0, hue: 0, lastDom: 0, interacted: false,
  };
  const ptr = { down: false, over: false, x: 0, y: 0, lx: 0, ly: 0, vx: 0, vy: 0, cssX: 0, cssY: 0 };
  let glx, solver, renderer, canvas, hintTimer = 0;

  // ------------------------------------------------------------------ number formatting
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  function fmt(x, sig) {
    sig = sig || 3;
    if (!isFinite(x)) return '–';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e6 || a < 1e-3) {
      let e = Math.floor(Math.log10(a));
      let m = x / Math.pow(10, e);
      if (Math.abs(m) >= 9.995) { m /= 10; e += 1; }
      return m.toLocaleString('en-US', { maximumSignificantDigits: sig }) + '·10' + String(e).split('').map((c) => SUP[c]).join('');
    }
    return x.toLocaleString('en-US', { maximumSignificantDigits: sig });
  }
  function fmtUnit(x, kind, sig) {
    const a = Math.abs(x);
    const pick = (table) => { for (const [lim, f, u] of table) if (a < lim) return fmt(x * f, sig) + ' ' + u; return ''; };
    switch (kind) {
      case 'len': return pick([[1e-3, 1e6, 'µm'], [1e-2, 1e3, 'mm'], [1, 1e2, 'cm'], [Infinity, 1, 'm']]);
      case 'vel': return pick([[1e-2, 1e3, 'mm/s'], [1, 1e2, 'cm/s'], [Infinity, 1, 'm/s']]);
      case 'time': return pick([[1e-3, 1e6, 'µs'], [1, 1e3, 'ms'], [600, 1, 's'], [Infinity, 1 / 60, 'min']]);
      case 'pres': return pick([[1e-3, 1e6, 'µPa'], [1, 1e3, 'mPa'], [1e3, 1, 'Pa'], [Infinity, 1e-3, 'kPa']]);
      case 'energy': return pick([[1e-6, 1e9, 'nJ/m'], [1e-3, 1e6, 'µJ/m'], [1, 1e3, 'mJ/m'], [Infinity, 1, 'J/m']]);
      case 'force': return pick([[1e-6, 1e9, 'nN/m'], [1e-3, 1e6, 'µN/m'], [1, 1e3, 'mN/m'], [Infinity, 1, 'N/m']]);
      case 'rate': return pick([[Infinity, 1, '1/s']]);
      default: return fmt(x, sig);
    }
  }
  function hsv(h) {
    const f = (n) => { const k = (n + h * 6) % 6; return 1 - 0.85 * Math.max(Math.min(k, 4 - k, 1), 0); };
    return [f(5), f(3), f(1)];
  }

  // ------------------------------------------------------------------ physics <-> grid
  function updatePhysics() {
    const sc = state.scenario, ny = solver.ny;
    phys.dx = state.L / ny;
    phys.nu = state.mu / state.rho;
    if (sc.kind === 'stir') phys.U0 = STIR_RATE * state.L;
    else if (sc.kind === 'thermal') phys.U0 = Math.sqrt(G_ACC * state.beta * state.dT * state.L);
    else phys.U0 = state.U;
    phys.T0 = phys.dx / phys.U0;
    phys.nuG = phys.nu / (phys.U0 * phys.dx);
    phys.Re = phys.U0 * sc.refLen * state.L / phys.nu;
    phys.ReH = phys.U0 * state.L / phys.nu;
    const p = solver.params;
    p.nu = phys.nuG;
    p.cycles = state.cycles;
    p.uc = sc.uc || 1;
    p.force = [0, 0];
    p.forceStiff = sc.explicit ? 1 : 0;
    p.upw = state.scheme === 'central' ? [0, 0] : state.scheme === 'quick' ? [1, 0] : [-0.5, 0.25 / phys.nuG];
    if (sc.kind === 'thermal') {
      p.buoy = [1 / ny, 0];
      p.diff = [0, 0, 0, state.kappa / (phys.U0 * phys.dx)];
      phys.Ra = G_ACC * state.beta * state.dT * Math.pow(state.L, 3) / (phys.nu * state.kappa);
      phys.Pr = phys.nu / state.kappa;
    } else {
      p.buoy = [0, 0];
      p.diff = [0, 0, 0, 0];
      phys.Ra = 0; phys.Pr = 0;
    }
  }

  function setFluid(id) {
    const f = NS.fluidById(id);
    if (!f) return;
    state.fluid = id; state.rho = f.rho; state.mu = f.mu; state.beta = f.beta; state.kappa = f.kappa;
  }

  function loadScenario(id, withDefaults) {
    const sc = NS.scenarioById(id) || NS.scenarios[0];
    state.scenario = sc;
    if (withDefaults) {
      const d = sc.defaults;
      setFluid(d.fluid);
      state.L = d.L;
      if (d.U) state.U = d.U;
      if (d.dT) state.dT = d.dT;
      state.view = d.view; state.particles = !!d.particles; state.arrows = false;
      state.speed = d.speed; state.scheme = d.scheme || 'auto';
      state.tool = d.tool;
    }
    document.body.classList.toggle('thermal', sc.kind === 'thermal');
    if (sc.kind !== 'thermal') {
      if (state.view === 4) state.view = 0;
      if (state.tool === 'heat' || state.tool === 'cool') state.tool = 'stir';
    }
    rebuild();
  }

  /** Rebuild the grid and set up the initial state. */
  function rebuild() {
    const sc = state.scenario;
    const ny = state.ny, nx = sc.aspect * ny;
    solver.configure({
      nx, ny, bc: sc.bc, wallU: sc.wallU || [0, 0], inflow: sc.inflow || [0, 0, 0.5, 0.1],
      tempBC: sc.tempBC || [0, 0, 0, 0], inDye: sc.inDye || [0, 0.5, 0, 0],
      inColA: sc.inColA || [0, 0, 0], inColB: sc.inColB || [0, 0, 0],
    });
    const side = Math.min(256, Math.max(64, Math.round(Math.sqrt(nx * ny / 7))));
    renderer.resize(side * side);
    updatePhysics();
    sc.setup(solver, nx, ny);
    solver.projectField(8);
    Object.assign(run, {
      simTime: 0, stats: null, ub: sc.ubound || 1, ubHist: [], statsMinSteps: 0, hist: [], histSkip: 0, ke0: null, tgAcc: 0, acc0: 0, accLog: [],
      cross: [], fyMean: 0, fyPrev: 0, St: NaN, cdEMA: NaN, clAmp: NaN, speedEMA: 1, prevForce: null,
      ranges: { w: 0.05, u: 0.5, p: 0.1, T: 0.5 },
    });
    solver.tool.velPar[3] = 0; solver.tool.scalPar[3] = 0;
    layoutCanvas();
    syncUI();
  }

  // ------------------------------------------------------------------ Layout
  function layoutCanvas() {
    if (!solver.nx) return;
    const vp = $('viewport'), wrap = $('canvasWrap');
    const narrow = window.matchMedia('(max-width: 980px)').matches;
    const cs = getComputedStyle(vp);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = Math.max(120, vp.clientWidth - padX);
    const availH = narrow ? Math.max(160, window.innerHeight * 0.58) : Math.max(120, vp.clientHeight - padY);
    const aspect = solver.nx / solver.ny;
    let w = availW, h = w / aspect;
    if (h > availH) { h = availH; w = h * aspect; }
    w = Math.floor(w); h = Math.floor(h);
    wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w * dpr > 2400) dpr = 2400 / w;
    const cw = Math.max(2, Math.round(w * dpr)), ch = Math.max(2, Math.round(h * dpr));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  }

  // ------------------------------------------------------------------ input
  function toGrid(e) {
    const r = canvas.getBoundingClientRect();
    ptr.cssX = e.clientX - r.left; ptr.cssY = e.clientY - r.top;
    return [ptr.cssX / r.width * solver.nx, (1 - ptr.cssY / r.height) * solver.ny];
  }
  function placeBrush() {
    const b = $('brush');
    const show = ptr.over || ptr.down;
    b.hidden = !show;
    if (!show) return;
    const r = canvas.getBoundingClientRect();
    const d = 2 * state.brush * r.height;
    b.style.width = d + 'px'; b.style.height = d + 'px';
    b.style.left = ptr.cssX + 'px'; b.style.top = ptr.cssY + 'px';
    b.classList.toggle('solid', state.tool === 'rod' || state.tool === 'wall');
  }
  function bindPointer() {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button > 0) return;
      canvas.setPointerCapture(e.pointerId);
      const p = toGrid(e);
      ptr.down = true; ptr.over = true;
      ptr.x = ptr.lx = p[0]; ptr.y = ptr.ly = p[1]; ptr.vx = ptr.vy = 0;
      if (!run.interacted) { run.interacted = true; $('hint').classList.add('gone'); }
      clearTimeout(hintTimer);
      placeBrush();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = toGrid(e);
      ptr.x = p[0]; ptr.y = p[1]; ptr.over = true;
      if (!ptr.down) { ptr.lx = ptr.x; ptr.ly = ptr.y; }
      placeBrush();
    });
    const up = () => { ptr.down = false; placeBrush(); };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { ptr.over = false; placeBrush(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Tool state for this frame; returns the path segment and velocity in grid units. */
  function toolFrame(wall) {
    const tl = solver.tool;
    const R = state.brush * solver.ny;
    const seg0 = [ptr.lx, ptr.ly], seg1 = [ptr.x, ptr.y];
    // cursor velocity (wall clock) -> grid units: cells/s * T0
    let vx = (ptr.x - ptr.lx) / wall * phys.T0, vy = (ptr.y - ptr.ly) / wall * phys.T0;
    ptr.vx += (vx - ptr.vx) * 0.55; ptr.vy += (vy - ptr.vy) * 0.55;
    vx = ptr.vx; vy = ptr.vy;
    const vmax = state.scenario.kind === 'stir' ? 1.0 : 2.0;
    const sp = Math.hypot(vx, vy);
    if (sp > vmax) { vx *= vmax / sp; vy *= vmax / sp; }
    ptr.lx = ptr.x; ptr.ly = ptr.y;
    const active = ptr.down;
    tl.vel = [vx, vy];
    tl.velPar = [R, 1.5, 0, 0];
    tl.scalPar = [R * 0.8, 3.0, 0, 0];
    tl.chan = [1, 1, 1, 0];
    if (active) {
      const t = state.tool;
      let col;
      if (state.dye === 'auto') { run.hue = (run.hue + wall * 0.07) % 1; col = hsv(run.hue); }
      else col = SWATCHES.find((s) => s.id === state.dye).col;
      tl.col = [col[0], col[1], col[2], 0];
      if (t === 'stir') { tl.velPar[3] = 1; tl.scalPar[3] = 1; }
      else if (t === 'dye') { tl.scalPar = [R, 6.0, 0, 1]; }
      else if (t === 'rod') { tl.velPar = [R, 0, 1, 1]; }
      else if (t === 'heat' || t === 'cool') {
        tl.scalPar = [R, 3.0, 0, 1]; tl.col = [0, 0, 0, t === 'heat' ? 0.5 : -0.5]; tl.chan = [0, 0, 0, 1];
      } else if (t === 'wall' || t === 'erase') {
        solver.drawMask([seg0[0], seg0[1], seg1[0], seg1[1]], Math.max(1.5, R * 0.6), t === 'erase');
      }
    }
    const forcing = active && (state.tool === 'stir' || state.tool === 'rod') ? Math.abs(vx) + Math.abs(vy) : 0;
    return { seg0, seg1, forcing };
  }
  function toolSegment(tf, f0, f1) {
    const a = tf.seg0, b = tf.seg1;
    solver.tool.seg = [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0, a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1];
  }

  // ------------------------------------------------------------------ diagnostics
  function onStats(s) {
    if (s.steps < run.statsMinSteps) return;          // stale measurement (from before a jump in time)
    if (!s.valid) { blowUp(); return; }
    const sc = state.scenario;
    run.stats = s;
    // velocity bound for the CFL condition: maximum of the latest measurements (they arrive
    // 1–2 frames late), plus a safety margin in frame()
    run.ubHist.push(s.cfl);
    if (run.ubHist.length > 3) run.ubHist.shift();
    run.ub = Math.max.apply(null, run.ubHist);
    if (Math.abs(s.pMean) > 1e-4) solver.pShift = 0.25 * s.pMean;
    const ease = (cur, target) => cur + (target - cur) * (target > cur ? 0.35 : 0.04);
    const R = run.ranges;
    // vorticity: scale by the spread so that thin wall boundary layers do not dominate the range
    const wRms = Math.sqrt(2 * s.ens / (solver.nx * solver.ny));
    R.w = Math.max(ease(R.w, Math.min(0.6 * s.wmax, Math.max(5 * wRms, 0.15 * s.wmax))), 1e-6);
    R.u = Math.max(ease(R.u, s.umax), 1e-6);
    R.p = Math.max(ease(R.p, Math.max(s.pMax - s.pMean, s.pMean - s.pMin)), 1e-9);
    R.T = sc.kind === 'thermal' ? 0.5 : Math.max(ease(R.T, Math.max(Math.abs(s.tMax), Math.abs(s.tMin))), 1e-6);
    // exponent of the exact solution at the time of this (delayed) measurement
    let acc = run.tgAcc;
    for (const e of run.accLog) if (e[0] === s.steps) acc = e[1];
    if (run.ke0 === null) { run.ke0 = s.ke; run.acc0 = acc; }
    s.exact = Math.exp(-(acc - run.acc0));
    // force coefficients and Strouhal number
    let cd = NaN, cl = NaN;
    if (sc.body) {
      const D = sc.body.D * solver.ny;
      const F = NS.Solver.bodyForce(s, run.prevForce);
      run.prevForce = { time: s.time, mx: s.mx, my: s.my };
      s.Fx = F[0]; s.Fy = F[1];
      cd = 2 * F[0] / D; cl = 2 * F[1] / D;
      run.cdEMA = isFinite(run.cdEMA) ? run.cdEMA + (cd - run.cdEMA) * 0.02 : cd;
      run.fyMean += (cl - run.fyMean) * 0.004;
      const y = cl - run.fyMean;
      if (run.fyPrev < 0 && y >= 0) {
        run.cross.push(s.time);
        if (run.cross.length > 6) run.cross.shift();
        if (run.cross.length >= 3) {
          const n = run.cross.length - 1;
          const T = (run.cross[n] - run.cross[0]) / n;
          run.St = D / T;
        }
      }
      run.fyPrev = y;
    }
    if (++run.histSkip >= 3) {
      run.histSkip = 0;
      run.hist.push({ t: run.simTime, tg: s.time, ke: s.ke, ens: s.ens, umax: s.umax, fx: s.Fx || 0, fy: s.Fy || 0, cd, cl, tgA: s.exact });
      if (run.hist.length > 1500) run.hist = run.hist.filter((_, k) => k % 2 === 1);
    }
  }

  function blowUp() {
    toast('The computation became numerically unstable, so the field was reset.');
    rebuild();
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
  }

  // ------------------------------------------------------------------ main loop
  function frame(tNow) {
    requestAnimationFrame(frame);
    const interval = run.lastT ? tNow - run.lastT : 16.7;
    run.lastT = tNow;
    const wall = Math.min(0.1, Math.max(0.004, interval / 1000));
    run.fiEMA += (Math.min(interval, 250) - run.fiEMA) * 0.1;
    run.frameNo++;

    const fresh = solver.pollStats();
    if (fresh) { run.pendingFrames = 0; onStats(fresh); } else run.pendingFrames++;

    const sc = state.scenario;
    const tf = toolFrame(wall);
    let gridDt = 0, nSteps = 0, limited = false;
    if (!state.paused || run.stepOnce) {
      const ub = Math.max(run.ub * 1.25, 1.6 * tf.forcing, sc.kind === 'stir' ? 0.02 : (sc.kind === 'thermal' ? 0.05 : 1.0));
      const nMax = run.stepOnce ? 1 : Math.max(1, Math.round(run.budget));
      if (state.speed === 'auto' || run.stepOnce) {
        const want = sc.kind === 'thermal' ? 4 : 2.5;
        for (let k = 0; k < nMax; k++) {
          toolSegment(tf, k / nMax, (k + 1) / nMax);
          gridDt += solver.step(want, ub).dt;
          nSteps++;
        }
        limited = true;
      } else {
        const factor = state.speed === 'realtime' ? 1 : Number(state.speed);
        const target = wall * factor / phys.T0;
        // accuracy for viscous fluids: resolve the slowest viscous mode (wavelength = domain height)
        // with at least ~5 steps per decay time, but use at most 3 substeps per frame.
        const kBox = 2 * Math.PI / solver.ny;
        const dtAcc = Math.max(0.2 / (phys.nuG * kBox * kBox), target / 3);
        while (nSteps < nMax && gridDt < target * 0.999) {
          const want = Math.min(target - gridDt, dtAcc);
          const pl = solver.plan(want, ub);
          const f1 = nSteps === nMax - 1 ? 1 : Math.min(1, (gridDt + pl.dt) / target);
          toolSegment(tf, gridDt / target, f1);
          gridDt += solver.step(want, ub).dt;
          nSteps++;
        }
        limited = gridDt < target * 0.98;
      }
      run.stepOnce = false;
      run.simTime += gridDt * phys.T0;
      if (sc.analytic) { const k = 2 * Math.PI * sc.analytic.m / solver.ny; run.tgAcc += 4 * phys.nuG * k * k * gridDt; }
      run.speedEMA += (gridDt * phys.T0 / wall - run.speedEMA) * 0.08;
      run.stepsEMA += (nSteps - run.stepsEMA) * 0.1;
      // adapt the compute budget to the frame rate
      const maxB = state.speed === 'auto' ? 6 : 48;
      if (run.fiEMA > 21 || run.pendingFrames > 4) run.budget = Math.max(1, run.budget * 0.9);
      else if (run.fiEMA < 18.5 && limited) run.budget = Math.min(maxB, run.budget + 0.15);
      if (run.budget > maxB) run.budget = maxB;
      if (state.particles) renderer.updateParticles(gridDt, wall);
    }

    if (solver.requestStats([ptr.x, ptr.y])) {
      run.accLog.push([solver.steps, run.tgAcc]);
      if (run.accLog.length > 12) run.accLog.shift();
    }
    draw();
    if (tNow - run.lastDom > 160) { run.lastDom = tNow; updateReadouts(); }
  }

  function draw() {
    const R = run.ranges;
    let range = [1, 0];
    const pm = run.stats ? run.stats.pMean : 0;
    if (state.view === 1) range = [1 / R.w, 0];
    else if (state.view === 2) range = [1 / R.u, 0];
    else if (state.view === 3) range = [1 / R.p, pm];
    else if (state.view === 4) range = [1 / R.T, 0];
    renderer.render({
      view: state.view, range, cmap: 'inferno', dyeGain: 2.4,
      particles: state.particles, arrows: state.arrows,
      arrowScale: 1 / Math.max(R.u, 1e-6), streak: 0.03 * solver.ny / Math.max(R.u, 0.05),
    });
  }

  // ------------------------------------------------------------------ display
  const READOUTS = [
    ['t', 'simulated time'], ['speed', 'speed'], ['dt', 'time step Δt'], ['method', 'time integration'],
    ['umax', 'max. velocity'], ['ke', 'kinetic energy'], ['ens', 'enstrophy'],
    ['div', 'residual divergence max |∇·u|·Δx/U'], ['cd', 'drag coefficient c_D'], ['cl', 'lift coefficient c_L'],
    ['st', 'Strouhal number St'], ['tg', 'deviation from exact solution'],
    ['res', 'grid'], ['resq', 'resolution'], ['probe', 'probe at cursor'], ['fps', 'frame rate'],
  ];

  function regimeText(sc, Re) {
    if (sc.kind === 'thermal') {
      const Ra = phys.Ra;
      if (Ra < 1708) return 'Subcritical (Ra < 1708): pure heat conduction, the fluid stays at rest.';
      if (Ra < 5e4) return 'Steady convection rolls.';
      if (Ra < 1e7) return 'Time-dependent convection: warm plumes rise, cold ones sink.';
      return 'Turbulent convection with thin boundary layers.';
    }
    if (sc.id === 'karman') {
      if (Re < 5) return 'Creeping flow: the fluid hugs the cylinder, no separation.';
      if (Re < 47) return 'Steady vortex pair behind the cylinder, no oscillation yet (critical: Re ≈ 47).';
      if (Re < 190) return 'Laminar Kármán vortex street: vortices shed periodically.';
      if (Re < 1000) return 'The vortex street becomes more irregular. In 3D, spanwise instabilities already appear here.';
      return 'Highly irregular wake; in reality it is three-dimensional and turbulent.';
    }
    if (sc.id === 'cavity') {
      if (Re < 100) return 'A single, nearly symmetric main vortex below the lid.';
      if (Re < 1500) return 'The main vortex moves towards the centre and secondary vortices grow in the bottom corners.';
      if (Re < 8000) return 'Strong central vortex with pronounced corner vortices; long spin-up time.';
      return 'Above Re ≈ 8000 the cavity flow becomes permanently time-dependent.';
    }
    if (Re < 1) return 'Creeping flow: friction dominates completely. Motion stops as soon as the forcing stops, and no vortices form.';
    if (Re < 100) return 'Laminar: vortices form but are quickly consumed by friction.';
    if (Re < 4000) return 'Inertia prevails: vortices live long, travel and fold the dye.';
    return 'Inertia dominates strongly: chaotic vortex cascade (two-dimensional turbulence).';
  }

  function resolutionQuality() {
    const m = solver.ny / Math.sqrt(Math.max(phys.ReH, 1e-9));
    if (m >= 2.5) return ['resolved (DNS)', 'good'];
    if (m >= 1) return ['marginally resolved', 'warn'];
    return ['under-resolved (implicit LES)', 'bad'];
  }

  function updateReadouts() {
    const sc = state.scenario, s = run.stats, set = (id, v, cls) => { const el = $('ro_' + id); if (el) { el.textContent = v; el.className = cls || ''; } };
    const show = (id, on) => { const el = $('ro_' + id); if (el) { el.hidden = !on; el.previousElementSibling.hidden = !on; } };
    // HUD
    $('hudRe').innerHTML = sc.kind === 'thermal' ? 'Ra <b>' + fmt(phys.Ra) + '</b>' : 'Re <b>' + fmt(phys.Re) + '</b>';
    $('hudT').innerHTML = '<i>t</i> = <b>' + fmtUnit(run.simTime, 'time') + '</b>';
    const sp = run.speedEMA;
    const spTxt = state.paused ? 'paused' : (sp >= 0.95 && sp <= 1.05 ? 'real time' : sp < 1 ? 'slow motion ' + fmt(sp, 2) + '×' : 'fast forward ' + fmt(sp, 2) + '×');
    $('hudSpeed').innerHTML = '<b>' + spTxt + '</b>';
    $('hudSpeed').classList.toggle('warn', state.speed === 'realtime' && sp < 0.9 && !state.paused);

    set('t', fmtUnit(run.simTime, 'time'));
    set('speed', fmt(sp, 2) + ' × real time · ' + fmt(run.stepsEMA, 2) + ' steps/frame');
    const pl = solver.lastPlan;
    set('dt', fmtUnit(pl.dt * phys.T0, 'time') + '  (CFL ' + fmt(pl.dt * (s ? s.cfl : 0), 2) + ')');
    set('method', pl.mode === 'rkc' ? 'RKC, ' + pl.s + ' stages (stiff)' : 'RK3 explicit');
    show('cd', !!sc.body); show('cl', !!sc.body); show('st', !!sc.body); show('tg', !!sc.analytic);
    if (s) {
      set('umax', fmtUnit(s.umax * phys.U0, 'vel'));
      set('ke', fmtUnit(s.ke * state.rho * phys.U0 * phys.U0 * phys.dx * phys.dx, 'energy'));
      set('ens', fmt(s.ens * phys.U0 * phys.U0) + ' m²/s²');
      set('div', fmt(s.divMax, 2), s.divMax < 1e-3 ? 'good' : s.divMax < 2e-2 ? 'warn' : 'bad');
      if (sc.body) {
        set('cd', fmt(run.cdEMA, 3));
        set('cl', fmt(2 * (s.Fy || 0) / (sc.body.D * solver.ny), 3));
        set('st', isFinite(run.St) ? fmt(run.St, 3) : '– (no oscillation yet)');
      }
      if (sc.analytic && run.ke0) {
        const dev = s.ke / run.ke0 / s.exact - 1;
        set('tg', (dev >= 0 ? '+' : '') + fmt(dev * 100, 2) + ' %', Math.abs(dev) < 0.01 ? 'good' : Math.abs(dev) < 0.05 ? 'warn' : 'bad');
      }
      const pr = s.probe;
      set('probe', ptr.over ? '|u| = ' + fmtUnit(Math.hypot(pr.u, pr.v) * phys.U0, 'vel') + ' · p = ' + fmtUnit((pr.p - s.pMean) * state.rho * phys.U0 * phys.U0, 'pres') : '–');
    }
    set('res', solver.nx + ' × ' + solver.ny + ' cells, Δx = ' + fmtUnit(phys.dx, 'len'));
    const q = resolutionQuality();
    set('resq', q[0], q[1]);
    set('fps', fmt(1000 / run.fiEMA, 2) + ' frames/s');
    updateLegend();
    drawPlot();
  }

  function updateLegend() {
    const R = run.ranges, v = state.view;
    const bar = $('legendBar'), ctx = bar.getContext('2d');
    const W = bar.width, H = bar.height;
    let title = '', lo = '', hi = '';
    const col = (c) => 'rgb(' + c.map((x) => Math.round(255 * Math.min(1, Math.max(0, x)))).join(',') + ')';
    for (let x = 0; x < W; x++) {
      const t = x / (W - 1);
      let c;
      if (v === 0) { const e = 1 - Math.exp(-2.4 * t * 1.2); c = NS.colors.BG.map((b) => b + (1 - b) * e); }
      else if (v === 2) c = NS.colors.seqColor('inferno', t);
      else c = NS.colors.divColor(2 * t - 1);
      ctx.fillStyle = col(c);
      ctx.fillRect(x, 0, 1, H);
    }
    if (v === 0) { title = 'Dye concentration'; lo = '0'; hi = '1'; }
    else if (v === 1) { const w = R.w * phys.U0 / phys.dx; title = 'Vorticity ω  (blue: clockwise)'; lo = '−' + fmt(w, 2); hi = '+' + fmt(w, 2) + ' 1/s'; }
    else if (v === 2) { title = 'Speed |u|'; lo = '0'; hi = fmtUnit(R.u * phys.U0, 'vel', 2); }
    else if (v === 3) { const p = R.p * state.rho * phys.U0 * phys.U0; title = 'Pressure p − p̄'; lo = '−' + fmtUnit(p, 'pres', 2); hi = '+' + fmtUnit(p, 'pres', 2); }
    else { title = 'Temperature T − T̄'; lo = '−' + fmt(R.T * state.dT, 2); hi = '+' + fmt(R.T * state.dT, 2) + ' K'; }
    $('legendTitle').textContent = title; $('legendMin').textContent = lo; $('legendMax').textContent = hi;
  }

  function drawPlot() {
    const cv = $('plot'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height, h = run.hist, sc = state.scenario;
    ctx.clearRect(0, 0, W, H);
    const series = [];
    if (sc.body) {
      series.push({ key: 'cd', color: '#4cc2ff', name: 'c_D (drag)' });
      series.push({ key: 'cl', color: '#ff8a4c', name: 'c_L (lift)' });
    } else {
      series.push({ key: 'ke', color: '#4cc2ff', name: 'kinetic energy', norm: true });
      if (sc.analytic) series.push({ key: 'tgA', color: '#ffd166', name: 'exact solution', scaleWith: 'ke', dash: true });
      else series.push({ key: 'ens', color: '#ff8a4c', name: 'enstrophy', norm: true });
    }
    $('plotLegend').innerHTML = series.map((s) => '<span style="--c:' + s.color + '">' + s.name + '</span>').join('');
    if (h.length < 2) return;
    const t0 = h[0].t, t1 = h[h.length - 1].t;
    if (t1 <= t0) return;
    ctx.strokeStyle = '#232b3d'; ctx.lineWidth = 1;
    ctx.beginPath(); for (let k = 1; k < 4; k++) { ctx.moveTo(0, H * k / 4); ctx.lineTo(W, H * k / 4); } ctx.stroke();
    let lo = Infinity, hi = -Infinity;
    if (sc.body) { for (const p of h) { if (isFinite(p.cd)) { lo = Math.min(lo, p.cd, p.cl); hi = Math.max(hi, p.cd, p.cl); } } if (!(hi > lo)) return; const m = 0.08 * (hi - lo) + 1e-9; lo -= m; hi += m; }
    const maxOf = (key) => h.reduce((a, p) => Math.max(a, p[key]), 1e-30);
    for (const s of series) {
      let a = lo, b = hi, f = 1;
      if (!sc.body) {
        a = 0;
        if (s.scaleWith) { b = 1.08 * maxOf(s.scaleWith); f = run.ke0 || 1; }
        else b = 1.08 * maxOf(s.key);
      }
      ctx.strokeStyle = s.color; ctx.lineWidth = 2.2; ctx.setLineDash(s.dash ? [7, 6] : []);
      ctx.beginPath();
      h.forEach((p, k) => {
        const x = (p.t - t0) / (t1 - t0) * W, y = H - (p[s.key] * f - a) / (b - a) * (H - 8) - 4;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#8b96aa'; ctx.font = '20px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(fmtUnit(t0, 'time', 2), 6, H - 8);
    ctx.textAlign = 'right'; ctx.fillText(fmtUnit(t1, 'time', 2), W - 6, H - 8);
    if (sc.body) { ctx.textAlign = 'left'; ctx.fillText(fmt(hi, 2), 6, 22); }
  }

  // ------------------------------------------------------------------ controls
  function setPressed(container, attr, value) {
    for (const b of container.children) b.setAttribute(attr, String(b.dataset.id === String(value)));
  }

  function syncUI() {
    const sc = state.scenario;
    $('scenario').value = sc.id;
    $('scenarioDesc').textContent = sc.desc;
    const tips = $('scenarioTips');
    if (tips.dataset.id !== sc.id) {
      tips.dataset.id = sc.id;
      tips.innerHTML = '';
      for (const t of sc.tips || []) { const li = document.createElement('li'); li.textContent = t; tips.appendChild(li); }
    }
    $('fluid').value = NS.fluidById(state.fluid) && Math.abs(NS.fluidById(state.fluid).mu - state.mu) < 1e-12 && Math.abs(NS.fluidById(state.fluid).rho - state.rho) < 1e-9 ? state.fluid : 'custom';
    $('muSlider').value = Math.log10(state.mu);
    if (document.activeElement !== $('muInput')) $('muInput').value = +(state.mu * 1e3).toPrecision(4);
    $('rhoSlider').value = Math.log10(state.rho);
    if (document.activeElement !== $('rhoInput')) $('rhoInput').value = +state.rho.toPrecision(5);
    if (document.activeElement !== $('betaInput')) $('betaInput').value = +(state.beta * 1e4).toPrecision(4);
    if (document.activeElement !== $('kappaInput')) $('kappaInput').value = +(state.kappa * 1e6).toPrecision(4);
    $('nuOut').textContent = fmt(phys.nu * 1e6) + ' mm²/s';
    $('lenLabel').innerHTML = (sc.aspect === 1 ? 'Edge length' : 'Height') + ' of the domain <i>H</i>';
    $('lenSlider').value = Math.log10(state.L);
    $('lenOut').textContent = fmtUnit(state.L, 'len');
    $('fieldU').hidden = sc.kind !== 'driven';
    $('uLabel').innerHTML = (sc.id === 'cavity' ? 'Lid velocity' : sc.id === 'kh' ? 'Velocity difference' : sc.id === 'tg' ? 'Initial velocity' : 'Inflow velocity') + ' <i>U</i>';
    $('uSlider').value = Math.log10(state.U);
    $('uOut').textContent = fmtUnit(state.U, 'vel');
    $('dtSlider').value = Math.log10(state.dT);
    $('dtOut').textContent = fmt(state.dT) + ' K';
    // Reynolds box
    const thermal = sc.kind === 'thermal';
    const lead = thermal ? phys.Ra : phys.Re;
    $('reTitle').textContent = thermal ? 'Rayleigh number' : 'Reynolds number';
    $('reOut').textContent = fmt(lead);
    const uTxt = sc.kind === 'stir' ? fmtUnit(phys.U0, 'vel') + ' (full stirring speed)' : fmtUnit(phys.U0, 'vel');
    $('reFormula').innerHTML = thermal
      ? '<i>Ra</i> = <i>g β</i> Δ<i>T H</i>³ / (<i>ν κ</i>) – buoyancy versus friction and heat conduction'
      : '<i>Re</i> = <i>U</i>·<i>L</i> / <i>ν</i> = ' + uTxt + ' · ' + fmtUnit(sc.refLen * state.L, 'len') + ' / ' + fmt(phys.nu * 1e6) + ' mm²/s';
    $('reMarker').style.left = Math.min(100, Math.max(0, (Math.log10(Math.max(lead, 1e-9)) + 2) * 10)) + '%';
    $('reRegime').textContent = regimeText(sc, phys.Re);
    let extra = 'Reference length <i>L</i>: ' + sc.refName + ' = <b>' + fmtUnit(sc.refLen * state.L, 'len') + '</b>';
    if (thermal) {
      extra = 'Prandtl number <i>Pr</i> = <i>ν</i>/<i>κ</i> = <b>' + fmt(phys.Pr) + '</b> · free-fall velocity √(<i>gβ</i>Δ<i>T H</i>) = <b>' + fmtUnit(phys.U0, 'vel') + '</b> · hence <i>Re</i> = <b>' + fmt(phys.Re) + '</b>';
    } else if (sc.kind === 'stir') {
      extra += '<br>The cursor moves to scale: one tank height per second corresponds to <b>' + fmtUnit(state.L, 'vel') + '</b>.';
    }
    $('extraNumbers').innerHTML = extra;
    const pre = $('rePresets');
    pre.innerHTML = '';
    if (sc.kind === 'driven') {
      const list = sc.id === 'karman' ? [20, 60, 100, 200, 1000] : sc.id === 'cavity' ? [10, 100, 400, 1000, 5000] : sc.id === 'tg' ? [10, 100, 1000] : [100, 1000, 10000];
      for (const re of list) {
        const b = document.createElement('button');
        b.textContent = 'Re = ' + re.toLocaleString('en-US');
        b.onclick = () => { state.U = re * phys.nu / (sc.refLen * state.L); paramsChanged(); };
        pre.appendChild(b);
      }
    }
    // tools / views
    for (const b of $('tools').children) b.hidden = !!b.dataset.thermal && sc.kind !== 'thermal';
    for (const b of $('views').children) b.hidden = !!b.dataset.thermal && sc.kind !== 'thermal';
    setPressed($('tools'), 'aria-checked', state.tool);
    setPressed($('views'), 'aria-checked', state.view);
    setPressed($('swatches'), 'aria-checked', state.dye);
    $('togParticles').setAttribute('aria-pressed', String(state.particles));
    $('togArrows').setAttribute('aria-pressed', String(state.arrows));
    $('brushSize').value = state.brush;
    $('speed').value = state.speed;
    $('res').value = String(state.ny);
    $('scheme').value = state.scheme;
    $('cycles').value = state.cycles; $('cyclesOut').textContent = state.cycles;
    const q = resolutionQuality();
    $('resInfo').innerHTML = 'Cell Reynolds number <i>U</i>Δ<i>x</i>/<i>ν</i> = <b>' + fmt(1 / phys.nuG) + '</b> · Status: <b>' + q[0] + '</b>' +
      (glx.precision !== 32 ? '<br>Note: this device only computes with 16-bit floating point, so accuracy is reduced.' : '');
    const hintText = (TOOLS.find((t) => t.id === state.tool) || TOOLS[0]).hint;
    if ($('hint').textContent !== hintText) {
      $('hint').textContent = hintText;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => $('hint').classList.add('gone'), 9000);
    }
    setPlayIcon();
    placeBrush();
  }

  function setPlayIcon() {
    $('btnPlay').innerHTML = state.paused
      ? '<svg viewBox="0 0 24 24"><path d="M7 4.500l12 7.500-12 7.500z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M6.500 5h4v14h-4zM13.500 5h4v14h-4z"/></svg>';
    $('btnPlay').setAttribute('aria-label', state.paused ? 'Resume' : 'Pause');
  }

  /** Fluid or scale parameters changed: no rebuild needed, only the dimensionless numbers. */
  function paramsChanged() {
    updatePhysics();
    if (state.scenario.analytic) { /* the exact solution is integrated along continuously via tgAcc */ }
    syncUI();
  }

  function buildUI() {
    const scSel = $('scenario');
    for (const s of NS.scenarios) scSel.add(new Option(s.name, s.id));
    scSel.onchange = () => loadScenario(scSel.value, true);
    const flSel = $('fluid');
    for (const f of NS.fluids) flSel.add(new Option(f.name, f.id));
    flSel.add(new Option('Custom fluid …', 'custom'));
    flSel.onchange = () => { if (flSel.value !== 'custom') setFluid(flSel.value); paramsChanged(); };

    const num = (el, cb) => el.addEventListener('input', () => { const v = parseFloat(String(el.value).replace(',', '.')); if (isFinite(v) && v > 0) { cb(v); paramsChanged(); } });
    $('muSlider').oninput = (e) => { state.mu = Math.pow(10, +e.target.value); paramsChanged(); };
    num($('muInput'), (v) => { state.mu = v * 1e-3; });
    $('rhoSlider').oninput = (e) => { state.rho = Math.pow(10, +e.target.value); paramsChanged(); };
    num($('rhoInput'), (v) => { state.rho = v; });
    num($('betaInput'), (v) => { state.beta = v * 1e-4; });
    num($('kappaInput'), (v) => { state.kappa = v * 1e-6; });
    $('lenSlider').oninput = (e) => { state.L = Math.pow(10, +e.target.value); paramsChanged(); };
    $('uSlider').oninput = (e) => { state.U = Math.pow(10, +e.target.value); paramsChanged(); };
    $('dtSlider').oninput = (e) => { state.dT = Math.pow(10, +e.target.value); paramsChanged(); };

    const tools = $('tools');
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = 'seg'; b.dataset.id = t.id; b.title = t.hint; b.setAttribute('role', 'radio');
      if (t.thermal) b.dataset.thermal = '1';
      b.innerHTML = '<svg viewBox="0 0 24 24">' + t.icon + '</svg><span>' + t.label + '</span>';
      b.onclick = () => { state.tool = t.id; syncUI(); $('hint').classList.remove('gone'); run.interacted = false; };
      tools.appendChild(b);
    }
    const views = $('views');
    for (const v of VIEWS) {
      const b = document.createElement('button');
      b.dataset.id = v.id; b.title = v.title; b.setAttribute('role', 'radio');
      if (v.thermal) b.dataset.thermal = '1';
      b.textContent = v.label;
      b.onclick = () => { state.view = v.id; syncUI(); };
      views.appendChild(b);
    }
    const sw = $('swatches');
    for (const s of SWATCHES) {
      const b = document.createElement('button');
      b.className = 'swatch ' + (s.cls || ''); b.dataset.id = s.id; b.setAttribute('role', 'radio');
      b.title = s.title || 'Dye';
      if (!s.cls) b.style.background = 'rgb(' + s.col.map((c) => Math.round(c * 255)).join(',') + ')';
      b.onclick = () => { state.dye = s.id; syncUI(); };
      sw.appendChild(b);
    }
    $('togParticles').onclick = () => { state.particles = !state.particles; renderer.needReset = true; syncUI(); };
    $('togArrows').onclick = () => { state.arrows = !state.arrows; syncUI(); };
    $('brushSize').oninput = (e) => { state.brush = +e.target.value; placeBrush(); };
    $('speed').onchange = (e) => { state.speed = e.target.value; run.budget = Math.min(run.budget, 4); syncUI(); };
    $('res').onchange = (e) => { state.ny = +e.target.value; rebuild(); };
    $('scheme').onchange = (e) => { state.scheme = e.target.value; paramsChanged(); };
    $('cycles').oninput = (e) => { state.cycles = +e.target.value; paramsChanged(); };
    $('btnPlay').onclick = () => { state.paused = !state.paused; setPlayIcon(); };
    $('btnStep').onclick = () => { state.paused = true; run.stepOnce = true; setPlayIcon(); };
    $('btnReset').onclick = () => rebuild();
    $('btnPanel').onclick = () => $('panel').scrollIntoView({ behavior: 'smooth' });
    $('btnCsv').onclick = exportSeries;
    $('btnField').onclick = exportField;
    $('btnPng').onclick = exportPng;

    const dl = $('readouts');
    for (const [id, label] of READOUTS) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.id = 'ro_' + id; dd.textContent = '–';
      dl.appendChild(dt); dl.appendChild(dd);
    }

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') { $('btnPlay').click(); e.preventDefault(); }
      else if (e.key === '.') $('btnStep').click();
      else if (e.key === 'r' || e.key === 'R') rebuild();
      else if (e.key === 'p' || e.key === 'P') $('togParticles').click();
      else if (e.key === 'v' || e.key === 'V') $('togArrows').click();
      else if (e.key >= '1' && e.key <= '5') {
        const v = +e.key - 1;
        if (v < 4 || state.scenario.kind === 'thermal') { state.view = v; syncUI(); }
      }
    });
    if (window.ResizeObserver) new ResizeObserver(layoutCanvas).observe($('viewport'));
    window.addEventListener('resize', layoutCanvas);
  }

  // ------------------------------------------------------------------ Export
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportSeries() {
    const f = state.rho * phys.U0 * phys.U0;
    const rows = ['t [s],E_kin [J/m],enstrophy [m^2/s^2],u_max [m/s],F_x [N/m],F_y [N/m]'];
    for (const p of run.hist) {
      rows.push([p.t, p.ke * f * phys.dx * phys.dx, p.ens * phys.U0 * phys.U0, p.umax * phys.U0, p.fx * f * phys.dx, p.fy * f * phys.dx].map((v) => v.toExponential(6)).join(','));
    }
    download('timeseries.csv', new Blob([rows.join('\n')], { type: 'text/csv' }));
  }
  function exportField() {
    const v = solver.readVelocity(), p = solver.readPressure(), nx = solver.nx, ny = solver.ny;
    const f = state.rho * phys.U0 * phys.U0, pm = run.stats ? run.stats.pMean : 0;
    const rows = ['x [m],y [m],u [m/s],v [m/s],p [Pa]'];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const u = 0.5 * (v.u[j * (nx + 1) + i] + v.u[j * (nx + 1) + i + 1]) * phys.U0;
      const w = 0.5 * (v.v[j * nx + i] + v.v[(j + 1) * nx + i]) * phys.U0;
      rows.push([((i + 0.5) * phys.dx).toExponential(5), ((j + 0.5) * phys.dx).toExponential(5), u.toExponential(5), w.toExponential(5), ((p[j * nx + i] - pm) * f).toExponential(5)].join(','));
    }
    download('field.csv', new Blob([rows.join('\n')], { type: 'text/csv' }));
  }
  function exportPng() {
    draw();
    canvas.toBlob((b) => { if (b) download('flow.png', b); }, 'image/png');
  }

  // ------------------------------------------------------------------ Start
  function fatal(msg) {
    const f = $('fatal');
    f.hidden = false;
    f.innerHTML = '<div><h1>Flow Lab cannot start</h1><p>' + msg + '</p><p>A current browser with WebGL 2 is required (Chrome, Edge, Firefox, Safari 15 or later).</p></div>';
  }

  /** Short GPU benchmark: picks the grid resolution so that real time is achievable. */
  function benchmarkResolution() {
    try {
      const ny = 128, nx = 256;
      solver.configure({ nx, ny, bc: [0, 0, 0, 0] });
      solver.params.nu = 0.01;
      const a = 12;
      solver.initVelocity({ vort: [[80, 64, 5, a], [170, 64, -5, a]] });
      solver.initScalars({});
      solver.initMask([]);
      for (let k = 0; k < 3; k++) solver.step(0.5, 1);
      glx.read(solver.corr);                       // wait for warm-up (shader compilation)
      const t0 = performance.now();
      const n = 8;
      for (let k = 0; k < n; k++) solver.step(0.5, 1);
      glx.read(solver.corr);
      const ms = (performance.now() - t0) / n;     // ms per time step at 256 x 128
      run.benchMs = ms;
      if (ms < 0.25) return 384;
      if (ms < 0.7) return 256;
      if (ms < 2.0) return 192;
      return 128;
    } catch (e) {
      console.warn(e);
      return 128;
    }
  }

  function init() {
    canvas = $('sim');
    try {
      glx = new NS.GLX(canvas);
      solver = new NS.Solver(glx);
      renderer = new NS.Renderer(glx, solver);
    } catch (e) {
      console.error(e);
      fatal(e.message);
      return;
    }
    const q = new URLSearchParams(location.search);
    buildUI();
    bindPointer();
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fatal('The graphics context was lost. Please reload the page.'); });
    if (q.get('res')) state.ny = Math.max(32, Math.min(1024, +q.get('res') || state.ny));
    else state.ny = benchmarkResolution();
    loadScenario(q.get('scenario') || 'tank', true);
    NS.app = {
      state, phys, run, solver, renderer, glx, rebuild, loadScenario, paramsChanged, ptr,
      /** Advance n time steps without rendering (for automated tests). */
      advance(n) {
        const sc = state.scenario;
        let g = 0;
        for (let k = 0; k < n; k++) {
          if (k % 10 === 0) { const st = solver.readStatsSync(); run.ub = st.cfl; }
          g += solver.step(sc.kind === 'thermal' ? 4 : 2.5, Math.max(run.ub * 1.25, sc.kind === 'stir' ? 0.02 : sc.kind === 'thermal' ? 0.05 : 1)).dt;
        }
        run.ub = solver.readStatsSync().cfl;
        run.ubHist = [run.ub];
        run.statsMinSteps = solver.steps;
        run.simTime += g * phys.T0;
        return g;
      },
    };
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
