// Tests für die Sprache „Fabel" (src/js/demos/sprache.js). Aufruf: node tests/sprache.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = { console };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["../src/js/core.js", "../src/js/demos/sprache.js"]) {
  vm.runInContext(readFileSync(path.join(here, f), "utf8"), ctx, { filename: f });
}
const S = ctx.Werkschau.sprache;
let checks = 0;

/** Programm ausführen und die Ausgabe als einen Text zurückgeben (Fehler lassen den Test scheitern). */
function out(src) {
  const r = S.run(src);
  assert.equal(r.error, null, r.error ? r.error.message : "");
  return r.output.join("\n");
}
function eq(src, expected, label) {
  assert.equal(out(src), expected, label || src);
  checks++;
}
/** Erwartet einen Fehler an Zeile/Spalte, dessen Meldung zum Muster passt. */
function err(src, line, col, pattern, opt) {
  const r = S.run(src, opt);
  assert.ok(r.error, "Fehler erwartet: " + src);
  assert.match(r.error.message, pattern, src);
  assert.equal(r.error.line, line, "Zeile: " + r.error.message);
  assert.equal(r.error.col, col, "Spalte: " + r.error.message);
  assert.ok(r.error.message.startsWith(`Zeile ${line}, Spalte ${col}: `), r.error.message);
  checks++;
  return r;
}

// ---------- 1. Die Beispielprogramme der Demo ----------
const fizz = [];
for (let i = 1; i <= 20; i++) fizz.push(i % 15 === 0 ? "FizzBuzz" : i % 3 === 0 ? "Fizz" : i % 5 === 0 ? "Buzz" : String(i));

// Unabhängige Nachrechnung der Mandelbrot-Ausgabe in JavaScript.
const mandel = [];
for (let zeile = 0; zeile < 21; zeile++) {
  const ci = (zeile - 10) / 10;
  let s = "";
  for (let spalte = 0; spalte < 60; spalte++) {
    const cr = (spalte - 42) / 20;
    let x = 0, y = 0, n = 0;
    while (n < 18 && x * x + y * y <= 4) { const neu = x * x - y * y + cr; y = 2 * x * y + ci; x = neu; n++; }
    s += " .:-=+*#%@"[Math.floor(n / 2)];
  }
  mandel.push(s);
}

const expected = {
  "Fibonacci rekursiv": [
    "fib(1) = 1", "fib(2) = 1", "fib(3) = 2", "fib(4) = 3", "fib(5) = 5", "fib(6) = 8",
    "fib(7) = 13", "fib(8) = 21", "fib(9) = 34", "fib(10) = 55", "fib(20) = 6765"],
  "FizzBuzz": fizz,
  "Primzahlsieb": ["[2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47]", "15 Primzahlen unter 50"],
  "Türme von Hanoi": [
    "Scheibe 1 von A nach C", "Scheibe 2 von A nach B", "Scheibe 1 von C nach B", "Scheibe 3 von A nach C",
    "Scheibe 1 von B nach A", "Scheibe 2 von B nach C", "Scheibe 1 von A nach C",
    "3 Scheiben: 7 Züge", "10 Scheiben: " + (2 ** 10 - 1) + " Züge"],
  "Zähler mit Closures": ["1 2 3", "110 120", "a merkt sich: 4", "[1, 4, 9, 16]"],
  "Mandelbrot als Text": mandel,
  "Bubblesort": ["vorher: [34, 7, 23, 32, 5, 62, 14, 2]", "nachher: [2, 5, 7, 14, 23, 32, 34, 62]", "Durchläufe: 8"],
};
assert.equal(S.examples.length, Object.keys(expected).length);
for (const b of S.examples) {
  assert.ok(expected[b.name], "unerwartetes Beispiel: " + b.name);
  const r = S.run(b.code);
  assert.equal(r.error, null, b.name + ": " + (r.error && r.error.message));
  assert.equal(r.output.join("\n"), expected[b.name].join("\n"), b.name);
  assert.ok(r.steps > 0 && r.steps < 2000000, b.name + " bleibt im Schrittlimit");
  checks++;
}
// Die Mandelbrot-Ausgabe ist spiegelsymmetrisch zur mittleren Zeile.
for (let i = 0; i < 10; i++) assert.equal(mandel[i], mandel[20 - i]);
assert.ok(mandel[10].includes("@@@@@@@@"));
checks++;

