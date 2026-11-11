/* Lid-driven cavity against Ghia et al. (1982).  Usage: node tests/cavity.js <Re> <N> [rk3|auto] [quick] */
const { open } = require('./run.js');
const G = require('./ghia.js');
const Re = Number(process.argv[2] || 100), N = Number(process.argv[3] || 64), mode = process.argv[4] || 'auto';
const upw = process.argv[5] === 'quick' ? [1, 0] : [0, 0];
function interp(prof, s) { // profile values at (k+0.5)/N, boundary values known
  const N = prof.length, x = s * N - 0.5;
  if (x <= 0) return null; if (x >= N - 1) return null;
  const k = Math.floor(x), f = x - k;
  return prof[k] * (1 - f) + prof[k + 1] * f;
}
(async () => {
  const { browser, page } = await open('tests/harness.html');
  await page.evaluate(([N, Re, fs, upw]) => tests.cavityInit(N, Re, { forceStiff: fs, upw }), [N, Re, mode === 'rk3' ? 1 : 0, upw]);
  let r, t0 = Date.now();
  for (let it = 0; it < 2000; it++) {
    r = await page.evaluate(() => tests.cavityRun(200));
    if (it % 5 === 0) console.log(`t=${r.t.toFixed(2)} steps=${r.steps} mode=${r.mode} s=${r.s} dt=${r.dt.toFixed(3)} change=${r.change.toExponential(2)} div=${r.divMax.toExponential(1)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    if (!r.valid) { console.log('UNSTABLE'); break; }
    if (r.change < 2e-6 && r.t > 5) break;
  }
  let eu = 0, ev = 0, rows = [];
  for (let k = 1; k < G.Y.length - 1; k++) {
    const un = interp(r.uc, G.Y[k]), vn = interp(r.vc, G.X[k]);
    const du = un === null ? 0 : un - G.u[Re][k], dv = vn === null ? 0 : vn - G.v[Re][k];
    eu = Math.max(eu, Math.abs(du)); ev = Math.max(ev, Math.abs(dv));
    rows.push(`${G.Y[k].toFixed(4)}  u=${un === null ? '   -   ' : un.toFixed(5)}  Ghia=${G.u[Re][k].toFixed(5)}  d=${du.toFixed(5)}   |  ${G.X[k].toFixed(4)}  v=${vn === null ? '   -   ' : vn.toFixed(5)}  Ghia=${G.v[Re][k].toFixed(5)}  d=${dv.toFixed(5)}`);
  }
  console.log(rows.join('\n'));
  console.log(`RESULT Re=${Re} N=${N} mode=${r.mode} t=${r.t.toFixed(1)} max|du|=${eu.toFixed(5)} max|dv|=${ev.toFixed(5)} umin=${Math.min(...r.uc).toFixed(5)} vmax=${Math.max(...r.vc).toFixed(5)} vmin=${Math.min(...r.vc).toFixed(5)}`);
  await browser.close();
})();
