/* Szenarien: Geometrie, Randbedingungen und Anfangsfelder.
 * Längen in Zellen (ny = Zellen über die Gebietshöhe), Geschwindigkeiten in Einheiten von U0. */
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
      id: 'becken',
      name: 'Freies Becken',
      desc: 'Ein ruhendes, geschlossenes Becken. Ziehe mit Maus oder Finger durch die Flüssigkeit und beobachte, wie Wirbel entstehen, wandern und durch Reibung zerfallen.',
      kind: 'stir', aspect: 2,
      bc: [BC.NOSLIP, BC.NOSLIP, BC.NOSLIP, BC.NOSLIP],
      refLen: 1, refName: 'Beckenhöhe H',
      defaults: { fluid: 'wasser', L: 0.1, view: 0, tool: 'stir', particles: true, speed: 'realtime' },
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
      name: 'Kármánsche Wirbelstraße',
      desc: 'Gleichmäßige Anströmung eines Zylinders. Ab Re ≈ 47 lösen sich abwechselnd Wirbel ab; die Ablösefrequenz f folgt der Strouhal-Zahl St = f·D/U ≈ 0,2.',
      kind: 'driven', aspect: 3,
      bc: [BC.INFLOW, BC.OUTFLOW, BC.SLIP, BC.SLIP],
      inflow: [0, 1, 0.5, 0.1], uc: 1, ubound: 2.2,
      refLen: 1 / 8, refName: 'Zylinderdurchmesser D',
      body: { D: 1 / 8 },
      inDye: [10, 0.5, 0, 0], inColA: COL.cyan, inColB: COL.orange,
      defaults: { fluid: 'wasser', L: 0.08, U: 0.015, view: 0, tool: 'stir', particles: false, speed: 'auto' },
      setup(sol, nx, ny) {
        sol.initVelocity({ mode: 1 });
        sol.initScalars({ dyeMode: 6 });
        sol.initMask([{ type: 'circle', x: 0.75 * ny, y: 0.5 * ny + 0.31, a: ny / 16 }]);
      },
    },
    {
      id: 'fluegel',
      name: 'Angestellte Platte (Tragflügel)',
      desc: 'Eine schlanke Ellipse mit Anstellwinkel. Die Umströmung erzeugt Auftrieb (c_A) und Widerstand (c_W); bei großem Winkel reißt die Strömung ab.',
      kind: 'driven', aspect: 3,
      bc: [BC.INFLOW, BC.OUTFLOW, BC.SLIP, BC.SLIP],
      inflow: [0, 1, 0.5, 0.1], uc: 1, ubound: 2.2,
      refLen: 0.3, refName: 'Profiltiefe c',
      body: { D: 0.3 },
      inDye: [14, 0.5, 0, 0], inColA: COL.cyan, inColB: COL.magenta,
      defaults: { fluid: 'luft', L: 0.2, U: 0.25, view: 0, tool: 'stir', particles: false, speed: 'auto' },
      setup(sol, nx, ny) {
        sol.initVelocity({ mode: 1 });
        sol.initScalars({ dyeMode: 6 });
        sol.initMask([{ type: 'ellipse', x: 0.8 * ny, y: 0.5 * ny, a: 0.15 * ny, b: 0.017 * ny, angle: -0.26 }]);
      },
    },
    {
      id: 'kavitaet',
      name: 'Deckelgetriebene Kavität',
      desc: 'Der Deckel eines quadratischen Kastens gleitet nach rechts und schleppt die Flüssigkeit mit. Klassischer Prüfstein für Strömungslöser (Ghia et al. 1982).',
      kind: 'driven', aspect: 1,
      bc: [BC.NOSLIP, BC.NOSLIP, BC.NOSLIP, BC.NOSLIP],
      wallU: [0, 1], ubound: 1.3,
      refLen: 1, refName: 'Kantenlänge L',
      defaults: { fluid: 'wasser', L: 0.05, U: 0.02, view: 0, tool: 'stir', particles: true, speed: 'auto' },
      setup(sol, nx, ny) {
        sol.initVelocity({ mode: 0 });
        sol.initScalars({ dyeMode: 5, dyeP: [6, 0, 0, 0], colA: COL.blue, colB: [0.9, 0.5, 0.1] });
        sol.initMask([]);
      },
    },
    {
      id: 'kh',
      name: 'Kelvin-Helmholtz-Instabilität',
      desc: 'Zwei Schichten strömen gegeneinander. Die Scherschicht ist instabil und rollt sich zu Wirbeln auf – wie bei Wolkenwalzen oder Wellen im Wind.',
      kind: 'driven', aspect: 2,
      bc: [BC.PERIODIC, BC.PERIODIC, BC.SLIP, BC.SLIP],
      ubound: 1.2,
      refLen: 1, refName: 'Gebietshöhe H',
      defaults: { fluid: 'wasser', L: 0.1, U: 0.1, view: 0, tool: 'stir', particles: false, speed: 'auto' },
      setup(sol, nx, ny) {
        sol.initVelocity({ mode: 3, p0: [0.5, 1 / 50, 0.5, 0.02], p1: [5, 0.06, 0, 0] });
        sol.initScalars({ dyeMode: 1, dyeP: [0.5, 0, 0, 0], colA: COL.cyan, colB: COL.magenta });
        sol.initMask([]);
      },
    },
    {
      id: 'strahl',
      name: 'Freistrahl',
      desc: 'Aus einer Düse links tritt ein Strahl in ruhende Flüssigkeit. Sein Kopf rollt sich zu einem Wirbelpaar auf; bei höherer Reynolds-Zahl wird der Strahl instabil.',
      kind: 'driven', aspect: 2,
      bc: [BC.INFLOW, BC.OUTFLOW, BC.NOSLIP, BC.NOSLIP],
      inflow: [2, 1, 0.5, 0.045], uc: 0.25, ubound: 1.5,
      refLen: 0.09, refName: 'Düsenbreite d',
      inDye: [0, 0.5, 0, 1], inColA: COL.gold, inColB: COL.gold,
      defaults: { fluid: 'wasser', L: 0.1, U: 0.05, view: 0, tool: 'stir', particles: true, speed: 'auto' },
      setup(sol, nx, ny) {
        const k = 2 * Math.PI / ny;
        sol.initVelocity({ mode: 0, noise: [[3 * k, 2 * k, 0.02, 1.1], [5 * k, 3 * k, 0.012, 2.3], [2 * k, 5 * k, 0.012, 4.2]] });
        sol.initScalars({});
        sol.initMask([]);
      },
    },
    {
      id: 'benard',
      name: 'Rayleigh-Bénard-Konvektion',
      desc: 'Unten geheizt, oben gekühlt: Oberhalb der kritischen Rayleigh-Zahl Ra ≈ 1708 setzt Konvektion ein – warme Flüssigkeit steigt in Fahnen auf, kalte sinkt ab (Boussinesq-Näherung).',
      kind: 'thermal', aspect: 2,
      bc: [BC.PERIODIC, BC.PERIODIC, BC.NOSLIP, BC.NOSLIP],
      tempBC: [1, 0.5, 1, -0.5], ubound: 0.6,
      refLen: 1, refName: 'Schichthöhe H',
      defaults: { fluid: 'wasser', L: 0.02, dT: 2, view: 4, tool: 'stir', particles: true, speed: 'auto' },
      setup(sol, nx, ny) {
        sol.initVelocity({ mode: 0 });
        sol.initScalars({ tMode: 1, tP: [0.5, -0.5, 0.06, 0.5] });
        sol.initMask([]);
      },
    },
    {
      id: 'tg',
      name: 'Taylor-Green-Wirbel (Validierung)',
      desc: 'Für dieses Wirbelgitter kennt man die exakte Lösung der Navier-Stokes-Gleichungen: Die Energie klingt mit exp(−4νk²t) ab. Die Messwerte zeigen die Abweichung der Simulation.',
      kind: 'driven', aspect: 1,
      bc: [BC.PERIODIC, BC.PERIODIC, BC.PERIODIC, BC.PERIODIC],
      ubound: 2.0,
      refLen: 1, refName: 'Kantenlänge L',
      analytic: { type: 'tg', m: 2 },
      defaults: { fluid: 'olivenoel', L: 0.1, U: 0.1, view: 1, tool: 'stir', particles: true, speed: 'auto', scheme: 'central' },
      setup(sol, nx, ny) {
        sol.initVelocity({ mode: 2, p0: [1, 2, 2, 0] });
        sol.initScalars({ dyeMode: 5, dyeP: [8, 0, 0, 0], colA: COL.cyan, colB: COL.magenta });
        sol.initMask([]);
      },
    },
  ];
  NS.scenarioById = (id) => NS.scenarios.find((s) => s.id === id);
})();
