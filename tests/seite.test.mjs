// Checks the page's own logic: prices, the Kompass rule, the benchmark data, the logic puzzle.
// Run: node tests/seite.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const sandbox = {};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["../src/js/core.js", "../src/js/data.js"]) vm.runInContext(readFileSync(here(f), "utf8"), sandbox, { filename: f });
const W = sandbox.Werkschau;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

// --- prices (US dollars per million tokens, Claude API list prices) ---
near(W.kosten("fable", 1, 1e6, 0, 0), 8, "Fable Eingabe");
near(W.kosten("fable", 1, 0, 1e6, 0), 40, "Fable Ausgabe");
near(W.kosten("opus", 1, 1e6, 1e6, 0), 24, "Opus Eingabe + Ausgabe");
near(W.kosten("sonnet", 1, 1e6, 1e6, 0), 12, "Sonnet Eingabe + Ausgabe");
near(W.kosten("haiku", 10, 1e5, 1e5, 0), 0.6, "Haiku bis 100.000 Tokens je Anfrage");
near(W.kosten("haiku", 1, 2e5, 0, 0), 0.1, "Haiku über 100.000 Tokens: $0,50 je Mio.");
near(W.kosten("fable", 1, 1e6, 0, 1), 0.2, "Fable Cache-Lesen");
near(W.kosten("opus", 1, 1e6, 0, 1), 0.2, "Opus Cache-Lesen");
near(W.kosten("sonnet", 1, 1e6, 0, 1), 0.1, "Sonnet Cache-Lesen");
// the "Agenten-Session" preset: 60 steps, 120.000 input tokens (90 % cached), 1.500 output tokens
near(W.kosten("fable", 60, 120000, 1500, 0.9), 10.656, "Agenten-Session Fable");
near(W.kosten("opus", 60, 120000, 1500, 0.9), 5.976, "Agenten-Session Opus");
// the "10.000 Tickets" preset
near(W.kosten("fable", 10000, 800, 60, 0), 88, "Tickets Fable");
near(W.kosten("haiku", 10000, 800, 60, 0), 1.1, "Tickets Haiku");
// Fable costs exactly twice Opus when nothing is cached
near(W.kosten("fable", 7, 12345, 678, 0) / W.kosten("opus", 7, 12345, 678, 0), 2, "Fable = 2 × Opus");
assert.equal(W.dollar(10.656), "$10,66");
assert.equal(W.dollar(0.004), "< $0,01");
assert.equal(W.dollar(1234.5), "$1.235");

// --- Kompass ---
const k = (aufgabe, fehler, tempo, preis) => W.kompass.empfehle({ aufgabe, fehler, tempo, preis });
assert.equal(k("ernst", "mittel", "minuten", "normal").model, "opus", "Standardfall ist Opus");
assert.equal(k("ernst", "mittel", "minuten", "normal").effort, "medium");
assert.equal(k("offen", "teuer", "spaeter", "egal").model, "fable");
assert.equal(k("offen", "teuer", "spaeter", "egal").effort, "high");
assert.equal(k("offen", "mittel", "minuten", "normal").model, "fable");
assert.equal(k("ernst", "teuer", "minuten", "normal").model, "opus", "teure Fehler allein heben erst die Denkstufe");
assert.equal(k("ernst", "teuer", "minuten", "normal").effort, "high");
assert.equal(k("ernst", "teuer", "spaeter", "egal").model, "fable");
assert.equal(k("offen", "gering", "sekunden", "normal").model, "opus");
assert.equal(k("offen", "gering", "sekunden", "normal").konflikt, true);
assert.match(k("offen", "gering", "sekunden", "normal").tipp, /Fast Mode/);
assert.equal(k("alltag", "mittel", "minuten", "normal").model, "sonnet");
assert.equal(k("alltag", "mittel", "sekunden", "normal").model, "sonnet");
assert.equal(k("alltag", "gering", "sekunden", "sehr").model, "haiku");
assert.equal(k("alltag", "teuer", "spaeter", "egal").model, "opus");
assert.equal(k("masse", "mittel", "minuten", "normal").model, "haiku");
assert.equal(k("masse", "mittel", "minuten", "sehr").model, "haiku");
assert.match(k("masse", "mittel", "minuten", "sehr").tipp, /Batch/);
assert.equal(k("masse", "teuer", "spaeter", "egal").model, "sonnet");
assert.equal(k("ernst", "gering", "sekunden", "sehr").model, "sonnet");
// every one of the 4·3·3·3 = 108 combinations yields a known model, an effort level and at least one reason
let combos = 0;
const [qa, qf, qt, qp] = W.kompass.fragen.map((q) => q.optionen.map((o) => o.v));
for (const a of qa) for (const f of qf) for (const t of qt) for (const p of qp) {
  const r = k(a, f, t, p);
  assert.ok(W.models[r.model], `Modell für ${a}/${f}/${t}/${p}`);
  assert.ok(["low", "medium", "high"].includes(r.effort));
  assert.ok(r.gruende.length >= 1 && r.gruende.length <= 3);
  combos++;
}
assert.equal(combos, 108);
// a bigger task never yields a smaller model, all else equal
for (const f of qf) for (const t of qt) for (const p of qp) {
  const idx = qa.map((a) => W.modelOrder.indexOf(k(a, f, t, p).model));
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] >= idx[i - 1], `monoton für ${f}/${t}/${p}`);
}

// --- benchmark data ---
assert.equal(W.benchmarks.length, 11);
for (const b of W.benchmarks) for (const key of ["f", "o", "p"]) assert.ok(b[key] > 0 && b[key] < 100, `${b.name}.${key}`);
assert.equal(W.benchmarks.filter((b) => b.f > b.o).length, 11, "Fable 5.2 liegt in allen elf Prozent-Tests vor Opus 5.5");
const rli = W.benchmarks.find((b) => b.name === "Remote Labor Index");
assert.deepEqual([rli.f, rli.o, rli.p], [41.3, 21.3, 17.9]);

// --- the logic puzzle in the Selbsttest has exactly the one solution the page states ---
const people = ["Ada", "Bea", "Cleo", "Dana"], langs = ["Go", "Rust", "Python", "Kotlin"];
const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
const solutions = [];
let tried = 0;
for (const L of perms(langs)) for (const D of perms([1, 2, 3, 4])) {
  tried++;
  const lang = Object.fromEntries(people.map((p, i) => [p, L[i]])), day = Object.fromEntries(people.map((p, i) => [p, D[i]]));
  const who = (l) => people.find((p) => lang[p] === l);
  if (day[who("Rust")] === day.Ada + 1 && day.Bea !== 1 && lang.Bea !== "Python" && day[who("Kotlin")] === 4 &&
      day.Cleo < day.Dana && lang.Dana !== "Rust" && lang.Dana !== "Kotlin" && day[who("Python")] < day[who("Go")]) {
    solutions.push({ lang, day });
  }
}
assert.equal(tried, 576);
assert.equal(solutions.length, 1, "genau eine Lösung");
assert.deepEqual({ ...solutions[0].lang }, { Ada: "Python", Bea: "Kotlin", Cleo: "Rust", Dana: "Go" });
assert.deepEqual({ ...solutions[0].day }, { Ada: 1, Bea: 4, Cleo: 2, Dana: 3 });
const logik = W.aufgaben.find((t) => t.id === "logik");
assert.match(logik.achte, /Ada Montag Python, Cleo Dienstag Rust, Dana Mittwoch Go, Bea Donnerstag Kotlin/);

console.log("ok");
