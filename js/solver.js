/* Incompressible Navier-Stokes solver (2D) on the GPU.
 *
 *   du/dt + div(u u) = -grad(p) + nu * Laplace(u) + f,     div(u) = 0
 *   dc/dt + div(u c) = D * Laplace(c)                      (dye, temperature)
 *
 * Discretisation
 *   Space:    staggered MAC grid, 2nd-order finite volumes; central advection
 *             (kinetic-energy conserving) with optional QUICK upwind correction.
 *   Time:     3rd-order SSP Runge-Kutta, projection in every stage (incremental
 *             pressure form). For stiff viscosity (viscous fluids): pressure-
 *             correction scheme with 2nd-order Runge-Kutta-Chebyshev stages for
 *             the viscous term.
 *   Pressure: Poisson equation by geometric multigrid (red-black Gauss-Seidel,
 *             exact solve on the coarsest grid).
 *   Bodies:   immersed boundaries with direct forcing (volume-fraction mask).
 *
 * All quantities in grid units: dx = 1, velocity in units of U0,
 * time in dx/U0, nu = 1/Re_cell. Conversion to SI happens in app.js.
 */
(function () {
  'use strict';
  const NS = (window.NSLab = window.NSLab || {});
  const S = NS.shaders;

  const BC = { NOSLIP: 0, SLIP: 1, PERIODIC: 2, INFLOW: 3, OUTFLOW: 4 };

  // Stability limit for explicit diffusion (nu * dt); RK3 alone tolerates up to ~0.31,
  // combined with advection at CFL <= 1 the value 0.15 stays safely inside the stability region.
  const NU_DT_EXPLICIT = 0.15;
  const RKC_EPS = 4;         // damping of the Chebyshev stages (stiff modes: |P| <~ 0.45)
  const RKC_SMAX = 240;

  /** Gauss-Jordan inversion of a dense n x n matrix (Float64Array, row-major). */
  function invertDense(A, n) {
    const M = new Float64Array(A);
    const I = new Float64Array(n * n);
    for (let i = 0; i < n; i++) I[i * n + i] = 1;
    for (let c = 0; c < n; c++) {
      let piv = c, best = Math.abs(M[c * n + c]);
      for (let r = c + 1; r < n; r++) {
        const v = Math.abs(M[r * n + c]);
        if (v > best) { best = v; piv = r; }
      }
      if (best < 1e-14) throw new Error('Coarse-grid matrix is singular');
      if (piv !== c) {
        for (let k = 0; k < n; k++) {
          let t = M[c * n + k]; M[c * n + k] = M[piv * n + k]; M[piv * n + k] = t;
          t = I[c * n + k]; I[c * n + k] = I[piv * n + k]; I[piv * n + k] = t;
        }
      }
      const d = 1 / M[c * n + c];
      for (let k = 0; k < n; k++) { M[c * n + k] *= d; I[c * n + k] *= d; }
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r * n + c];
        if (f === 0) continue;
        const rn = r * n, cn = c * n;
        for (let k = 0; k < n; k++) { M[rn + k] -= f * M[cn + k]; I[rn + k] -= f * I[cn + k]; }
      }
    }
    return I;
  }

  /** (Pseudo-)inverse of the 5-point Laplace operator on the coarsest grid. */
  function coarseInverse(w, h, perX, perY, h2) {
    const n = w * h;
    const A = new Float64Array(n * n);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const r = j * w + i;
        let cnt = 0;
        for (const [dx, dy] of dirs) {
          let ii = i + dx, jj = j + dy;
          if (ii < 0 || ii >= w) { if (perX) ii = (ii + w) % w; else continue; }
          if (jj < 0 || jj >= h) { if (perY) jj = (jj + h) % h; else continue; }
          A[r * n + jj * w + ii] += 1 / h2;
          cnt++;
        }
        A[r * n + r] -= cnt / h2;
      }
    }
    // regularise the null space (constant): acts as the pseudo-inverse on zero-mean right-hand sides
    const reg = 1 / (h2 * n);
    for (let k = 0; k < n * n; k++) A[k] -= reg;
    return new Float32Array(invertDense(A, n));
  }

  /** Coefficients of the damped 2nd-order Runge-Kutta-Chebyshev method
   *  (Sommeijer, Shampine & Verwer 1998), s >= 2 stages:
   *    Y_1 = Y_0 + mt_1 dt F_0
   *    Y_j = (1 - mu_j - nu_j) Y_0 + mu_j Y_{j-1} + nu_j Y_{j-2} + mt_j dt F_{j-1} + gt_j dt F_0
   *  Stability interval [-beta, 0] with beta = (1 + w0) / w1. */
  function rkcCoeffs(s, eps) {
    const w0 = 1 + eps / (s * s);
    const T = [1, w0], dT = [0, 1], ddT = [0, 0];
    for (let j = 2; j <= s; j++) {
      T.push(2 * w0 * T[j - 1] - T[j - 2]);
      dT.push(2 * T[j - 1] + 2 * w0 * dT[j - 1] - dT[j - 2]);
      ddT.push(4 * dT[j - 1] + 2 * w0 * ddT[j - 1] - ddT[j - 2]);
    }
    const w1 = dT[s] / ddT[s];
    const b = [0, 0];
    for (let j = 2; j <= s; j++) b.push(ddT[j] / (dT[j] * dT[j]));
    b[0] = b[1] = b[2];
    const a = b.map((bj, j) => 1 - bj * T[j]);
    // stages as (c0, c1, c2, c3, c4) for  c0*Y0 + c1*Y_{j-1} + c2*Y_{j-2} + c3*dt*F_{j-1} + c4*dt*F_0
    const st = [{ c0: 1, c1: 0, c2: 0, c3: 0, c4: b[1] * w1 }];
    for (let j = 2; j <= s; j++) {
      const mu = 2 * b[j] * w0 / b[j - 1], nu = -b[j] / b[j - 2], mt = 2 * b[j] * w1 / b[j - 1];
      st.push({ c0: 1 - mu - nu, c1: mu, c2: nu, c3: mt, c4: -a[j - 1] * mt });
    }
    return { stages: st, beta: (1 + w0) / w1 };
  }

  /** smallest number of stages (>= 2) with stability interval >= z */
  function rkcStageCount(z, eps) {
    let s = Math.max(2, Math.floor(Math.sqrt(z / 0.7)));
    while (s < 4000 && 0.92 * rkcCoeffs(s, eps).beta < z) s++;
    return s;
  }

  class Solver {
    constructor(glx) {
      this.glx = glx;
      const P = (src, name) => glx.program(src, name);
      this.prog = {
        rhs: P(S.RHS, 'rhs'), rkc: P(S.RKC, 'rkc'), scal: P(S.SCALAR, 'scalar'),
        outflow: P(S.OUTFLOW, 'outflow'), div: P(S.DIV, 'div'), gradsub: P(S.GRADSUB, 'gradsub'),
        pupd: P(S.PUPDATE, 'pupdate'),
        smooth: P(S.MG_SMOOTH, 'mg-smooth'), restrict: P(S.MG_RESTRICT, 'mg-restrict'),
        residual: P(S.MG_RESIDUAL, 'mg-residual'), prolong: P(S.MG_PROLONG, 'mg-prolong'),
        direct: P(S.MG_DIRECT, 'mg-direct'),
        initVel: P(S.INIT_VEL, 'init-vel'), initScal: P(S.INIT_SCAL, 'init-scal'),
        initMask: P(S.INIT_MASK, 'init-mask'), maskDraw: P(S.MASK_DRAW, 'mask-draw'),
        stats: P(S.STATS, 'stats'), reduce: P(S.REDUCE, 'reduce'), probe: P(S.PROBE, 'probe'),
      };
      this.params = {
        nu: 0.01,            // kinematic viscosity in grid units (= 1/Re_cell)
        upw: [0, 0],         // upwind fraction: gamma = clamp(upw0 + upw1*|a|, 0, 1)
        force: [0, 0],       // uniform body force
        buoy: [0, 0],        // buoyancy: coefficient, reference temperature
        diff: [0, 0, 0, 0],  // diffusivities (dye r,g,b; temperature)
        cycles: 2,           // multigrid V-cycles per projection
        cfl: 0.75,
        uc: 1,               // convection velocity at the outflow
        forceStiff: 0,       // tests only: 1 = always RK3, 2 = always RKC
      };
      this.tool = {
        seg: [0, 0, 0, 0], vel: [0, 0],
        velPar: [8, 2, 0, 0],      // radius, rate, hard, active
        scalPar: [8, 4, 0, 0],
        col: [1, 1, 1, 0], chan: [1, 1, 1, 0],
      };
      this.nx = 0; this.ny = 0;
      this.targets = [];
      this.time = 0; this.steps = 0;
      this.pShift = 0;
      this._sync = null;
      this._statBuf = new Float32Array(24);
      const gl = glx.gl;
      this.pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 24 * 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.lastPlan = { mode: 'rk3', dt: 0, s: 0 };
    }

    _t(w, h, kind) {
      const t = this.glx.target(w, h, kind);
      this.targets.push(t);
      return t;
    }

    dispose() {
      for (const t of this.targets) this.glx.free(t);
      this.targets = [];
      if (this.mg) for (const L of this.mg) if (L.G) this.glx.free(L.G);
      this.mg = null;
      if (this._sync) { this.glx.gl.deleteSync(this._sync); this._sync = null; }
    }

    /** Set grid and boundary conditions (all fields are re-allocated). */
    configure(cfg) {
      this.dispose();
      const nx = cfg.nx, ny = cfg.ny;
      const bc = cfg.bc.slice();
      if ((bc[0] === BC.PERIODIC) !== (bc[1] === BC.PERIODIC) || (bc[2] === BC.PERIODIC) !== (bc[3] === BC.PERIODIC)) {
        throw new Error('Periodic boundaries must be set in pairs.');
      }
      if ((bc[0] === BC.INFLOW) !== (bc[1] === BC.OUTFLOW)) throw new Error('Inflow (left) requires outflow (right).');
      this.nx = nx; this.ny = ny; this.bc = bc;
      this.perX = bc[0] === BC.PERIODIC; this.perY = bc[2] === BC.PERIODIC;
      this.hasOutflow = bc[1] === BC.OUTFLOW;
      this.setBoundaryData(cfg);
      this.glx.setCommon({ uN: [nx, ny], uBC: bc });

      const W = nx + 1, H = ny + 1;
      this.u = this._t(W, H, 'rg'); this.ua = this._t(W, H, 'rg');
      this.ub = this._t(W, H, 'rg'); this.uc = this._t(W, H, 'rg'); this.ud = this._t(W, H, 'rg');
      this.p = this._t(nx, ny, 'r'); this.pb = this._t(nx, ny, 'r');
      this.s = this._t(nx, ny, 'rgba'); this.sa = this._t(nx, ny, 'rgba'); this.sb = this._t(nx, ny, 'rgba');
      this.mask = this._t(nx, ny, 'r8'); this.maskB = this._t(nx, ny, 'r8');
      this.corr = this._t(1, 1, 'rgba');
      this.probeT = this._t(2, 1, 'rgba');

      // multigrid hierarchy
      this.mg = [];
      let w = nx, h = ny, l = 0;
      for (;;) {
        this.mg.push({ w, h, h2: Math.pow(4, l), x: this._t(w, h, 'r'), xb: this._t(w, h, 'r'), rhs: this._t(w, h, 'r') });
        const canCoarsen = w % 2 === 0 && h % 2 === 0 && Math.min(w, h) >= 4;
        if (w * h <= 320 || !canCoarsen) break;
        w >>= 1; h >>= 1; l++;
      }
      const last = this.mg[this.mg.length - 1];
      const n = last.w * last.h;
      if (n <= 800) last.G = this.glx.dataTexture(n, n, coarseInverse(last.w, last.h, this.perX, this.perY, last.h2));
      else last.iter = 80;

      // diagnostics reduction
      this.statFull = this._t(nx, ny, 'rgba');
      this.statMid = [];
      w = nx; h = ny;
      for (;;) {
        w = Math.ceil(w / 8); h = Math.ceil(h / 8);
        if (w === 1 && h === 1) break;
        this.statMid.push(this._t(w, h, 'rgba'));
      }
      this.statFinal = [0, 1, 2, 3].map(() => this._t(1, 1, 'rgba'));

      this.time = 0; this.steps = 0; this.pShift = 0;
    }

    /** Boundary data that may be changed without a rebuild. */
    setBoundaryData(d) {
      const c = {};
      if (d.wallU) c.uWallU = this.wallU = d.wallU.slice();
      if (d.inflow) c.uInflow = this.inflow = d.inflow.slice();
      if (d.tempBC) c.uTempBC = this.tempBC = d.tempBC.slice();
      if (d.inDye) c.uInDye = this.inDye = d.inDye.slice();
      if (d.inColA) c.uInColA = d.inColA.slice();
      if (d.inColB) c.uInColB = d.inColB.slice();
      if (!this.wallU) c.uWallU = this.wallU = [0, 0];
      if (!this.inflow) c.uInflow = this.inflow = [0, 0, 0.5, 0.1];
      if (!this.tempBC) c.uTempBC = this.tempBC = [0, 0, 0, 0];
      if (!this.inDye) c.uInDye = this.inDye = [0, 0.5, 0, 0];
      this.glx.setCommon(c);
    }

    // ----------------------------------------------------------------- initial fields
    initVelocity(spec) {
      spec = spec || {};
      const vort = new Float32Array(32), noise = new Float32Array(32);
      (spec.vort || []).slice(0, 8).forEach((v, k) => vort.set(v, 4 * k));
      (spec.noise || []).slice(0, 8).forEach((v, k) => noise.set(v, 4 * k));
      this.prog.initVel.use({
        uMode: spec.mode || 0, uP0: spec.p0 || [0, 0, 0, 0], uP1: spec.p1 || [0, 0, 0, 0],
        uVort: vort, uNVort: Math.min(8, (spec.vort || []).length),
        uNoise: noise, uNNoise: Math.min(8, (spec.noise || []).length),
      });
      this.glx.draw(this.u);
      this.glx.clear(this.p); this.glx.clear(this.pb);
      this.glx.clear(this.corr);
      this.time = 0; this.steps = 0;
    }

    initScalars(spec) {
      spec = spec || {};
      const blob = new Float32Array(32), blobCol = new Float32Array(24);
      (spec.blobs || []).slice(0, 8).forEach((b, k) => { blob.set([b.x, b.y, b.r, 0], 4 * k); blobCol.set(b.col, 3 * k); });
      this.prog.initScal.use({
        uDyeMode: spec.dyeMode || 0, uDyeP: spec.dyeP || [0.5, 0, 0, 0],
        uColA: spec.colA || [0, 0, 0], uColB: spec.colB || [0, 0, 0],
        uBlob: blob, uBlobCol: blobCol, uNBlob: Math.min(8, (spec.blobs || []).length),
        uTMode: spec.tMode || 0, uTP: spec.tP || [0, 0, 0, 0.5],
      });
      this.glx.draw(this.s);
    }

    /** shapes: [{type:'circle'|'box'|'ellipse', x, y, a, b, angle}] in grid units */
    initMask(shapes) {
      shapes = (shapes || []).slice(0, 8);
      const A = new Float32Array(32), B = new Float32Array(32);
      const types = { circle: 0, box: 1, ellipse: 2 };
      shapes.forEach((s, k) => {
        A.set([types[s.type] || 0, s.x, s.y, s.angle || 0], 4 * k);
        B.set([s.a, s.b === undefined ? s.a : s.b, 0, 0], 4 * k);
      });
      this.prog.initMask.use({ uShapeA: A, uShapeB: B, uNShape: shapes.length });
      this.glx.draw(this.mask);
    }

    drawMask(seg, radius, erase) {
      this.prog.maskDraw.use({ uMask: this.mask, uToolSeg: seg, uToolPar: [radius, 0, 1, 1], uErase: erase ? 1 : 0 });
      this.glx.draw(this.maskB);
      const t = this.mask; this.mask = this.maskB; this.maskB = t;
    }

    // ----------------------------------------------------------------- multigrid
    _smooth(L, zero) {
      this.prog.smooth.use({
        uX: L.x, uRhs: L.rhs, uSize: [L.w, L.h], uPer: [this.perX ? 1 : 0, this.perY ? 1 : 0],
        uH2: L.h2, uZero: zero ? 1 : 0,
      });
      this.glx.draw(L.xb);
      const t = L.x; L.x = L.xb; L.xb = t;
    }

    _vcycle(l, zero) {
      const L = this.mg[l];
      const per = [this.perX ? 1 : 0, this.perY ? 1 : 0];
      if (l === this.mg.length - 1) {
        if (L.G) {
          this.prog.direct.use({ uG: L.G, uRhs: L.rhs, uSize: [L.w, L.h] });
          this.glx.draw(L.x);
        } else {
          for (let k = 0; k < L.iter; k++) this._smooth(L, zero && k === 0);
        }
        return;
      }
      this._smooth(L, zero);
      const Lc = this.mg[l + 1];
      this.prog.restrict.use({ uX: L.x, uRhs: L.rhs, uSize: [L.w, L.h], uPer: per, uH2: L.h2 });
      this.glx.draw(Lc.rhs);
      this._vcycle(l + 1, true);
      this.prog.prolong.use({ uX: L.x, uCoarse: Lc.x, uCSize: [Lc.w, Lc.h], uPer: per });
      this.glx.draw(L.xb);
      const t = L.x; L.x = L.xb; L.xb = t;
      this._smooth(L, false);
    }

    /** Solves Laplace(x) = mg[0].rhs; result in mg[0].x. */
    solvePoisson(cycles, continueFromCurrent) {
      for (let k = 0; k < cycles; k++) this._vcycle(0, k === 0 && !continueFromCurrent);
      return this.mg[0].x;
    }

    /** Projection onto the divergence-free field: velOut = velIn - grad(psi), Laplace(psi) = div(velIn). */
    _project(velIn, velOut, pScale) {
      const pr = this.prog, glx = this.glx;
      if (this.hasOutflow) { pr.outflow.use({ uVel: velIn }); glx.draw(this.corr); }
      pr.div.use({ uVel: velIn, uCorr: this.corr });
      glx.draw(this.mg[0].rhs);
      const psi = this.solvePoisson(this.params.cycles, false);
      pr.gradsub.use({ uVel: velIn, uPsi: psi, uCorr: this.corr });
      glx.draw(velOut);
      if (pScale) {
        pr.pupd.use({ uP: this.p, uPsi: psi, uScale: pScale, uShift: this.pShift });
        glx.draw(this.pb);
        const t = this.p; this.p = this.pb; this.pb = t;
        this.pShift = 0;
      }
    }

    /** Make the current field divergence-free (after initial conditions / geometry changes). */
    projectField(cycles) {
      const keep = this.params.cycles;
      this.params.cycles = cycles || 8;
      this._project(this.u, this.ub, 0);
      this.params.cycles = keep;
      const t = this.u; this.u = this.ub; this.ub = t;
    }

    // ----------------------------------------------------------------- time step
    /** Chooses step size and scheme. dtWant: requested step size, ub: bound for |u|+|v|. */
    plan(dtWant, ub) {
      const p = this.params;
      const kap = Math.max(p.diff[0], p.diff[1], p.diff[2], p.diff[3]);
      let dt = Math.min(dtWant, p.cfl / Math.max(ub, 1e-9));
      if (kap > 0) dt = Math.min(dt, NU_DT_EXPLICIT / kap);
      if (p.forceStiff === 1) return { mode: 'rk3', dt: Math.min(dt, NU_DT_EXPLICIT / Math.max(p.nu, 1e-12)), s: 3 };
      if (p.forceStiff !== 2 && p.nu * dt <= NU_DT_EXPLICIT) return { mode: 'rk3', dt, s: 3 };
      // stiff: Euler advection is stable only for u^2 dt / nu <= 2
      let dtR = Math.min(dt, 1.5 * p.nu / Math.max(ub * ub, 1e-12));
      if (p.forceStiff !== 2 && p.nu * dtR / NU_DT_EXPLICIT < 2.5) return { mode: 'rk3', dt: Math.min(dt, NU_DT_EXPLICIT / p.nu), s: 3 };
      let s = rkcStageCount(8 * p.nu * dtR, RKC_EPS);
      if (s > RKC_SMAX) {
        s = RKC_SMAX;
        dtR = 0.92 * rkcCoeffs(s, RKC_EPS).beta / (8 * p.nu);
      }
      return { mode: 'rkc', dt: dtR, s };
    }

    step(dtWant, ub) {
      const plan = this.plan(dtWant, ub);
      if (plan.mode === 'rk3') this._stepRK3(plan.dt); else this._stepRKC(plan.dt, plan.s);
      this.time += plan.dt;
      this.steps++;
      this.lastPlan = plan;
      return plan;
    }

    _rhsUniforms(v, sCur, dt, a, b, mode, nu) {
      const p = this.params, tl = this.tool;
      return {
        uVel: v, uVel0: this.u, uPres: this.p, uScal: sCur, uMask: this.mask,
        uDt: dt, uNu: nu, uAB: [a, b], uUpw: p.upw, uForce: p.force, uBuoy: p.buoy,
        uUc: p.uc, uMode: mode,
        uToolSeg: tl.seg, uToolPar: tl.velPar, uToolVel: tl.vel,
      };
    }

    _scalUniforms(v, sCur, dt, a, b) {
      const p = this.params, tl = this.tool;
      return {
        uVel: v, uScal: sCur, uScal0: this.s, uDt: dt, uAB: [a, b], uDiff: p.diff,
        uToolSeg: tl.seg, uToolPar: tl.scalPar, uToolCol: tl.col, uToolChan: tl.chan,
      };
    }

    /** SSP-RK3 (Shu & Osher) with a projection in every stage. */
    _stepRK3(dt) {
      const pr = this.prog, glx = this.glx, p = this.params;
      const AB = [[0, 1], [0.75, 0.25], [1 / 3, 2 / 3]];
      const sTargets = [this.sa, this.sb, this.sa];
      let v = this.u, sCur = this.s;
      for (let k = 0; k < 3; k++) {
        const a = AB[k][0], b = AB[k][1];
        pr.rhs.use(this._rhsUniforms(v, sCur, dt, a, b, 0, p.nu));
        glx.draw(this.ua);
        pr.scal.use(this._scalUniforms(v, sCur, dt, a, b));
        glx.draw(sTargets[k]);
        sCur = sTargets[k];
        const out = k === 2 ? this.u : this.ub;
        this._project(this.ua, out, 1 / (b * dt));
        v = out;
      }
      const t = this.s; this.s = this.sa; this.sa = t;
    }

    /** Pressure-correction step with Runge-Kutta-Chebyshev diffusion (viscous fluids). */
    _stepRKC(dt, s) {
      const pr = this.prog, glx = this.glx, p = this.params, tl = this.tool;
      // tendency without viscosity: S = -div(uu) - grad(p) + f  (boundary faces: (target - u)/dt)
      pr.rhs.use(this._rhsUniforms(this.u, this.s, dt, 0, 1, 1, 0));
      glx.draw(this.ua);
      // scalars: RK3 with frozen velocity u^n
      const AB = [[0, 1], [0.75, 0.25], [1 / 3, 2 / 3]];
      const sTargets = [this.sa, this.sb, this.sa];
      let sCur = this.s;
      for (let k = 0; k < 3; k++) {
        pr.scal.use(this._scalUniforms(this.u, sCur, dt, AB[k][0], AB[k][1]));
        glx.draw(sTargets[k]);
        sCur = sTargets[k];
      }
      { const t = this.s; this.s = this.sa; this.sa = t; }
      // Chebyshev stages: Y_0 = this.u is kept, the stages rotate through three textures
      const co = rkcCoeffs(s, RKC_EPS).stages;
      let y2 = this.u, y1 = this.u;
      const pool = [this.ub, this.uc, this.ud];
      for (let j = 0; j < s; j++) {
        const out = pool[j % 3], k = co[j];
        pr.rkc.use({
          uY0: this.u, uY1: y1, uY2: y2, uS: this.ua, uMask: this.mask,
          uC0: k.c0, uC: [k.c1, k.c2, k.c3 * dt, k.c4 * dt], uNu: p.nu, uDtEff: dt / s,
          uToolSeg: tl.seg, uToolPar: tl.velPar, uToolVel: tl.vel,
        });
        glx.draw(out);
        y2 = y1; y1 = out;
      }
      // projection; the result replaces Y_0
      this._project(y1, this.u, 1 / dt);
    }

    // ----------------------------------------------------------------- diagnostics
    computeStats(probePos) {
      const pr = this.prog, glx = this.glx, p = this.params;
      for (let which = 0; which < 4; which++) {
        pr.stats.use({
          uVel: this.u, uPres: this.p, uScal: this.s, uMask: this.mask, uWhich: which,
          uNu: p.nu, uUpw: p.upw, uForce: [0, 0], uBuoy: [0, 0],
        });
        glx.draw(this.statFull);
        let src = this.statFull;
        const n = this.statMid.length;
        for (let k = 0; k <= n; k++) {
          const dst = k === n ? this.statFinal[which] : this.statMid[k];
          pr.reduce.use({ uSrc: src, uSrcSize: [src.w, src.h], uMode: which & 1 });
          glx.draw(dst);
          src = dst;
        }
      }
      pr.probe.use({ uVel: this.u, uPres: this.p, uScal: this.s, uMask: this.mask, uPos: probePos || [0, 0] });
      glx.draw(this.probeT);
    }

    _decode(b) {
      const n = this.nx * this.ny;
      return {
        time: this.time, steps: this.steps,
        ke: b[0], ens: b[1], divRms: Math.sqrt(Math.max(b[2], 0) / n), pMean: b[3] / n,
        cfl: b[4], umax: b[5], wmax: b[6], divMax: b[7],
        fx: b[8], fy: b[9], mx: b[10], my: b[11],
        pMax: b[12], pMin: -b[13], tMax: b[14], tMin: -b[15],
        probe: { u: b[16], v: b[17], p: b[18], w: b[19], T: b[20], dye: b[21], mask: b[22], div: b[23] },
        valid: isFinite(b[0]) && isFinite(b[4]) && isFinite(b[3]),
      };
    }

    /** Force on immersed bodies from two consecutive measurements (incl. -dM/dt). */
    static bodyForce(cur, prev) {
      if (!prev || !(cur.time > prev.time)) return [cur.fx, cur.fy];
      const dt = cur.time - prev.time;
      return [cur.fx - (cur.mx - prev.mx) / dt, cur.fy - (cur.my - prev.my) / dt];
    }

    readStatsSync(probePos) {
      this.computeStats(probePos);
      const b = new Float32Array(24);
      for (let k = 0; k < 4; k++) b.set(this.glx.read(this.statFinal[k]), 4 * k);
      b.set(this.glx.read(this.probeT), 16);
      return this._decode(b);
    }

    /** Compute diagnostics and read them back asynchronously (without stalling the pipeline). */
    requestStats(probePos) {
      if (this._sync) return false;
      const gl = this.glx.gl;
      this.computeStats(probePos);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 24 * 4, gl.STREAM_READ);
      for (let k = 0; k < 4; k++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.statFinal[k].fbo);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, k * 16);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeT.fbo);
      gl.readPixels(0, 0, 2, 1, gl.RGBA, gl.FLOAT, 64);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this._sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      this._syncMeta = { time: this.time, steps: this.steps };
      gl.flush();
      return true;
    }

    pollStats() {
      if (!this._sync) return null;
      const gl = this.glx.gl;
      const st = gl.clientWaitSync(this._sync, 0, 0);
      if (st === gl.TIMEOUT_EXPIRED) return null;
      gl.deleteSync(this._sync);
      this._sync = null;
      if (st === gl.WAIT_FAILED) return null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this._statBuf);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const r = this._decode(this._statBuf);
      r.time = this._syncMeta.time; r.steps = this._syncMeta.steps;
      return r;
    }

    /** Residual of the last Poisson solve (diagnostics/test): Float32Array of cell values. */
    readResidual() {
      const L = this.mg[0];
      this.prog.residual.use({ uX: L.x, uRhs: L.rhs, uSize: [L.w, L.h], uPer: [this.perX ? 1 : 0, this.perY ? 1 : 0], uH2: L.h2 });
      this.glx.draw(L.xb);
      const raw = this.glx.read(L.xb);
      const out = new Float32Array(L.w * L.h);
      for (let k = 0; k < out.length; k++) out[k] = raw[4 * k];
      return out;
    }

    /** Read back the velocity field: {u: (nx+1)*ny, v: nx*(ny+1)} (blocking; tests/export). */
    readVelocity() {
      const raw = this.glx.read(this.u);
      const W = this.nx + 1, nx = this.nx, ny = this.ny;
      const u = new Float32Array(W * ny), v = new Float32Array(nx * (ny + 1));
      for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) u[j * W + i] = raw[4 * (j * W + i)];
      for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = raw[4 * (j * W + i) + 1];
      if (this.perX) for (let j = 0; j < ny; j++) u[j * W + nx] = u[j * W];
      if (this.perY) for (let i = 0; i < nx; i++) v[ny * nx + i] = v[i];
      return { u, v, nx, ny };
    }

    readScalars() { return this.glx.read(this.s); }
    readPressure() {
      const raw = this.glx.read(this.p);
      const out = new Float32Array(this.nx * this.ny);
      for (let k = 0; k < out.length; k++) out[k] = raw[4 * k];
      return out;
    }
  }

  NS.Solver = Solver;
  NS.BC = BC;
  NS.numerics = { rkcCoeffs, rkcStageCount, coarseInverse, invertDense, NU_DT_EXPLICIT };
})();
