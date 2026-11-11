/* Quick validation suite (about 2–4 minutes with software rendering).
 *   node tests/validate.js
 * Checks the solver against analytical solutions and reports deviations; exit code 1 on failure. */
const { open } = require('./run.js');

(async () => {
  const { browser, page } = await open('tests/harness.html');
  const info = await page.evaluate(() => tests.info());
  console.log('Renderer:', info.renderer, '| floating point:', info.precision, 'bit\n');
  let failed = 0;
  const check = (name, value, limit, text) => {
    const ok = Math.abs(value) <= limit;
    if (!ok) failed++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(46)} ${text || value.toExponential(2)}  (limit ${limit})`);
  };

  console.log('1) Multigrid Poisson solver: residual reduction per V-cycle');
  for (const [nx, ny, bc, label] of [[64, 64, [0, 0, 0, 0], 'walls'], [128, 64, [2, 2, 0, 0], 'x-periodic'], [64, 64, [2, 2, 2, 2], 'periodic'], [256, 128, [3, 4, 1, 1], 'inflow/outflow']]) {
    const r = await page.evaluate(([nx, ny, bc]) => tests.multigrid(nx, ny, bc, 5), [nx, ny, bc]);
    const worst = Math.max(...r.factors.slice(0, 4));
    check(`${nx}x${ny} ${label}`, worst, 0.25, `factor <= ${worst.toFixed(3)}, after 5 cycles ${(r.norms[5] / r.norms[0]).toExponential(1)}`);
  }

  console.log('\n2) Projection: remaining divergence of a random field (8 cycles)');
  for (const [nx, ny, bc, label] of [[64, 64, [0, 0, 0, 0], 'walls'], [64, 64, [2, 2, 2, 2], 'periodic']]) {
    const r = await page.evaluate(([nx, ny, bc]) => tests.projection(nx, ny, bc, 8), [nx, ny, bc]);
    check(`${nx}x${ny} ${label}`, r.ratio, 1e-5, `max|div| ${r.divBefore.toFixed(2)} -> ${r.divAfter.toExponential(1)}`);
  }

  console.log('\n3) Taylor-Green vortex (exact solution of the Navier-Stokes equations), half-life of the energy');
  const errs = [];
  for (const N of [16, 32, 64]) {
    const nu = 0.05 * N / 32, k = 2 * Math.PI / N, tEnd = Math.log(2) / (4 * nu * k * k);
    const r = await page.evaluate(([N, nu, tEnd]) => tests.taylorGreen(N, nu, tEnd, {}), [N, nu, tEnd]);
    errs.push(r.errL2);
    check(`N=${N}: energy vs. exact`, r.relErrKE, 0.012 * (16 / N) ** 2 * 1.3, `${(100 * r.relErrKE).toFixed(3)} %  | field error L2 ${r.errL2.toExponential(2)} | div ${r.divMax.toExponential(1)}`);
    check(`N=${N}: time integration (vs. discrete operator)`, r.relErrKEdisc, 2e-4);
  }
  const order = Math.log2(errs[1] / errs[2]);
  check('Spatial order of convergence (32 -> 64)', 2 - Math.min(order, 2), 0.15, `order ${order.toFixed(2)}`);

  console.log('\n4) Poiseuille flow (steady parabolic profile), error relative to u_max');
  for (const [ny, nu, fs, label] of [[16, 0.5, 1, 'RK3'], [32, 0.25, 1, 'RK3'], [16, 5, 2, 'RKC'], [32, 10, 0, 'RKC'], [32, 200, 0, 'RKC very viscous']]) {
    const r = await page.evaluate(([ny, nu, fs]) => tests.poiseuille(ny, nu, { forceStiff: fs, tau: 9 }), [ny, nu, fs]);
    check(`ny=${ny}, nu=${nu} (${label}, ${r.mode}${r.mode === 'rkc' ? ' s=' + r.s : ''})`, r.errMax, 1.15 / (ny * ny), `${r.errMax.toExponential(2)} (expected h² error ${(1 / (ny * ny)).toExponential(2)})`);
  }

  console.log('\n5) Decaying shear wave: temporal accuracy of the viscous term');
  const a = await page.evaluate(() => tests.shearDecay(32, 2.0, 16, 0.07, 1));
  check('RK3 explicit', a.relErr, 1e-4);
  const e = [];
  for (const dt of [4, 2, 1]) { const r = await page.evaluate((dt) => tests.shearDecay(32, 2.0, 16, dt, 2), dt); e.push(Math.abs(r.relErr)); }
  check('RKC 2nd order (stiff), dt=1', e[2], 0.002, `${(100 * e[2]).toFixed(3)} %`);
  check('RKC order of convergence >= 2', 2 - Math.min(Math.log2(e[1] / e[2]), 2), 0.25, `order ${Math.log2(e[1] / e[2]).toFixed(2)}`);
  const tg = await page.evaluate(() => tests.taylorGreen(32, 2.0, 2.2, { forceStiff: 2 }));
  check('Taylor-Green in stiff mode (RKC)', tg.relErrKEdisc, 1e-3, `${(100 * tg.relErrKEdisc).toFixed(3)} % after ${tg.steps} steps`);

  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