// ---------- 2. Ausdrücke und Vorrang ----------
eq("zeige(1 + 2 * 3, (1 + 2) * 3, 10 % 4, 7 / 2, -2 * 3, 2 - -3)", "7 9 2 3.5 -6 5");
eq("zeige(0.1 + 0.2, 1 / 3, 2 * 0.5)", "0.3 0.333333333333 1");
eq("zeige(1 < 2, 2 <= 2, 3 > 4, \"a\" < \"b\", 1 == 1, 1 != 1)", "wahr wahr falsch wahr wahr falsch");
eq("zeige(nicht wahr == falsch, nicht falsch und wahr, falsch oder nicht falsch)", "wahr wahr wahr");
eq("zeige(1 + 2 == 3 und 2 * 2 == 4 oder falsch)", "wahr");
eq("zeige([1, [2, 3]] == [1, [2, 3]], [1] == [2], nichts == nichts, \"1\" == 1)", "wahr falsch wahr falsch");
eq("zeige(\"a\" + 1, 2 + \"b\", \"x\" + wahr, \"l\" + [1, \"z\"], \"n\" + nichts)", "a1 2b xwahr l[1, \"z\"] nnichts");
eq("zeige(\"Zeile1\\nZeile2\", \"Tab\\tEnde\", \"Anf\\\"ührung\", \"\\\\\")", "Zeile1\nZeile2 Tab\tEnde Anf\"ührung \\");
eq("zeige(länge(\"hallo\"), länge([1, 2, 3]), text(42) + \"!\", zahl(\"3.5\") * 2, wurzel(81), abrunden(7.9), abrunden(-0.5))", "5 3 42! 7 9 7 -1");
eq("zeige(bereich(4), bereich(2, 5), bereich(3, 3), länge(bereich(1000)))", "[0, 1, 2, 3] [2, 3, 4] [] 1000");

// ---------- 3. Variablen, Blöcke, Gültigkeitsbereiche ----------
eq("sei x = 1\n{ sei x = 2\n zeige(x) }\nzeige(x)", "2\n1", "innere Variable verdeckt die äußere");
eq("sei x = 1\n{ x = 5 }\nzeige(x)", "5", "Zuweisung trifft die äußere Variable");
eq("sei summe = 0; für i in bereich(5) { summe = summe + i }; zeige(summe)", "10", "Semikolon trennt Anweisungen");
err("{ sei innen = 1 }\nzeige(innen)", 2, 7, /Die Variable `innen` kenne ich nicht/);
err("sei a = 1\nsei a = 2", 2, 5, /gibt es in diesem Block schon/);
err("sei zähler = 1\nzeige(zaehler)", 2, 7, /Meintest du `zähler`\?/);
err("x = 3", 1, 1, /Die Variable `x` kenne ich nicht/);

// ---------- 4. Kontrollfluss ----------
eq("sei i = 0\nsolange wahr {\n  i = i + 1\n  wenn i == 3 { weiter }\n  wenn i > 5 { abbrechen }\n  zeige(i)\n}", "1\n2\n4\n5", "abbrechen und weiter");
eq("für b in \"abc\" { zeige(b) }", "a\nb\nc", "für über einen Text");
eq("sei x = 7\nwenn x > 10 { zeige(\"groß\") }\nsonst wenn x > 5 { zeige(\"mittel\") }\nsonst { zeige(\"klein\") }", "mittel", "sonst in der nächsten Zeile");
eq("für i in bereich(3) {\n  für j in bereich(3) {\n    wenn j == 1 { weiter }\n    wenn i == 2 { abbrechen }\n    zeige(i, j)\n  }\n}", "0 0\n0 2\n1 0\n1 2", "verschachtelte Schleifen");
eq("funktion laut() { zeige(\"ausgewertet\")\n gib wahr }\nzeige(falsch und laut())\nzeige(wahr oder laut())\nzeige(wahr und laut())", "falsch\nwahr\nausgewertet\nwahr", "Kurzschluss");

