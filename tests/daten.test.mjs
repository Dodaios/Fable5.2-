// Unit tests for the Datenblick core (CSV parser, type inference, statistics, findings).
// Run: node tests/daten.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["../src/js/core.js", "../src/js/demos/daten.js"]) {
  vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), sandbox, { filename: f });
}
const D = sandbox.Werkschau.daten;
const plain = (x) => JSON.parse(JSON.stringify(x)); // objects from the vm context have foreign prototypes
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
let count = 0;
const test = (name, fn) => { try { fn(); count++; } catch (e) { console.error("FAILED: " + name); throw e; } };

/* ---------- CSV parser ---------- */
test("comma separator, quoted separators, escaped quotes", () => {
  const t = D.parseCSV('name,ort,zitat\n"Müller, Anna",Köln,"Sie sagte ""Hallo"""\nBen,Bonn,ok\n');
  assert.equal(t.separator, ",");
  assert.deepEqual(plain(t.header), ["name", "ort", "zitat"]);
  assert.deepEqual(plain(t.rows), [["Müller, Anna", "Köln", 'Sie sagte "Hallo"'], ["Ben", "Bonn", "ok"]]);
  assert.equal(t.errors.length, 0);
});
test("embedded newline inside quotes, CRLF line ends", () => {
  const t = D.parseCSV('a,b\r\n"Zeile 1\nZeile 2",2\r\n3,4\r\n');
  assert.deepEqual(plain(t.rows), [["Zeile 1\nZeile 2", "2"], ["3", "4"]]);
});
test("semicolon + decimal comma, thousands dot", () => {
  const t = D.parseCSV("artikel;preis;menge\nA;1,50;1.200\nB;2,25;300\nC;0,75;45\n");
  assert.equal(t.separator, ";");
  assert.equal(t.decimalComma, true);
  const p = D.profile(t);
  assert.equal(p.cols[1].type, "zahl");
  assert.deepEqual(plain(p.cols[1].values), [1.5, 2.25, 0.75]);
  assert.deepEqual(plain(p.cols[2].values), [1200, 300, 45]);
});
test("tab separator, no trailing newline, BOM", () => {
  const t = D.parseCSV("﻿x\ty\n1\t2\n3\t4");
  assert.equal(t.separator, "\t");
  assert.deepEqual(plain(t.header), ["x", "y"]);
  assert.deepEqual(plain(t.rows), [["1", "2"], ["3", "4"]]);
});
test("trailing blank lines are not rows; whitespace is trimmed", () => {
  const t = D.parseCSV("a , b\n 1 , 2 \n\n\n");
  assert.deepEqual(plain(t.header), ["a", "b"]);
  assert.deepEqual(plain(t.rows), [["1", "2"]]);
});
test("ragged rows are padded or cut, with a warning", () => {
  const t = D.parseCSV("a,b,c\n1,2\n3,4,5,6\n7,8,9\n");
  assert.deepEqual(plain(t.rows), [["1", "2", ""], ["3", "4", "5"], ["7", "8", "9"]]);
  assert.equal(t.warnings.length, 1);
  assert.match(t.warnings[0], /^2 Zeilen haben/);
});
test("duplicate and empty header names are made unique", () => {
  const t = D.parseCSV("x,,x\n1,2,3\n");
  assert.deepEqual(plain(t.header), ["x", "Spalte 2", "x (2)"]);
});
test("errors: empty input, header only, unclosed quote", () => {
  assert.match(D.parseCSV("   \n").errors[0], /leer/);
  assert.match(D.parseCSV("a,b\n").errors[0], /keine Datenzeilen/);
  assert.match(D.parseCSV('a,b\n1,"offen\n2,3\n').errors[0], /Anführungszeichen, das in Zeile 2 beginnt/);
});
test("no separator: one column plus a warning", () => {
  const t = D.parseCSV("wert\n1\n2\n3\n");
  assert.equal(t.separator, null);
  assert.deepEqual(plain(t.rows), [["1"], ["2"], ["3"]]);
  assert.match(t.warnings[0], /Kein Trennzeichen/);
});
test("row limit: 5 000 rows are analysed, the rest is reported", () => {
  let csv = "a,b\n";
  for (let i = 0; i < 5200; i++) csv += i + "," + (i % 7) + "\n";
  const t = D.parseCSV(csv);
  assert.equal(t.rows.length, 5000);
  assert.match(t.warnings[0], /5\.200 Datenzeilen/);
});

