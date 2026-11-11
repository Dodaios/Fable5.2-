/* Stoffdaten newtonscher Fluide (Richtwerte bei 20 °C und 1 bar, sofern nicht anders angegeben).
 *   rho  Dichte [kg/m³]
 *   mu   dynamische Viskosität [Pa·s]
 *   beta thermischer Ausdehnungskoeffizient [1/K]
 *   kappa Temperaturleitfähigkeit [m²/s]
 * Quellen: VDI-Wärmeatlas, CRC Handbook of Chemistry and Physics; zähe Naturstoffe
 * (Honig, Öle) schwanken je nach Sorte und Temperatur stark – Werte sind typische Mittel. */
(function () {
  'use strict';
  const NS = (window.NSLab = window.NSLab || {});
  NS.fluids = [
    { id: 'wasser', name: 'Wasser', rho: 998.2, mu: 1.002e-3, beta: 2.07e-4, kappa: 1.43e-7 },
    { id: 'wasser80', name: 'Wasser (80 °C)', rho: 971.8, mu: 3.55e-4, beta: 6.4e-4, kappa: 1.64e-7 },
    { id: 'luft', name: 'Luft', rho: 1.204, mu: 1.82e-5, beta: 3.41e-3, kappa: 2.12e-5 },
    { id: 'honig', name: 'Honig', rho: 1420, mu: 10, beta: 4.5e-4, kappa: 1.5e-7 },
    { id: 'glycerin', name: 'Glycerin', rho: 1261, mu: 1.41, beta: 4.9e-4, kappa: 9.3e-8 },
    { id: 'olivenoel', name: 'Olivenöl', rho: 914, mu: 0.084, beta: 7.2e-4, kappa: 9.5e-8 },
    { id: 'motoroel', name: 'Motoröl (SAE 30)', rho: 885, mu: 0.25, beta: 7.0e-4, kappa: 8.6e-8 },
    { id: 'ethanol', name: 'Ethanol', rho: 789, mu: 1.19e-3, beta: 1.09e-3, kappa: 8.7e-8 },
    { id: 'quecksilber', name: 'Quecksilber', rho: 13546, mu: 1.55e-3, beta: 1.81e-4, kappa: 4.4e-6 },
    { id: 'blut', name: 'Blut (37 °C, vereinfacht)', rho: 1060, mu: 3.5e-3, beta: 3.6e-4, kappa: 1.4e-7 },
    { id: 'helium', name: 'Helium (Gas)', rho: 0.166, mu: 1.96e-5, beta: 3.41e-3, kappa: 1.7e-4 },
  ];
  NS.fluidById = (id) => NS.fluids.find((f) => f.id === id);
})();
