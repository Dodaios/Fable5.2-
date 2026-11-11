/* Validierungsfälle – laufen im Browser, gesteuert von tests/validate.js (Playwright). */
(function () {
  'use strict';
  const NS = window.NSLab;
  const glx = new NS.GLX(document.getElementById('c'));
  const solver = new NS.Solver(glx);
  const T = (window.tests = { glx, solver });

  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const l2 = (a) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * a[k]; return Math.sqrt(s / a.length); };
  const linf = (a) => { let s = 0; for (let k = 0; k < a.length; k++) s = Math.max(s, Math.abs(a[k])); return s; };

  T.info = () => ({ precision: glx.precision, renderer: (() => { const e = glx.gl.getExtension('WEBGL_debug_renderer_info'); return e ? glx.gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })() });

  /** Mehrgitter: Residuenreduktion pro V-Zyklus für eine zufällige rechte Seite. */
  T.multigrid = (nx, ny, bc, cycles) => {
    solver.configure({ nx, ny, bc });
    const r = rng(7), n = nx * ny, rhs = new Float32Array(n);
    let mean = 0;
    for (let k = 0; k < n; k++) { rhs[k] = r() - 0.5; mean += rhs[k]; }
    mean /= n;
    for (let k = 0; k < n; k++) rhs[k] -= mean;
    glx.upload(solver.mg[0].rhs, rhs);
    const norms = [l2(rhs)];
    for (let k = 0; k < cycles; k++) {
      solver.solvePoisson(1, k > 0);
      norms.push(l2(solver.readResidual()));
    }
    return { levels: solver.mg.map((L) => L.w + 'x' + L.h), norms, factors: norms.slice(1).map((v, k) => v / norms[k]) };
  };

  /** Projektion eines zufälligen Feldes: verbleibende Divergenz. */
  T.projection = (nx, ny, bc, cycles) => {
    solver.configure({ nx, ny, bc });
    const r = rng(11), W = nx + 1, H = ny + 1, d = new Float32Array(W * H * 2);
    const perX = bc[0] === 2, perY = bc[2] === 2;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = 2 * (j * W + i);
      d[k] = (j < ny && (perX || (i > 0 && i < nx))) ? r() - 0.5 : 0;
      d[k + 1] = (i < nx && (perY || (j > 0 && j < ny))) ? r() - 0.5 : 0;
    }
    glx.upload(solver.u, d);
    const before = solver.readStatsSync();
    solver.projectField(cycles);
    const after = solver.readStatsSync();
    return { divBefore: before.divMax, divAfter: after.divMax, ratio: after.divMax / before.divMax };
  };

  /** Taylor-Green-Wirbel: Vergleich mit der exakten Lösung u ~ exp(-2 nu k^2 t). */
  T.taylorGreen = (N, nu, tEnd, opts) => {
    opts = opts || {};
    solver.configure({ nx: N, ny: N, bc: [2, 2, 2, 2] });
    Object.assign(solver.params, { nu, upw: opts.upw || [0, 0], cycles: opts.cycles || 3, cfl: opts.cfl || 0.8, force: [0, 0], buoy: [0, 0], diff: [0, 0, 0, 0], forceStiff: opts.forceStiff || 0 });
    solver.initVelocity({ mode: 2, p0: [1, 1, 1, 0] });
    const s0 = solver.readStatsSync();
    let nSteps = 0;
    const t0 = performance.now();
    while (solver.time < tEnd - 1e-9) {
      const want = opts.dt ? Math.min(opts.dt, tEnd - solver.time) : tEnd - solver.time;
      solver.step(want, 2.0);
      nSteps++;
    }
    const s1 = solver.readStatsSync();
    const k = 2 * Math.PI / N;
    const exact = Math.exp(-4 * nu * k * k * solver.time);
    const lam = 2 * (2 - 2 * Math.cos(k));            // Eigenwert des diskreten Laplace-Operators
    const exactDisc = Math.exp(-2 * nu * lam * solver.time);
    // Feldfehler
    const f = solver.readVelocity();
    const amp = Math.exp(-2 * nu * k * k * solver.time);
    let e2 = 0, emax = 0, cnt = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ue = amp * Math.sin(k * i) * Math.cos(k * (j + 0.5));
      const ve = -amp * Math.cos(k * (i + 0.5)) * Math.sin(k * j);
      const du = f.u[j * (N + 1) + i] - ue, dv = f.v[j * N + i] - ve;
      e2 += du * du + dv * dv; cnt += 2;
      emax = Math.max(emax, Math.abs(du), Math.abs(dv));
    }
    return {
      N, nu, t: solver.time, steps: nSteps, mode: solver.lastPlan.mode, dt: solver.lastPlan.dt,
      keRatio: s1.ke / s0.ke, exact, exactDisc,
      relErrKE: s1.ke / s0.ke / exact - 1, relErrKEdisc: s1.ke / s0.ke / exactDisc - 1,
      errL2: Math.sqrt(e2 / cnt) / amp, errMax: emax / amp, divMax: s1.divMax, divRms: s1.divRms,
      msPerStep: (performance.now() - t0) / nSteps,
    };
  };

  /** Poiseuille-Strömung (Volumenkraft, Haftwände): stationäres Parabelprofil. */
  T.poiseuille = (ny, nu, opts) => {
    opts = opts || {};
    const nx = 16;
    solver.configure({ nx, ny, bc: [2, 2, 0, 0] });
    const G = 8 * nu / (ny * ny);       // u_max = 1
    Object.assign(solver.params, { nu, upw: [0, 0], cycles: 2, cfl: 0.8, force: [G, 0], buoy: [0, 0], diff: [0, 0, 0, 0], forceStiff: opts.forceStiff || 0 });
    solver.initVelocity({ mode: 0 });
    const tEnd = (opts.tau || 12) * ny * ny / (Math.PI * Math.PI * nu);
    let nSteps = 0;
    while (solver.time < tEnd) { solver.step(tEnd - solver.time, 1.2); nSteps++; }
    const f = solver.readVelocity();
    let emax = 0, vmax = 0;
    const prof = [];
    for (let j = 0; j < ny; j++) {
      const y = j + 0.5;
      const ue = G / (2 * nu) * y * (ny - y);
      const un = f.u[j * (nx + 1) + 3];
      prof.push(un);
      emax = Math.max(emax, Math.abs(un - ue));
    }
    for (let k = 0; k < f.v.length; k++) vmax = Math.max(vmax, Math.abs(f.v[k]));
    return { ny, nu, steps: nSteps, mode: solver.lastPlan.mode, s: solver.lastPlan.s, dt: solver.lastPlan.dt, errMax: emax, vmax, uCenter: prof[ny >> 1] };
  };

  /** Deckelgetriebene Kavität: schrittweise bis zum stationären Zustand. */
  T.cavityInit = (N, Re, opts) => {
    opts = opts || {};
    solver.configure({ nx: N, ny: N, bc: [0, 0, 0, 0], wallU: [0, 1] });
    Object.assign(solver.params, { nu: N / Re, upw: opts.upw || [0, 0], cycles: opts.cycles || 2, cfl: 0.8, force: [0, 0], buoy: [0, 0], diff: [0, 0, 0, 0], forceStiff: opts.forceStiff || 0 });
    solver.initVelocity({ mode: 0 });
    T._cav = { N, prev: null };
    return true;
  };
  T.cavityRun = (nSteps) => {
    const N = T._cav.N;
    for (let k = 0; k < nSteps; k++) solver.step(1e9, 1.3);
    const f = solver.readVelocity();
    const uc = [], vc = [];
    for (let j = 0; j < N; j++) uc.push(f.u[j * (N + 1) + (N >> 1)]);
    for (let i = 0; i < N; i++) vc.push(f.v[(N >> 1) * N + i]);
    let change = 1;
    if (T._cav.prev) { change = 0; for (let j = 0; j < N; j++) change = Math.max(change, Math.abs(uc[j] - T._cav.prev[j])); }
    T._cav.prev = uc;
    const st = solver.readStatsSync();
    return { t: solver.time / N, steps: solver.steps, mode: solver.lastPlan.mode, s: solver.lastPlan.s, dt: solver.lastPlan.dt, change, uc, vc, divMax: st.divMax, valid: st.valid };
  };

  /** Zylinder im Kanal nach Schäfer & Turek (1996), Testfall 2D-2 (Re = 100, instationär).
   *  Kanal 2.2 x 0.41, Zylinder D = 0.1 bei (0.2, 0.2), parabolisches Einströmprofil, Haftwände. */
  T.cylinderInit = (ny, Re, opts) => {
    opts = opts || {};
    const h = 0.41 / ny;                       // Zellgröße in Benchmark-Einheiten
    const nx = Math.round(2.2 / h / 16) * 16;
    const D = 0.1 / h;
    solver.configure({ nx, ny, bc: [3, 4, 0, 0], inflow: [1, 1, 0.5, 0.1] });
    Object.assign(solver.params, { nu: D / Re, upw: opts.upw || [0, 0], cycles: opts.cycles || 2, cfl: 0.8, force: [0, 0], buoy: [0, 0], diff: [0, 0, 0, 0], uc: 1, forceStiff: 0 });
    solver.initVelocity({ mode: 1 });
    solver.initMask([{ type: 'circle', x: 0.2 / h, y: 0.2 / h, a: 0.5 * D }]);
    solver.projectField(8);
    T._cyl = { D, nx, ny, ub: 2.4 };
    return { nx, ny, D, nu: D / Re, levels: solver.mg.map((L) => L.w + 'x' + L.h) };
  };
  T.cylinderRun = (nSteps, every) => {
    const c = T._cyl, out = [];
    for (let k = 0; k < nSteps; k++) {
      solver.step(1e9, c.ub);
      if ((k + 1) % every === 0) {
        const st = solver.readStatsSync();
        c.ub = Math.max(1.5, st.cfl * 1.1);
        out.push([solver.time / c.D, 2 * st.fx / c.D, 2 * st.fy / c.D, st.divMax, st.valid ? 1 : 0]);
      }
    }
    return { rows: out, dt: solver.lastPlan.dt, mode: solver.lastPlan.mode, steps: solver.steps };
  };

  /** Abklingende Scherwelle u = sin(k y): testet die Zeitintegration der Reibung. */
  T.shearDecay = (ny, nu, tEnd, dt, forceStiff) => {
    const nx = 16;
    solver.configure({ nx, ny, bc: [2, 2, 2, 2] });
    Object.assign(solver.params, { nu, upw: [0, 0], cycles: 2, cfl: 1e9, force: [0, 0], buoy: [0, 0], diff: [0, 0, 0, 0], forceStiff });
    // u = sin(2 pi (j+1/2)/ny) über Taylor-Green-Init mit kx -> 0 geht nicht; direkt hochladen
    const W = nx + 1, H = ny + 1, d = new Float32Array(W * H * 2), k = 2 * Math.PI / ny;
    for (let j = 0; j < ny; j++) for (let i = 0; i < W; i++) d[2 * (j * W + i)] = Math.sin(k * (j + 0.5));
    glx.upload(solver.u, d);
    let nSteps = 0;
    while (solver.time < tEnd - 1e-9) { solver.step(Math.min(dt, tEnd - solver.time), 1e-6); nSteps++; }
    const f = solver.readVelocity();
    const lam = 2 - 2 * Math.cos(k);
    const exact = Math.exp(-nu * lam * solver.time);
    const amp = f.u[(ny >> 2) * W + 2] / Math.sin(k * ((ny >> 2) + 0.5));
    return { ny, nu, dt, steps: nSteps, mode: solver.lastPlan.mode, s: solver.lastPlan.s, amp, exact, relErr: amp / exact - 1 };
  };
})();
