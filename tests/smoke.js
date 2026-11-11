/* Rauchtest der Anwendung: jedes Szenario laden, rechnen, auf Stabilität prüfen;
 * zusätzlich Rühren in Wasser / Honig / Luft.   node tests/smoke.js [res] */
const { chromium } = require('playwright');
const path = require('path');
const res = Number(process.argv[2] || 64);
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(0);
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html') + '?res=' + res);
  await page.waitForFunction(() => window.NSLab && NSLab.app);
  let failed = 0;
  const ids = await page.evaluate(() => NSLab.scenarios.map((s) => s.id));
  for (const id of ids) {
    const r = await page.evaluate((id) => {
      const a = NSLab.app;
      a.state.paused = true;
      a.loadScenario(id, true);
      a.advance(300);
      const st = a.solver.readStatsSync();
      return { valid: st.valid, umax: st.umax, div: st.divMax, mode: a.solver.lastPlan.mode, s: a.solver.lastPlan.s, t: a.run.simTime, Re: a.phys.Re, grid: a.solver.nx + 'x' + a.solver.ny };
    }, id);
    const ok = r.valid && r.div < 0.05 && r.umax < 10;
    if (!ok) failed++;
    console.log(`${ok ? '  ok  ' : 'FEHLER'} ${id.padEnd(10)} ${r.grid.padEnd(8)} Re=${r.Re.toPrecision(3).padEnd(9)} t=${r.t.toPrecision(3)} s  u_max=${r.umax.toFixed(3)}  div=${r.div.toExponential(1)}  ${r.mode}${r.mode === 'rkc' ? '(' + r.s + ')' : ''}`);
  }
  // Rühren in verschiedenen Flüssigkeiten (Werkzeug direkt setzen)
  for (const fluid of ['wasser', 'luft', 'olivenoel', 'glycerin', 'honig', 'quecksilber']) {
    const r = await page.evaluate((fluid) => {
      const a = NSLab.app, sol = a.solver;
      a.loadScenario('becken', true);
      const f = NSLab.fluidById(fluid);
      Object.assign(a.state, { fluid, rho: f.rho, mu: f.mu });
      a.paramsChanged();
      const nx = sol.nx, ny = sol.ny;
      let g = 0, modes = {};
      for (let k = 0; k < 120; k++) {
        const x0 = nx * (0.2 + 0.5 * k / 120), x1 = nx * (0.2 + 0.5 * (k + 1) / 120);
        sol.tool.seg = [x0, ny * 0.5, x1, ny * 0.5];
        sol.tool.vel = [0.8, 0];
        sol.tool.velPar = [0.06 * ny, 1.5, 0, 1];
        sol.tool.scalPar = [0.05 * ny, 3, 0, 1];
        sol.tool.col = [1, 0.5, 0.1, 0]; sol.tool.chan = [1, 1, 1, 0];
        const pl = sol.step((x1 - x0) / 0.8, 1.6);
        modes[pl.mode] = (modes[pl.mode] || 0) + 1; g += pl.dt;
      }
      const st = sol.readStatsSync();
      sol.tool.velPar[3] = 0; sol.tool.scalPar[3] = 0;
      for (let k = 0; k < 60; k++) sol.step(2, Math.max(st.cfl * 1.2, 0.02));
      const st2 = sol.readStatsSync();
      return { valid: st.valid && st2.valid, umax: st.umax, umax2: st2.umax, div: st.divMax, modes, Re: a.phys.Re, nuG: a.phys.nuG, last: sol.lastPlan };
    }, fluid);
    const ok = r.valid && r.umax > 0.2 && r.umax < 3 && r.div < 0.05;
    if (!ok) failed++;
    console.log(`${ok ? '  ok  ' : 'FEHLER'} Rühren in ${fluid.padEnd(12)} Re=${r.Re.toPrecision(3).padEnd(9)} nu_Gitter=${r.nuG.toPrecision(3).padEnd(8)} u_max=${r.umax.toFixed(3)} -> ${r.umax2.toFixed(3)} (nach Loslassen)  div=${r.div.toExponential(1)}  ${JSON.stringify(r.modes)} s=${r.last.s}`);
  }
  if (errors.length) { failed++; console.log('Konsolenfehler:\n' + errors.slice(0, 5).join('\n')); }
  console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen.` : '\nAlle Szenarien stabil.');
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