// ---------- 5. Funktionen, Closures, Rekursion ----------
eq("funktion addierer(n) { gib funktion(x) { gib x + n } }\nsei plus2 = addierer(2)\nsei plus10 = addierer(10)\nzeige(plus2(1), plus10(1), addierer(5)(5))", "3 11 10", "Closures");
eq("funktion z() { sei n = 0\n gib funktion() { n = n + 1\n gib n } }\nsei a = z()\nsei b = z()\na()\na()\nzeige(a(), b())", "3 1", "jede Closure hat eigenen Zustand");
eq("funktion fak(n) { wenn n <= 1 { gib 1 }\n gib n * fak(n - 1) }\nzeige(fak(10))", "3628800");
eq("funktion gerade(n) { wenn n == 0 { gib wahr }\n gib ungerade(n - 1) }\nfunktion ungerade(n) { wenn n == 0 { gib falsch }\n gib gerade(n - 1) }\nzeige(gerade(10), ungerade(7))", "wahr wahr", "wechselseitige Rekursion");
eq("funktion ohne() { }\nfunktion leer() { gib }\nzeige(ohne(), leer())", "nichts nichts", "gib ohne Wert");
eq("funktion suche(liste, ziel) {\n  für i in bereich(länge(liste)) {\n    wenn liste[i] == ziel { gib i }\n  }\n  gib -1\n}\nzeige(suche([4, 8, 15], 15), suche([4, 8, 15], 16))", "2 -1", "gib verlässt Schleifen");
eq("funktion summe(n) { wenn n == 0 { gib 0 }\n gib n + summe(n - 1) }\nzeige(summe(400))", "80200", "Rekursionstiefe 400");

// ---------- 6. Listen ----------
eq("sei l = [1, 2, 3]\nl[0] = 10\nanhängen(l, 4)\nl[3] = l[3] * 2\nzeige(l, länge(l), l[1 + 1])", "[10, 2, 3, 8] 4 3", "Listen ändern");
eq("sei a = [1]\nsei b = a\nanhängen(b, 2)\nzeige(a)", "[1, 2]", "Listen sind Verweise");
eq("sei m = [\n  [1, 2],\n  [3, 4],\n]\nzeige(m[1][0], länge(m))\nzeige(1 +\n  2)", "3 2\n3", "Zeilenumbrüche in Klammern und nach Operatoren");
eq("sei größe = 3 # Kommentar\n# ganze Zeile\nsei straße_2 = größe * 2\nzeige(straße_2)", "6", "Umlaute, ß und Kommentare");

// ---------- 7. Fehlermeldungen mit Zeile und Spalte ----------
err("zeige(1 / 0)", 1, 9, /Division durch null/);
err("sei x = 5\nzeige(10 % (x - 5))", 2, 10, /Division durch null/);
err("sei l = [1, 2, 3]\nzeige(l[3])", 2, 8, /Index 3 liegt außerhalb \(Länge 3, gültig sind 0 bis 2\)/);
err("sei l = []\nl[0] = 1", 2, 2, /Index 0 liegt außerhalb \(Länge 0\)/);
err("sei x = 5\nx(1)", 2, 1, /`x` ist keine Funktion, sondern eine Zahl/);
err("funktion f(a, b) { gib a + b }\nf(1)", 2, 1, /`f` erwartet 2 Argumente, hat aber 1 bekommen/);
err("zeige(länge(1, 2))", 1, 7, /`länge` erwartet 1 Argument, hat aber 2 bekommen/);
err("zeige(1 + wahr)", 1, 9, /`\+` kann eine Zahl und einen Wahrheitswert nicht verbinden/);
err("wenn 1 { zeige(1) }", 1, 6, /Hier brauche ich wahr oder falsch/);
err("zeige(1 < \"a\")", 1, 9, /vergleicht zwei Zahlen oder zwei Texte/);
err("wenn wahr { zeige(1) sonst", 1, 22, /Ich habe `}` oder ein Zeilenende erwartet, aber `sonst` gefunden/);
err("zeige(1", 1, 8, /Ich habe `\)` erwartet, aber das Ende des Programms gefunden/);
err("sei = 5", 1, 5, /Ich habe einen Variablennamen erwartet, aber `=` gefunden/);
err("sei wenn = 5", 1, 5, /`wenn` ist ein Schlüsselwort/);
err("sei x = \"offen\nzeige(x)", 1, 9, /wird nicht mit `"` abgeschlossen/);
err("sei x = 5 $ 3", 1, 11, /Das Zeichen `\$` kenne ich nicht/);
err("zeige(1 ! 2)", 1, 9, /Meintest du `!=` oder `nicht`\?/);
err("gib 5", 1, 1, /`gib` gibt es nur innerhalb einer Funktion/);
err("wenn wahr { abbrechen }", 1, 13, /`abbrechen` gibt es nur innerhalb einer Schleife/);
err("solange wahr { funktion f() { weiter } }", 1, 31, /`weiter` gibt es nur innerhalb einer Schleife/);
err("zeige(1)\n}", 2, 1, /Diese `}` schließt keinen Block/);
err("wenn wahr {\n  zeige(1)\n", 3, 1, /Der Block aus Zeile 1 wird nicht mit `}` geschlossen/);
err("1 + 2 = 3", 1, 7, /Links von `=` muss eine Variable oder ein Listenelement stehen/);
err("sei x = ", 1, 9, /Ich habe einen Wert erwartet, aber das Ende des Programms gefunden/);
err("zeige(wurzel(-4))", 1, 7, /Wurzel aus einer negativen Zahl/);
err("zeige(zahl(\"elf\"))", 1, 7, /lässt sich nicht in eine Zahl umwandeln/);