/* ---------- type inference ---------- */
test("types: Zahl, Kategorie, Datum, Text, missing tokens", () => {
  const rows = ["id,gruppe,tag,notiz,wert"];
  const notes = ["eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn"];
  for (let i = 0; i < 10; i++) rows.push([i + 1, i % 2 ? "a" : "b", `2026-01-${String(i + 1).padStart(2, "0")}`, notes[i], i === 3 ? "NA" : i * 1.5].join(","));
  const p = D.profile(D.parseCSV(rows.join("\n")));
  assert.deepEqual(plain(p.cols.map((c) => c.type)), ["zahl", "kategorie", "datum", "text", "zahl"]);
  assert.equal(p.cols[4].missing, 1);
  assert.equal(p.missing, 1);
  assert.equal(p.cols[2].max - p.cols[2].min, 9);
  assert.deepEqual(plain(p.cols[1].counts), [{ value: "a", count: 5 }, { value: "b", count: 5 }]);
});
test("German dates and invalid dates", () => {
  const p = D.profile(D.parseCSV("d;x\n01.03.2026;1\n02.03.2026;2\n15.03.2026;3\n"));
  assert.equal(p.cols[0].type, "datum");
  assert.equal(p.cols[0].max - p.cols[0].min, 14);
  const q = D.profile(D.parseCSV("d;x\n31.02.2026;1\n02.03.2026;2\n15.03.2026;3\n"));
  assert.notEqual(q.cols[0].type, "datum");
});
test("a mostly numeric column keeps its type; unreadable cells are counted", () => {
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, "kaputt"];
  const p = D.profile(D.parseCSV("v,w\n" + vals.map((v) => v + ",x").join("\n")));
  assert.equal(p.cols[0].type, "zahl");
  assert.equal(p.cols[0].invalid, 1);
  assert.equal(p.cols[0].n, 11);
});

