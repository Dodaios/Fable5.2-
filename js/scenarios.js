/* Scenarios: geometry, boundary conditions and initial fields.
 * Lengths in cells (ny = cells across the domain height), velocities in units of U0. */
(function () {
  'use strict';
  const NS = (window.NSLab = window.NSLab || {});
  const BC = NS.BC;

  const COL = {
    cyan: [0.10, 0.75, 1.00], magenta: [1.00, 0.22, 0.62], gold: [1.00, 0.78, 0.12],
    green: [0.20, 1.00, 0.45], orange: [1.00, 0.45, 0.10], blue: [0.22, 0.38, 1.00], white: [0.9, 0.9, 0.9],
  };
  NS.dyeColors = COL;

  NS.scenarios = [
    {
      id: 'tank',
      tips: ["Stir slowly first, then fast: quick strokes leave vortex pairs that travel across the tank.", "Switch the fluid to honey and the motion dies at once. With air or mercury it lives much longer.", "“Vorticity” view: orange spins counter-clockwise, blue clockwise."],
      name: 'Open tank',
      desc: 'A closed tank of fluid at rest. Drag through it with your mouse or finger and watch vortices form, travel and decay through friction.',
      kind: 'stir', aspect: 2,
      bc: [BC.NOSLIP, BC.NOSLIP, BC.NOSLIP, BC.NOSLIP],
      refLen: 1, refName: 'tank height H',
      defaults: { fluid: 'water', L: 0.1, view: 0, tool: 'stir', particles: true, speed: 'realtime' },
      setup(sol, nx, ny) {
        const a = 0.085 * ny, G = 0.42 * a;
        sol.initVelocity({ vort: [[0.30 * nx, 0.5 * ny + 0.9 * a, G, a], [0.30 * nx, 0.5 * ny - 0.9 * a, -G, a]] });
        sol.initScalars({
          blobs: [
            { x: 0.30 * nx, y: 0.5 * ny, r: 0.17 * ny, col: COL.cyan },
            { x: 0.55 * nx, y: 0.62 * ny, r: 0.15 * ny, col: COL.magenta },
            { x: 0.60 * nx, y: 0.33 * ny, r: 0.13 * ny, col: COL.gold },
            { x: 0.80 * nx, y: 0.50 * ny, r: 0.16 * ny, col: COL.green },
          ],
        });
        sol.initMask([]);
      },
    },
    {
      id: 'karman',
      tips: ["Set Re = 20: the wake stays steady. From Re ≈ 47 it starts to oscillate.", "Compare the measured Strouhal number (Measurements) at Re = 100 and Re = 200.", "Use “Wall” to draw a second obstacle into the wake, or stir the incoming flow."],
      name: 'Kármán vortex street',
      desc: 'Uniform flow past a cylinder. Above Re ≈ 47 vortices shed alternately; the shedding frequency f follows the Strouhal number St = f·D/U ≈ 0.2.',
      kind: 'driven', aspect: 3,
      bc: [BC.INFLOW, BC.OUTFLOW, BC.SLIP, BC.SLIP],
      inflow: [0, 1, 0.5, 0.1], uc: 1, ubound: 2.2,
      refLen: 1 / 8, refName: 'cylinder diameter D',
      body: { D: 1 / 8 },
      inDye: [10, 0.5, 0, 0], inColA: COL.cyan, inColB: COL.orange,
      defaults: { fluid: 'water', L: 0.08, U: 0.015, view: 0, tool: 'stir', particles: false, speed: 'auto' },
      setup(sol, nx, ny) {
        // small perturbation in the wake so that vortex shedding does not have to grow out of round-off noise
        const a = ny / 16;
        sol.initVelocity({ mode: 1, vort: [[0.75 * ny + 2.5 * a, 0.5 * ny + 0.4 * a, 0.3 * a, a]] });
        sol.initScalars({ dyeMode: 6 });
        sol.initMask([{ type: 'circle', x: 0.75 * ny, y: 0.5 * ny + 0.31, a }]);
      },
    },
    {
      id: 'plate',
      tips: ["The measurements show the lift c_L and drag c_D of the plate.", "Raise the Reynolds number: the flow separates on the upper side, vortices drift away and the lift fluctuates.", "Erase the plate and draw your own profile."],
      name: 'Inclined plate (airfoil)',
      desc: 'A slender ellipse at an angle of attack. The flow around it produces lift (c_L) and drag (c_D); at large angles the flow stalls.',
      kind: 'driven', aspect: 3,
      bc: [BC.INFLOW, BC.OUTFLOW, BC.SLIP, BC.SLIP],
      inflow: [0, 1, 0.5, 0.1], uc: 1, ubound: 2.2,
      refLen: 0.3, refName: 'chord length c',
      body: { D: 0.3 },
      inDye: [14, 0.5, 0, 0], inColA: COL.cyan, inColB: COL.magenta,
      defaults: { fluid: 'air', L: 0.2, U: 0.25, view: 0, tool: 'stir', particles: false, speed: 'auto' },
      setup(sol, nx, ny) {
        sol.initVelocity({ mode: 1 });
        sol.initScalars({ dyeMode: 6 });
        sol.initMask([{ type: 'ellipse', x: 0.8 * ny, y: 0.5 * ny, a: 0.15 * ny, b: 0.017 * ny, angle: -0.26 }]);
      },
    },
    {
      id: 'cavity',
      tips: ["Try Re = 100, 1000 and 5000: the main vortex moves towards the centre and counter-rotating vortices grow in the corners.", "At Re = 10 (e.g. glycerin) the picture is almost mirror-symmetric, because inertia plays no role."],
      name: 'Lid-driven cavity',
      desc: 'The lid of a square box slides to the right and drags the fluid along. A classic benchmark for flow solvers (Ghia et al. 1982).',
      kind: 'driven', aspect: 1,
      bc: [BC.NOSLIP, BC.NOSLIP, BC.NOSLIP, BC.NOSLIP],
      wallU: [0, 1], ubound: 1.3,
      refLen: 1, refName: 'edge length L',
      defaults: { fluid: 'water', L: 0.05, U: 0.02, view: 0, tool: 'stir', particles: true, speed: 'auto' },
      setup(sol, nx, ny) {
        sol.initVelocity({ mode: 0 });
        sol.initScalars({ dyeMode: 5, dyeP: [6, 0, 0, 0], colA: COL.blue, colB: [0.9, 0.5, 0.1] });
        sol.initMask([]);
      },
    },
    {
      id: 'kh',
      tips: ["Waves grow out of the smooth interface, roll up into vortices and merge in pairs.", "Pick a more viscous fluid (olive oil, glycerin): friction widens the shear layer and damps the instability."],
      name: 'Kelvin–Helmholtz instability',
      desc: 'Two layers flow in opposite directions. The shear layer is unstable and rolls up into vortices, as in billow clouds or wind-driven waves.',
      kind: 'driven', aspect: 2,
      bc: [BC.PERIODIC, BC.PERIODIC, BC.SLIP, BC.SLIP],
      ubound: 1.2,
      refLen: 1, refName: 'domain height H',
      defaults: { fluid: 'water', L: 0.1, U: 0.1, view: 0, tool: 'stir', particles: false, speed: 'auto' },
      setup(sol, nx, ny) {
        sol.initVelocity({ mode: 3, p0: [0.5, 1 / 40, 0.5, 0.02], p1: [5, 0.07, 0, 0] });
        sol.initScalars({ dyeMode: 1, dyeP: [0.5, 0, 0, 0], colA: COL.cyan, colB: COL.magenta });
        sol.initMask([]);
      },
    },
    {
      id: 'jet',
      tips: ["The head of the jet rolls up into a vortex pair (mushroom shape).", "At Re = 100 the jet stays smooth; at Re = 1000 and above it starts to flap.", "Put an obstacle (“Wall”) into the jet."],
      name: 'Jet',
      desc: 'A jet enters fluid at rest from a nozzle on the left. Its head rolls up into a vortex pair; at higher Reynolds numbers the jet becomes unstable.',
      kind: 'driven', aspect: 2,
      bc: [BC.INFLOW, BC.OUTFLOW, BC.NOSLIP, BC.NOSLIP],
      inflow: [2, 1, 0.5, 0.045], uc: 0.25, ubound: 1.5,
      refLen: 0.09, refName: 'nozzle width d',
      inDye: [0, 0.5, 0, 1], inColA: COL.gold, inColB: COL.gold,
      defaults: { fluid: 'water', L: 0.1, U: 0.05, view: 0, tool: 'stir', particles: true, speed: 'auto' },
      setup(sol, nx, ny) {
        const k = 2 * Math.PI / ny;
        sol.initVelocity({ mode: 0, noise: [[3 * k, 2 * k, 0.02, 1.1], [5 * k, 3 * k, 0.012, 2.3], [2 * k, 5 * k, 0.012, 4.2]] });
        sol.initScalars({});
        sol.initMask([]);
      },
    },
    {
      id: 'benard',
      tips: ["Lower ΔT or the layer height until Ra < 1708: convection dies out and only heat conduction remains.", "Use “Heat” and “Cool” to trigger thermal plumes yourself.", "Air (Pr ≈ 0.7) and glycerin (Pr ≈ 12,000) convect very differently at the same Rayleigh number."],
      name: 'Rayleigh–Bénard convection',
      desc: 'Heated from below, cooled from above: beyond the critical Rayleigh number Ra ≈ 1708 convection sets in. Warm fluid rises in plumes and cold fluid sinks (Boussinesq approximation).',
      kind: 'thermal', aspect: 2,
      bc: [BC.PERIODIC, BC.PERIODIC, BC.NOSLIP, BC.NOSLIP],
      tempBC: [1, 0.5, 1, -0.5], ubound: 0.6,
      refLen: 1, refName: 'layer height H',
      defaults: { fluid: 'water', L: 0.02, dT: 2, view: 4, tool: 'stir', particles: true, speed: 'auto' },
      setup(sol, nx, ny) {
        sol.initVelocity({ mode: 0 });
        sol.initScalars({ tMode: 1, tP: [0.5, -0.5, 0.06, 0.5] });
        sol.initMask([]);
      },
    },
    {
      id: 'tg',
      tips: ["In the plot the dashed yellow curve is the exact solution and the blue one the simulation.", "“Deviation from exact solution” in the measurements stays in the per-mille range and falls quadratically as the grid is refined.", "As soon as you stir, the exact solution no longer applies."],
      name: 'Taylor–Green vortex (validation)',
      desc: 'For this vortex array the exact solution of the Navier–Stokes equations is known: the energy decays as exp(−4νk²t). The measurements show how far the simulation deviates from it.',
      kind: 'driven', aspect: 1,
      bc: [BC.PERIODIC, BC.PERIODIC, BC.PERIODIC, BC.PERIODIC],
      ubound: 2.0,
      refLen: 1, refName: 'edge length L',
      analytic: { type: 'tg', m: 2 }, explicit: true,
      defaults: { fluid: 'oliveoil', L: 0.1, U: 0.1, view: 1, tool: 'stir', particles: true, speed: 'auto', scheme: 'central' },
      setup(sol, nx, ny) {
        sol.initVelocity({ mode: 2, p0: [1, 2, 2, 0] });
        sol.initScalars({ dyeMode: 5, dyeP: [8, 0, 0, 0], colA: COL.cyan, colB: COL.magenta });
        sol.initMask([]);
      },
    },
  ];
  NS.scenarioById = (id) => NS.scenarios.find((s) => s.id === id);
})();