// ---------- 8. Grenzen: Schritte, Rekursion, Größe ----------
{
  // Wo genau das Limit greift, hängt vom Programm ab – sicher ist: in der Schleifenzeile.
  const r = S.run("sei n = 0\nsolange wahr { n = n + 1 }", { maxSteps: 10000 });
  assert.match(r.error.message, /^Zeile 2, Spalte \d+: Abgebrochen nach 10 000 Schritten – Endlosschleife\?$/);
  assert.equal(r.error.line, 2);
  assert.equal(r.steps, 10000);
  assert.equal(r.output.length, 0);
  const voll = S.run("solange wahr { }");
  assert.match(voll.error.message, /Abgebrochen nach 2 000 000 Schritten – Endlosschleife\?/);
  assert.equal(voll.steps, 2000000);
  checks++;
}
err("funktion endlos(n) { gib endlos(n + 1) }\nendlos(0)", 1, 26, /Zu tiefe Rekursion/);
{
  // Sehr tief verschachtelte Rümpfe füllen den JS-Stapel vor dem Zähler: auch das endet als Fabel-Fehler.
  const r = S.run("funktion t(n) { wenn wahr { für q in [1] { solange wahr { wenn wahr { gib 1 + (0 + (0 + (0 + t(n + 1)))) } } } } }\nt(0)");
  assert.match(r.error.message, /Zu tiefe Rekursion/);
  checks++;
}
err("sei s = \"ab\"\nsolange wahr { s = s + s }", 2, 22, /Der Text ist zu lang geworden/);
err("solange wahr { zeige(\"x\") }", 1, 16, /zu viel Ausgabe/);

// ---------- 9. Schnittstelle ----------
{
  const zeilen = [];
  const r = S.run("zeige(\"a\")\nzeige(\"b\", 2)", { onPrint: (z) => zeilen.push(z) });
  assert.equal(zeilen.join("|"), "a|b 2");
  assert.equal(r.error, null);
  assert.equal(typeof r.ms, "number");
  assert.ok(r.steps > 0);
  checks++;

  const tokens = S.tokenize("sei x = 10\nzeige(x)");
  assert.equal(tokens.map((t) => t.art).join(" "), "Schlüsselwort Name Operator Zahl Zeilenende Name Zeichen Name Zeichen Ende");
  assert.equal(tokens[3].wert, 10);
  assert.deepEqual([tokens[5].zeile, tokens[5].spalte, tokens[5].pos, tokens[5].ende], [2, 1, 11, 16]);
  checks++;

  const baum = S.parse("sei x = 1 + 2 * 3");
  assert.equal(baum.typ, "Programm");
  assert.equal(baum.koerper[0].typ, "Sei");
  assert.equal(baum.koerper[0].wert.op, "+");
  assert.equal(baum.koerper[0].wert.rechts.op, "*");
  assert.throws(() => S.parse("sei"), (e) => e.line === 1 && e.col === 4 && /Variablennamen/.test(e.message));
  checks++;

  // run() wirft nie – auch nicht bei Unsinn.
  for (const murks of ["", "   \n\n", "}{", "((((", "\"", "sei", "funktion", "für x in", "wenn", "[1,,2]", "a.b", "@", "1 2 3", "\\", "sonst", "nicht", null, undefined, 42]) {
    const res = S.run(murks);
    assert.ok(Array.isArray(res.output) || res.output.length >= 0);
    if (res.error) { assert.ok(res.error.line >= 1 && res.error.col >= 1, String(murks)); assert.equal(typeof res.error.message, "string"); }
  }
  assert.equal(S.run("").error, null);
  checks++;
}

console.log("ok – " + checks + " Prüfungen bestanden");