/* ---------- statistics against hand-computed values ---------- */
test("mean, median, quartiles, standard deviation", () => {
  const s = D.describe([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(s.n, 8); assert.equal(s.min, 2); assert.equal(s.max, 9);
  assert.equal(s.mean, 5); assert.equal(s.median, 4.5);
  assert.equal(s.q1, 4); assert.equal(s.q3, 5.5);
  near(s.sd, Math.sqrt(32 / 7));
  const t = D.describe([1, 2, 3, 4]);
  assert.equal(t.median, 2.5); assert.equal(t.q1, 1.75); assert.equal(t.q3, 3.25);
});
test("pearson: perfect line = 1, inverse line = -1, hand-computed 0.8, constant = NaN", () => {
  near(D.pearson([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1);
  near(D.pearson([1, 2, 3, 4, 5], [9, 7, 5, 3, 1]), -1);
  near(D.pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]), 0.8);
  assert.ok(Number.isNaN(D.pearson([1, 2, 3, 4], [5, 5, 5, 5])));
  near(D.pearson([1, 2, NaN, 3, 4, 5], [10, 20, 99, 30, 40, 50]), 1); // incomplete pairs are skipped
});
test("linreg slope and intercept", () => {
  const a = D.linreg([1, 2, 3, 4], [3, 5, 7, 9]);
  near(a.slope, 2); near(a.intercept, 1); assert.equal(a.n, 4);
  const b = D.linreg([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]);
  near(b.slope, 0.8); near(b.intercept, 0.6);
});
test("p-values match textbook critical values", () => {
  near(D.pF(4.9646, 1, 10), 0.05, 2e-4);   // F(1,10) at 5 %
  near(D.pF(3.8853, 2, 12), 0.05, 2e-4);   // F(2,12) at 5 %
  near(D.pCorr(2.2281 / Math.sqrt(10 + 2.2281 ** 2), 12), 0.05, 2e-4); // t(10) = 2.2281, two-sided 5 %
  near(D.pCorr(0, 20), 1, 1e-9);
});
test("outlier rule on a known array (modified z-score > 3.5)", () => {
  // median 14.5, MAD 2.5 -> limits 14.5 ± 3.5 * 2.5 / 0.6745 = [1.53, 27.47]
  assert.deepEqual(plain(D.outliers([10, 11, 12, 13, 14, 15, 16, 17, 18, 100])), [9]);
  assert.deepEqual(plain(D.outliers([10, 11, 12, 13, 14, 15, 16, 17, 18, 27])), []);
  assert.deepEqual(plain(D.outliers([10, 11, 12, 13, 14, 15, 16, 17, 18, 28])), [9]);
  assert.deepEqual(plain(D.outliers([0, 0, 0, 0, 0, 0, 0, 0, 1, 1])), []); // flags are not outliers
  assert.deepEqual(plain(D.outliers([1, 2, 300])), []);                     // too few values to judge
});

/* ---------- the synthetic example ---------- */
test("example is deterministic and labelled as planted", () => {
  const a = D.example(), b = D.example();
  assert.equal(a.csv, b.csv);
  assert.equal(a.csv.trim().split("\n").length, 121);
  assert.deepEqual(plain(a.planted.map((p) => p.row)), [37, 64, 91]);
});
test("example: exactly the three planted outliers are found, five cells are missing", () => {
  const ex = D.example(), t = D.parseCSV(ex.csv), p = D.profile(t);
  assert.equal(t.errors.length, 0); assert.equal(t.warnings.length, 0);
  assert.equal(p.nRows, 120); assert.equal(p.nCols, 6);
  assert.deepEqual(plain(p.cols.map((c) => c.type)), ["datum", "kategorie", "zahl", "kategorie", "zahl", "zahl"]);
  assert.deepEqual(plain(p.outlierRows), [37, 64, 91]);
  assert.deepEqual(plain(p.outlierCells.map((o) => ({ row: o.row, column: o.col }))), plain(ex.planted));
  assert.equal(p.missing, 5);
});
test("example: planted structure is recovered", () => {
  const p = D.profile(D.parseCSV(D.example().csv));
  const [temp, guests, sales] = p.numeric;
  assert.ok(D.pearson(guests.values, sales.values, p.isOut) > 0.85);
  assert.ok(D.pearson(temp.values, guests.values, p.isOut) > 0.4);
  assert.ok(D.pearson(guests.values, sales.values) < D.pearson(guests.values, sales.values, p.isOut) - 0.1); // the outliers blur it
  assert.deepEqual(plain(p.best), [1, 2]);
});
test("findings: 3 to 6 sentences for the example, each one checkable", () => {
  const t = D.parseCSV(D.example().csv), f = D.findings(t);
  assert.ok(f.length >= 3 && f.length <= 6);
  for (const x of f) { assert.equal(typeof x.text, "string"); assert.match(x.text, /[.!]$/); }
  const kinds = plain(f.map((x) => x.kind));
  for (const k of ["zusammenhang", "gruppen", "ausreisser", "zeit"]) assert.ok(kinds.includes(k), "missing finding: " + k);
  const out = f.find((x) => x.kind === "ausreisser").text;
  assert.match(out, /^3 Ausreißer/);
  assert.match(out, /Zeile 37: temperatur_c = 47,5/);
  assert.match(out, /Zeile 64: besucher = 298/);
  assert.match(out, /Zeile 91: umsatz_eur = /);
  assert.match(f[0].text, /besucher .* umsatz_eur/);
  assert.match(f[0].text, /r = 0,94, n = 115, ohne die 3 Ausreißer-Zeilen\)\. Mit ihnen wäre r = 0,58\.$/); // the demo's "Moral" quotes these numbers
});
test("findings stay quiet on noise and on tiny tables", () => {
  let s = 7, rnd = () => (s = (s * 16807) % 2147483647) / 2147483647, csv = "a,b,c,g\n";
  for (let i = 0; i < 60; i++) csv += [rnd(), rnd(), rnd(), "xyz"[i % 3]].map((v) => (typeof v === "number" ? v.toFixed(4) : v)).join(",") + "\n";
  const kinds = plain(D.findings(D.parseCSV(csv)).map((x) => x.text));
  assert.ok(kinds.some((x) => /keinen belastbaren linearen Zusammenhang/.test(x)));
  assert.ok(!kinds.some((x) => /^Gruppenunterschied/.test(x)));
  const tiny = D.findings(D.parseCSV("x,y\n1,2\n2,4\n3,6\n"));
  assert.match(tiny[0].text, /^Nur 3 Zeilen/);
});

console.log(`ok (${count} tests)`);
