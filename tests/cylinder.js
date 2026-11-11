/* Zylinderumströmung gegen den Benchmark von Schäfer & Turek (1996), Fall 2D-2 (Re = 100).
 * Aufruf: node tests/cylinder.js <ny> [tEnd in D/U] [quick]
 * Referenz: c_W,max = 3.22–3.24, c_A,max = 0.99–1.01, St = 0.295–0.305 */
const { open } = require('./run.js');
const ny = Number(process.argv[2] || 80), tEnd = Number(process.argv[3] || 120);
const upw = process.argv[4] === 'quick' ? [1, 0] : process.argv[4] === 'auto' ? 'auto' : [0, 0];
(async () => {
  const { browser, page } = await open('tests/harness.html');
  const info = await page.evaluate(([ny, upw]) => {
    const D = 0.1 / (0.41 / ny), nu = D / 100;
    return tests.cylinderInit(ny, 100, { upw: upw === 'auto' ? [-0.5, 0.25 / nu] : upw });
  }, [ny, upw]);
  console.log(JSON.stringify(info));
  const series = [];
  const t0 = Date.now();
  let last = 0;
  for (;;) {
    const r = await page.evaluate(() => tests.cylinderRun(60, 6));
    for (const row of r.rows) series.push(row);
    const t = series[series.length - 1][0];
    if (!series[series.length - 1][4]) { console.log('INSTABIL'); break; }
    if (t - last >= 5) {
      last = t;
      const rec = series.slice(-60);
      console.log(`t=${t.toFixed(1)} dt=${r.dt.toFixed(3)} cW=${rec[rec.length - 1][1].toFixed(3)} cA=${rec[rec.length - 1][2].toFixed(3)} div=${rec[rec.length - 1][3].toExponential(1)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    if (process.env.CYL_DUMP) require('fs').writeFileSync(process.env.CYL_DUMP, JSON.stringify(series));
    if (t >= tEnd) break;
  }
  // Auswertung über das letzte Drittel
  const tail = series.filter((r) => r[0] > tEnd * 0.66);
  const cdMax = Math.max(...tail.map((r) => r[1])), cdMin = Math.min(...tail.map((r) => r[1]));
  const clMax = Math.max(...tail.map((r) => r[2])), clMin = Math.min(...tail.map((r) => r[2]));
  const mean = tail.reduce((a, r) => a + r[2], 0) / tail.length;
  const cross = [];
  for (let k = 1; k < tail.length; k++) {
    const a = tail[k - 1][2] - mean, b = tail[k][2] - mean;
    if (a < 0 && b >= 0) cross.push(tail[k - 1][0] + (tail[k][0] - tail[k - 1][0]) * (-a) / (b - a));
  }
  const St = cross.length > 1 ? (cross.length - 1) / (cross[cross.length - 1] - cross[0]) : NaN;
  console.log(`RESULT ny=${ny} D=${info.D.toFixed(2)} Zellen: cW_max=${cdMax.toFixed(3)} (Ref 3.22-3.24)  cW_min=${cdMin.toFixed(3)}  cA_max=${clMax.toFixed(3)} (Ref 0.99-1.01)  cA_min=${clMin.toFixed(3)}  St=${St.toFixed(4)} (Ref 0.295-0.305)  Perioden=${cross.length - 1}`);
  await browser.close();
})();
