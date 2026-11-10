/* Fabel – eine kleine Programmiersprache mit deutschen Schlüsselwörtern.
   Lexer → Pratt-Parser → Syntaxbaum → Auswertung mit Closures. Keine Abhängigkeiten. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var W = root.Werkschau;

  var MAX_SCHRITTE = 2000000, MAX_TIEFE = 500, MAX_LAENGE = 1000000, MAX_ZEILEN = 10000;
  var IST_SCHLUESSEL = Object.create(null);
  ["sei", "wenn", "sonst", "solange", "für", "in", "funktion", "gib", "abbrechen", "weiter",
    "wahr", "falsch", "nichts", "und", "oder", "nicht"].forEach(function (w) { IST_SCHLUESSEL[w] = true; });

  function FabelFehler(art, text, zeile, spalte, laenge) {
    this.art = art; this.text = text; this.line = zeile; this.col = spalte; this.len = laenge || 1;
    this.message = "Zeile " + zeile + ", Spalte " + spalte + ": " + text;
  }
  function tausender(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }

  /* ------------------------------ Lexer ------------------------------ */
  var RE_START = /[\p{L}_]/u, RE_TEIL = /[\p{L}\p{M}\p{N}_]/u;
  var ZWEI = { "<=": 1, ">=": 1, "==": 1, "!=": 1 };
  var ESC = { n: "\n", t: "\t", '"': '"', "\\": "\\" };

  function lex(src) {
    var tokens = [], i = 0, n = src.length, zeile = 1, anfang = 0, stapel = [];
    function neu(art, wert, start, z, s) {
      tokens.push({ art: art, wert: wert, roh: src.slice(start, i), zeile: z, spalte: s, pos: start, ende: i });
    }
    function ziffer(c) { return c >= "0" && c <= "9"; }
    try {
      while (i < n) {
        var c = src[i], start = i, z = zeile, s = i - anfang + 1;
        if (c === " " || c === "\t" || c === "\r") { i++; continue; }
        if (c === "#") { while (i < n && src[i] !== "\n") i++; continue; }
        if (c === "\n") {
          i++;
          var oben = stapel.length ? stapel[stapel.length - 1] : "{";
          var letzt = tokens[tokens.length - 1];
          /* Zeilenenden zählen nur außerhalb von ( … ) und [ … ]. */
          if (oben === "{" && letzt && letzt.art !== "Zeilenende") neu("Zeilenende", "\n", start, z, s);
          zeile++; anfang = i; continue;
        }
        if (ziffer(c)) {
          while (i < n && ziffer(src[i])) i++;
          if (src[i] === "." && i + 1 < n && ziffer(src[i + 1])) { i++; while (i < n && ziffer(src[i])) i++; }
          neu("Zahl", Number(src.slice(start, i)), start, z, s); continue;
        }
        if (c === '"') {
          i++;
          var text = "";
          for (;;) {
            if (i >= n || src[i] === "\n") throw new FabelFehler("Syntaxfehler", "Dieser Text wird nicht mit `\"` abgeschlossen.", z, s);
            var d = src[i++];
            if (d === '"') break;
            if (d === "\\") {
              var e = i < n ? src[i++] : "";
              if (!Object.prototype.hasOwnProperty.call(ESC, e)) {
                throw new FabelFehler("Syntaxfehler", "Die Escape-Folge `\\" + e + "` kenne ich nicht. Erlaubt sind \\n, \\t, \\\" und \\\\.", zeile, i - e.length - anfang, 2);
              }
              text += ESC[e];
            } else text += d;
          }
          neu("Text", text, start, z, s); continue;
        }
        if (RE_START.test(c)) {
          i++;
          while (i < n && RE_TEIL.test(src[i])) i++;
          var wort = src.slice(start, i).normalize("NFC");
          neu(IST_SCHLUESSEL[wort] ? "Schlüsselwort" : "Name", wort, start, z, s); continue;
        }
        var zwei = src.substr(i, 2);
        if (ZWEI[zwei] === 1) { i += 2; neu("Operator", zwei, start, z, s); continue; }
        if (c === "!") throw new FabelFehler("Syntaxfehler", "Ein einzelnes `!` gibt es nicht. Meintest du `!=` oder `nicht`?", z, s);
        if ("+-*/%<>=".indexOf(c) !== -1) { i++; neu("Operator", c, start, z, s); continue; }
        if ("(){}[],;".indexOf(c) !== -1) {
          i++;
          if (c === "(" || c === "[" || c === "{") stapel.push(c);
          else if (c === ")" || c === "]" || c === "}") stapel.pop();
          neu("Zeichen", c, start, z, s); continue;
        }
        throw new FabelFehler("Syntaxfehler", "Das Zeichen `" + c + "` kenne ich nicht.", z, s);
      }
    } catch (err) {
      if (err instanceof FabelFehler) return { tokens: tokens, fehler: err };
      throw err;
    }
    tokens.push({ art: "Ende", wert: null, roh: "", zeile: zeile, spalte: n - anfang + 1, pos: n, ende: n });
    return { tokens: tokens, fehler: null };
  }

  /* ------------------------------ Parser ----------------------------- */
  var BINDUNG = Object.create(null);
  [["oder", 1], ["und", 2], ["==", 4], ["!=", 4], ["<", 5], ["<=", 5], [">", 5], [">=", 5],
    ["+", 6], ["-", 6], ["*", 7], ["/", 7], ["%", 7]].forEach(function (e) { BINDUNG[e[0]] = e[1]; });
  var BP_NICHT = 3, BP_MINUS = 8, BP_NACH = 9;

  function parseTokens(tokens) {
    var p = 0, schleifen = 0, funktionen = 0;
    function sym(w) { var t = tokens[p]; return (t.art === "Zeichen" || t.art === "Operator") && t.wert === w; }
    function kw(w) { var t = tokens[p]; return t.art === "Schlüsselwort" && t.wert === w; }
    function nenne(t) {
      if (t.art === "Ende") return "das Ende des Programms";
      if (t.art === "Zeilenende") return "das Zeilenende";
      return "`" + (t.roh.length > 24 ? t.roh.slice(0, 23) + "…" : t.roh) + "`";
    }
    function fehler(t, text) { return new FabelFehler("Syntaxfehler", text, t.zeile, t.spalte, Math.max(1, t.roh.length)); }
    function erwarte(w) {
      if (!sym(w)) throw fehler(tokens[p], "Ich habe `" + w + "` erwartet, aber " + nenne(tokens[p]) + " gefunden.");
      return tokens[p++];
    }
    function erwarteName(was) {
      var t = tokens[p];
      if (t.art !== "Name") {
        throw fehler(t, "Ich habe " + was + " erwartet, aber " + nenne(t) + " gefunden." +
          (t.art === "Schlüsselwort" ? " `" + t.wert + "` ist ein Schlüsselwort." : ""));
      }
      p++; return t;
    }
    function trenner() { while (tokens[p].art === "Zeilenende" || sym(";")) p++; }
    function anweisungsEnde(imBlock) {
      var t = tokens[p];
      if (t.art === "Zeilenende" || sym(";")) { trenner(); return; }
      if (t.art === "Ende" || sym("}")) return;
      throw fehler(t, "Ich habe " + (imBlock ? "`}` oder ein Zeilenende" : "ein Zeilenende") + " erwartet, aber " + nenne(t) + " gefunden.");
    }
    function knoten(typ, t, mehr) { mehr.typ = typ; mehr.zeile = t.zeile; mehr.spalte = t.spalte; return mehr; }

    function programm() {
      var liste = [];
      trenner();
      while (tokens[p].art !== "Ende") {
        if (sym("}")) throw fehler(tokens[p], "Diese `}` schließt keinen Block.");
        liste.push(anweisung()); anweisungsEnde(false);
      }
      return { typ: "Programm", koerper: liste, zeile: 1, spalte: 1 };
    }
    function block() {
      var auf = erwarte("{"), liste = [];
      trenner();
      while (!sym("}")) {
        if (tokens[p].art === "Ende") throw fehler(tokens[p], "Der Block aus Zeile " + auf.zeile + " wird nicht mit `}` geschlossen.");
        liste.push(anweisung()); anweisungsEnde(true);
      }
      p++;
      return knoten("Block", auf, { koerper: liste });
    }
    function schleifenRumpf() { schleifen++; var b = block(); schleifen--; return b; }

    function anweisung() {
      var t = tokens[p];
      if (kw("sei")) {
        p++;
        var name = erwarteName("einen Variablennamen");
        erwarte("=");
        return knoten("Sei", name, { name: name.wert, len: name.roh.length, wert: ausdruck(0) });
      }
      if (kw("wenn")) return wenn();
      if (kw("sonst")) throw fehler(t, "`sonst` steht hier ohne passendes `wenn`.");
      if (kw("solange")) { p++; var bed = ausdruck(0); return knoten("Solange", t, { bedingung: bed, koerper: schleifenRumpf() }); }
      if (kw("für")) {
        p++;
        var lauf = erwarteName("einen Variablennamen");
        if (!kw("in")) throw fehler(tokens[p], "Ich habe `in` erwartet, aber " + nenne(tokens[p]) + " gefunden.");
        p++;
        var folge = ausdruck(0);
        return knoten("Für", t, { name: lauf.wert, liste: folge, koerper: schleifenRumpf() });
      }
      if (kw("funktion") && tokens[p + 1].art === "Name") return funktion(true);
      if (kw("gib")) {
        if (funktionen === 0) throw fehler(t, "`gib` gibt es nur innerhalb einer Funktion.");
        p++;
        var n = tokens[p], leer = n.art === "Zeilenende" || n.art === "Ende" || sym(";") || sym("}");
        return knoten("Gib", t, { wert: leer ? null : ausdruck(0) });
      }
      if (kw("abbrechen") || kw("weiter")) {
        if (schleifen === 0) throw fehler(t, "`" + t.wert + "` gibt es nur innerhalb einer Schleife.");
        p++;
        return knoten(t.wert === "abbrechen" ? "Abbrechen" : "Weiter", t, {});
      }
      if (sym("{")) return block();
      var a = ausdruck(0);
      if (sym("=")) {
        var gleich = tokens[p++];
        if (a.typ === "Name") return { typ: "Zuweisung", name: a.name, wert: ausdruck(0), zeile: a.zeile, spalte: a.spalte, len: a.len };
        if (a.typ === "Index") return { typ: "IndexZuweisung", ziel: a.ziel, index: a.index, wert: ausdruck(0), zeile: a.zeile, spalte: a.spalte };
        throw fehler(gleich, "Links von `=` muss eine Variable oder ein Listenelement stehen.");
      }
      return { typ: "Ausdruck", ausdruck: a, zeile: t.zeile, spalte: t.spalte };
    }
    function wenn() {
      var t = tokens[p++], bed = ausdruck(0), dann = block(), sonst = null, q = p;
      while (tokens[q].art === "Zeilenende") q++;          /* `sonst` darf in der nächsten Zeile stehen */
      if (tokens[q].art === "Schlüsselwort" && tokens[q].wert === "sonst") {
        p = q + 1;
        sonst = kw("wenn") ? wenn() : block();
      }
      return knoten("Wenn", t, { bedingung: bed, dann: dann, sonst: sonst });
    }
    function funktion(mitName) {
      var t = tokens[p++], name = mitName ? tokens[p++].wert : null, params = [];
      erwarte("(");
      if (!sym(")")) {
        for (;;) {
          var pt = erwarteName("einen Parameternamen");
          if (params.indexOf(pt.wert) !== -1) throw fehler(pt, "Der Parameter `" + pt.wert + "` kommt doppelt vor.");
          params.push(pt.wert);
          if (sym(",")) p++; else break;
        }
      }
      erwarte(")");
      var alt = schleifen; schleifen = 0; funktionen++;
      var rumpf = block();
      funktionen--; schleifen = alt;
      return knoten("Funktion", t, { name: name, params: params, koerper: rumpf });
    }

    /* Pratt-Parser: jede Operatorstufe hat eine Bindungsstärke. */
    function ausdruck(rbp) {
      var links = praefix();
      for (;;) {
        var t = tokens[p], bp;
        if (t.art === "Operator" && BINDUNG[t.wert] !== undefined) bp = BINDUNG[t.wert];
        else if (t.art === "Schlüsselwort" && (t.wert === "und" || t.wert === "oder")) bp = BINDUNG[t.wert];
        else if (t.art === "Zeichen" && (t.wert === "(" || t.wert === "[")) bp = BP_NACH;
        else break;
        if (bp <= rbp) break;
        p++;
        if (t.wert === "(" && t.art === "Zeichen") {
          var args = [];
          if (!sym(")")) { for (;;) { args.push(ausdruck(0)); if (sym(",")) { p++; if (sym(")")) break; } else break; } }
          erwarte(")");
          links = knoten("Aufruf", t, { ziel: links, args: args });
        } else if (t.wert === "[" && t.art === "Zeichen") {
          var idx = ausdruck(0);
          erwarte("]");
          links = knoten("Index", t, { ziel: links, index: idx });
        } else {
          while (tokens[p].art === "Zeilenende" && tokens[p].wert === "\n") p++;   /* Zeile geht nach einem Operator weiter */
          links = knoten(t.art === "Schlüsselwort" ? "Logik" : "Binär", t, { op: t.wert, links: links, rechts: ausdruck(bp) });
        }
      }
      return links;
    }
    function praefix() {
      var t = tokens[p];
      if (t.art === "Zahl") { p++; return knoten("Zahl", t, { wert: t.wert }); }
      if (t.art === "Text") { p++; return knoten("Text", t, { wert: t.wert }); }
      if (t.art === "Name") { p++; return knoten("Name", t, { name: t.wert, len: t.roh.length }); }
      if (t.art === "Schlüsselwort") {
        if (t.wert === "wahr" || t.wert === "falsch") { p++; return knoten("Wahrheit", t, { wert: t.wert === "wahr" }); }
        if (t.wert === "nichts") { p++; return knoten("Nichts", t, {}); }
        if (t.wert === "nicht") { p++; return knoten("Unär", t, { op: "nicht", wert: ausdruck(BP_NICHT) }); }
        if (t.wert === "funktion") return funktion(false);
      }
      if (t.art === "Operator" && t.wert === "-") { p++; return knoten("Unär", t, { op: "-", wert: ausdruck(BP_MINUS) }); }
      if (sym("(")) { p++; var innen = ausdruck(0); erwarte(")"); return innen; }
      if (sym("[")) {
        p++;
        var elemente = [];
        if (!sym("]")) { for (;;) { elemente.push(ausdruck(0)); if (sym(",")) { p++; if (sym("]")) break; } else break; } }
        erwarte("]");
        return knoten("Liste", t, { elemente: elemente });
      }
      throw fehler(t, "Ich habe einen Wert erwartet, aber " + nenne(t) + " gefunden.");
    }
    return programm();
  }

  function tokenize(src) {
    var l = lex(String(src));
    if (l.fehler) throw l.fehler;
    return l.tokens;
  }
  function parse(src) { return parseTokens(tokenize(src)); }

  /* --------------------------- Auswertung ---------------------------- */
  function Umgebung(eltern) { this.v = new Map(); this.eltern = eltern; }
  function Rueckgabe(wert) { this.wert = wert; }
  var ABBRECHEN = { signal: "abbrechen" }, WEITER = { signal: "weiter" };

  function zahlText(n) {
    if (n !== n) return "keine Zahl";
    if (!isFinite(n)) return n > 0 ? "unendlich" : "-unendlich";
    return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12)));
  }
  function zeigeWert(w, innen, tiefe) {
    if (w === null || w === undefined) return "nichts";
    if (w === true) return "wahr";
    if (w === false) return "falsch";
    if (typeof w === "number") return zahlText(w);
    if (typeof w === "string") return innen ? JSON.stringify(w) : w;
    if (Array.isArray(w)) {
      if ((tiefe || 0) > 8) return "[…]";
      return "[" + w.map(function (x) { return zeigeWert(x, true, (tiefe || 0) + 1); }).join(", ") + "]";
    }
    if (w.eingebaut) return "<eingebaute Funktion " + w.name + ">";
    return "<Funktion" + (w.name ? " " + w.name : "") + ">";
  }
  function art(w) {
    if (w === null || w === undefined) return "nichts";
    if (typeof w === "number") return "eine Zahl";
    if (typeof w === "string") return "einen Text";
    if (typeof w === "boolean") return "einen Wahrheitswert";
    if (Array.isArray(w)) return "eine Liste";
    return "eine Funktion";
  }
  function gleich(a, b, tiefe) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || (tiefe || 0) > 50) return false;
      for (var i = 0; i < a.length; i++) if (!gleich(a[i], b[i], (tiefe || 0) + 1)) return false;
      return true;
    }
    return false;
  }
  function abstand(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    var vor = [], i, j;
    for (j = 0; j <= b.length; j++) vor[j] = j;
    for (i = 1; i <= a.length; i++) {
      var akt = [i];
      for (j = 1; j <= b.length; j++) akt[j] = Math.min(vor[j] + 1, akt[j - 1] + 1, vor[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      vor = akt;
    }
    return vor[b.length];
  }

  function interpretiere(prog, opt) {
    var schritte = 0, max = opt.maxSteps > 0 ? opt.maxSteps : MAX_SCHRITTE, tiefe = 0, aktuell = prog;
    var ausgabe = [], zeichen = 0, onPrint = typeof opt.onPrint === "function" ? opt.onPrint : null;

    function lauf(k, text) { return new FabelFehler("Laufzeitfehler", text, k.zeile, k.spalte, k.len || 1); }
    function schritt(k) {
      aktuell = k;
      if (++schritte > max) {
        throw new FabelFehler("Abbruch", "Abgebrochen nach " + tausender(max) + " Schritten – Endlosschleife?", k.zeile, k.spalte);
      }
    }
    function unbekannt(k, env) {
      var best = null, bestD = 3;
      if (k.name.length >= 3) {
        for (var e = env; e; e = e.eltern) {
          e.v.forEach(function (_, n) { var d = abstand(k.name, n); if (d < bestD) { bestD = d; best = n; } });
        }
      }
      return lauf(k, "Die Variable `" + k.name + "` kenne ich nicht." + (best ? " Meintest du `" + best + "`?" : ""));
    }
    function wahrheit(w, k) {
      if (w === true || w === false) return w;
      throw lauf(k, "Hier brauche ich wahr oder falsch, bekommen habe ich " + art(w) + " (" + zeigeWert(w, true) + ").");
    }
    function zahlen(k, a, b) {
      if (typeof a !== "number" || typeof b !== "number") {
        throw lauf(k, "`" + k.op + "` rechnet nur mit Zahlen, bekommen hat es " + art(a) + " und " + art(b) + ".");
      }
    }
    function pruefeIndex(k, idx, laenge) {
      if (typeof idx !== "number" || !Number.isInteger(idx)) throw lauf(k, "Ein Index muss eine ganze Zahl sein, nicht " + zeigeWert(idx, true) + ".");
      if (idx < 0 || idx >= laenge) {
        throw lauf(k, "Index " + idx + " liegt außerhalb (Länge " + laenge + (laenge ? ", gültig sind 0 bis " + (laenge - 1) : "") + ").");
      }
    }
    function nameVon(k) { return k.typ === "Name" ? "`" + k.name + "`" : "Dieser Ausdruck"; }

    /* Eingebaute Funktionen */
    var global = new Umgebung(null);
    function eingebaut(name, min, maxArgs, fn) { global.v.set(name, { eingebaut: true, name: name, min: min, max: maxArgs, fn: fn }); }
    eingebaut("zeige", 0, Infinity, function (a, k) {
      var zeile = a.map(function (x) { return zeigeWert(x, false); }).join(" ");
      zeichen += zeile.length + 1;
      if (ausgabe.length >= MAX_ZEILEN || zeichen > MAX_LAENGE) throw new FabelFehler("Abbruch", "Abgebrochen: zu viel Ausgabe.", k.zeile, k.spalte);
      ausgabe.push(zeile);
      if (onPrint) onPrint(zeile);
      return null;
    });
    eingebaut("länge", 1, 1, function (a, k) {
      if (typeof a[0] === "string" || Array.isArray(a[0])) return a[0].length;
      throw lauf(k, "`länge` braucht eine Liste oder einen Text, bekommen hat es " + art(a[0]) + ".");
    });
    eingebaut("anhängen", 2, 2, function (a, k) {
      if (!Array.isArray(a[0])) throw lauf(k, "`anhängen` braucht als Erstes eine Liste, bekommen hat es " + art(a[0]) + ".");
      if (a[0].length >= MAX_LAENGE) throw lauf(k, "Die Liste ist zu lang geworden (mehr als " + tausender(MAX_LAENGE) + " Elemente).");
      a[0].push(a[1]);
      return a[0];
    });
    eingebaut("bereich", 1, 2, function (a, k) {
      var von = a.length === 2 ? a[0] : 0, bis = a.length === 2 ? a[1] : a[0], liste = [];
      if (!Number.isInteger(von) || !Number.isInteger(bis)) throw lauf(k, "`bereich` braucht ganze Zahlen.");
      if (bis - von > MAX_LAENGE) throw lauf(k, "`bereich` wäre zu groß (mehr als " + tausender(MAX_LAENGE) + " Elemente).");
      for (var i = von; i < bis; i++) liste.push(i);
      return liste;
    });
    eingebaut("text", 1, 1, function (a) { return zeigeWert(a[0], false); });
    eingebaut("zahl", 1, 1, function (a, k) {
      if (typeof a[0] === "number") return a[0];
      if (typeof a[0] === "string" && a[0].trim() !== "" && isFinite(Number(a[0]))) return Number(a[0]);
      throw lauf(k, zeigeWert(a[0], true) + " lässt sich nicht in eine Zahl umwandeln.");
    });
    eingebaut("wurzel", 1, 1, function (a, k) {
      if (typeof a[0] !== "number") throw lauf(k, "`wurzel` braucht eine Zahl, bekommen hat es " + art(a[0]) + ".");
      if (a[0] < 0) throw lauf(k, "Die Wurzel aus einer negativen Zahl (" + zahlText(a[0]) + ") gibt es hier nicht.");
      return Math.sqrt(a[0]);
    });
    eingebaut("abrunden", 1, 1, function (a, k) {
      if (typeof a[0] !== "number") throw lauf(k, "`abrunden` braucht eine Zahl, bekommen hat es " + art(a[0]) + ".");
      return Math.floor(a[0]);
    });

    function folge(liste, env) {
      for (var i = 0; i < liste.length; i++) {
        var s = fuehreAus(liste[i], env);
        if (s !== undefined) return s;
      }
    }
    function fuehreAus(k, env) {
      schritt(k);
      var w, e, s;
      switch (k.typ) {
        case "Ausdruck": werte(k.ausdruck, env); return;
        case "Sei":
          w = werte(k.wert, env);
          if (env.v.has(k.name)) throw lauf(k, "Die Variable `" + k.name + "` gibt es in diesem Block schon. Ohne `sei` bekommt sie einen neuen Wert.");
          env.v.set(k.name, w); return;
        case "Zuweisung":
          w = werte(k.wert, env);
          for (e = env; e; e = e.eltern) if (e.v.has(k.name)) { e.v.set(k.name, w); return; }
          throw unbekannt(k, env);
        case "IndexZuweisung": {
          var ziel = werte(k.ziel, env), idx = werte(k.index, env);
          if (!Array.isArray(ziel)) throw lauf(k, "Nur Listenelemente lassen sich ändern – das hier ist " + art(ziel) + ".");
          pruefeIndex(k, idx, ziel.length);
          ziel[idx] = werte(k.wert, env); return;
        }
        case "Wenn":
          if (wahrheit(werte(k.bedingung, env), k.bedingung)) return folge(k.dann.koerper, new Umgebung(env));
          if (k.sonst) return k.sonst.typ === "Wenn" ? fuehreAus(k.sonst, env) : folge(k.sonst.koerper, new Umgebung(env));
          return;
        case "Solange":
          while (wahrheit(werte(k.bedingung, env), k.bedingung)) {
            s = folge(k.koerper.koerper, new Umgebung(env));
            if (s === ABBRECHEN) break;
            if (s !== undefined && s !== WEITER) return s;
          }
          return;
        case "Für": {
          var reihe = werte(k.liste, env);
          if (typeof reihe === "string") reihe = Array.from(reihe);
          else if (!Array.isArray(reihe)) throw lauf(k, "`für … in` braucht eine Liste oder einen Text, bekommen hat es " + art(reihe) + ".");
          for (var i = 0; i < reihe.length; i++) {
            schritt(k);
            var innen = new Umgebung(env);
            innen.v.set(k.name, reihe[i]);
            s = folge(k.koerper.koerper, innen);
            if (s === ABBRECHEN) break;
            if (s !== undefined && s !== WEITER) return s;
          }
          return;
        }
        case "Block": return folge(k.koerper, new Umgebung(env));
        case "Funktion":
          if (env.v.has(k.name)) throw lauf(k, "Den Namen `" + k.name + "` gibt es in diesem Block schon.");
          env.v.set(k.name, { name: k.name, params: k.params, koerper: k.koerper, umgebung: env }); return;
        case "Gib": return new Rueckgabe(k.wert ? werte(k.wert, env) : null);
        case "Abbrechen": return ABBRECHEN;
        case "Weiter": return WEITER;
      }
      throw lauf(k, "Unbekannte Anweisung: " + k.typ);
    }
    function werte(k, env) {
      schritt(k);
      var a, b, e;
      switch (k.typ) {
        case "Zahl": case "Text": case "Wahrheit": return k.wert;
        case "Nichts": return null;
        case "Name":
          for (e = env; e; e = e.eltern) { a = e.v.get(k.name); if (a !== undefined) return a; }
          throw unbekannt(k, env);
        case "Binär":
          a = werte(k.links, env); b = werte(k.rechts, env);
          switch (k.op) {
            case "+":
              if (typeof a === "number" && typeof b === "number") return a + b;
              if (typeof a === "string" || typeof b === "string") {
                a = zeigeWert(a, false) + zeigeWert(b, false);
                if (a.length > MAX_LAENGE) throw lauf(k, "Der Text ist zu lang geworden (mehr als " + tausender(MAX_LAENGE) + " Zeichen).");
                return a;
              }
              throw lauf(k, "`+` kann " + art(a) + " und " + art(b) + " nicht verbinden.");
            case "-": zahlen(k, a, b); return a - b;
            case "*": zahlen(k, a, b); return a * b;
            case "/": zahlen(k, a, b); if (b === 0) throw lauf(k, "Division durch null."); return a / b;
            case "%": zahlen(k, a, b); if (b === 0) throw lauf(k, "Division durch null."); return a % b;
            case "==": return gleich(a, b);
            case "!=": return !gleich(a, b);
          }
          if (!((typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string"))) {
            throw lauf(k, "`" + k.op + "` vergleicht zwei Zahlen oder zwei Texte, nicht " + art(a) + " und " + art(b) + ".");
          }
          return k.op === "<" ? a < b : k.op === "<=" ? a <= b : k.op === ">" ? a > b : a >= b;
        case "Logik":
          a = wahrheit(werte(k.links, env), k.links);
          if (k.op === "und" ? !a : a) return a;          /* Kurzschluss */
          return wahrheit(werte(k.rechts, env), k.rechts);
        case "Unär":
          a = werte(k.wert, env);
          if (k.op === "nicht") return !wahrheit(a, k.wert);
          if (typeof a !== "number") throw lauf(k, "Das Minus braucht eine Zahl, bekommen hat es " + art(a) + ".");
          return -a;
        case "Aufruf": {
          var f = werte(k.ziel, env), args = [], ort = k.ziel.typ === "Name" ? k.ziel : k, n = k.args.length;
          for (var i = 0; i < n; i++) args.push(werte(k.args[i], env));
          if (f === null || typeof f !== "object" || Array.isArray(f)) throw lauf(ort, nameVon(k.ziel) + " ist keine Funktion, sondern " + art(f) + ".");
          if (f.eingebaut) {
            if (n < f.min || n > f.max) {
              throw lauf(ort, "`" + f.name + "` erwartet " + (f.min === f.max ? f.min : f.min + " bis " + f.max) +
                " Argument" + (f.max === 1 ? "" : "e") + ", hat aber " + n + " bekommen.");
            }
            return f.fn(args, ort);
          }
          if (n !== f.params.length) {
            throw lauf(ort, "`" + (f.name || "Die Funktion") + "` erwartet " + f.params.length + " Argument" +
              (f.params.length === 1 ? "" : "e") + ", hat aber " + n + " bekommen.");
          }
          if (++tiefe > MAX_TIEFE) throw lauf(ort, "Zu tiefe Rekursion (mehr als " + tausender(MAX_TIEFE) + " verschachtelte Aufrufe).");
          var lokal = new Umgebung(f.umgebung);
          for (i = 0; i < n; i++) lokal.v.set(f.params[i], args[i]);
          var s = folge(f.koerper.koerper, lokal);
          tiefe--;
          return s === undefined ? null : s.wert;
        }
        case "Index": {
          var ziel = werte(k.ziel, env), idx = werte(k.index, env);
          if (typeof ziel !== "string" && !Array.isArray(ziel)) throw lauf(k, "Nur Listen und Texte haben Stellen – das hier ist " + art(ziel) + ".");
          pruefeIndex(k, idx, ziel.length);
          return ziel[idx];
        }
        case "Liste": {
          var liste = [];
          for (var j = 0; j < k.elemente.length; j++) liste.push(werte(k.elemente[j], env));
          return liste;
        }
        case "Funktion": return { name: k.name, params: k.params, koerper: k.koerper, umgebung: env };
      }
      throw lauf(k, "Unbekannter Ausdruck: " + k.typ);
    }

    var fehler = null;
    try {
      folge(prog.koerper, new Umgebung(global));
    } catch (err) {
      if (err instanceof FabelFehler) fehler = err;
      else if (err instanceof RangeError || /recursion|call stack/i.test(String(err && err.message))) {
        /* Der JS-Stapel war vor dem eigenen Zähler voll (sehr tief verschachtelte Rümpfe). */
        fehler = new FabelFehler("Laufzeitfehler", /string length/i.test(err.message) ? "Der Text ist zu lang geworden." : "Zu tiefe Rekursion.", aktuell.zeile, aktuell.spalte);
      } else fehler = new FabelFehler("Interner Fehler", String(err && err.message || err), aktuell.zeile, aktuell.spalte);
    }
    return { ausgabe: ausgabe, schritte: Math.min(schritte, max), fehler: fehler };
  }

  function jetzt() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function fehlerObjekt(f) { return f ? { message: f.message, line: f.line, col: f.col, len: f.len, art: f.art, text: f.text } : null; }

  /* run() wirft nie: Fehler stehen im Ergebnis. */
  function run(src, opt) {
    opt = opt || {};
    var t0 = jetzt(), res = { output: [], steps: 0, ms: 0, error: null };
    try {
      var l = lex(String(src));
      if (l.fehler) throw l.fehler;
      var r = interpretiere(parseTokens(l.tokens), opt);
      res.output = r.ausgabe; res.steps = r.schritte; res.error = fehlerObjekt(r.fehler);
    } catch (err) {
      res.error = err instanceof FabelFehler ? fehlerObjekt(err)
        : { message: "Zeile 1, Spalte 1: Interner Fehler: " + (err && err.message || err), line: 1, col: 1, len: 1, art: "Interner Fehler", text: String(err) };
    }
    res.ms = Math.round(jetzt() - t0);
    return res;
  }

  /* ------------------------- Syntaxbaum als Text --------------------- */
  function info(k) {
    function alle(liste) { return liste.map(function (c) { return [null, c]; }); }
    switch (k.typ) {
      case "Programm": return ["Programm", alle(k.koerper)];
      case "Block": return ["Block", alle(k.koerper)];
      case "Ausdruck": return info(k.ausdruck);
      case "Sei": return ["Sei " + k.name, [[null, k.wert]]];
      case "Zuweisung": return ["Zuweisung " + k.name, [[null, k.wert]]];
      case "IndexZuweisung": return ["Zuweisung an Listenelement", [["Liste", k.ziel], ["Stelle", k.index], ["Wert", k.wert]]];
      case "Wenn": return ["Wenn", [["Bedingung", k.bedingung], ["dann", k.dann]].concat(k.sonst ? [["sonst", k.sonst]] : [])];
      case "Solange": return ["Solange", [["Bedingung", k.bedingung], ["Rumpf", k.koerper]]];
      case "Für": return ["Für " + k.name, [["in", k.liste], ["Rumpf", k.koerper]]];
      case "Funktion": return ["Funktion " + (k.name || "ohne Namen") + "(" + k.params.join(", ") + ")", alle(k.koerper.koerper)];
      case "Gib": return ["Gib", k.wert ? [[null, k.wert]] : []];
      case "Abbrechen": case "Weiter": return [k.typ, []];
      case "Zahl": return ["Zahl " + zahlText(k.wert), []];
      case "Text": return ["Text " + JSON.stringify(k.wert), []];
      case "Wahrheit": return [k.wert ? "wahr" : "falsch", []];
      case "Nichts": return ["nichts", []];
      case "Name": return ["Name " + k.name, []];
      case "Liste": return ["Liste mit " + k.elemente.length + (k.elemente.length === 1 ? " Element" : " Elementen"), alle(k.elemente)];
      case "Unär": return ["Unär " + k.op, [[null, k.wert]]];
      case "Binär": case "Logik": return [k.typ + " " + k.op, [[null, k.links], [null, k.rechts]]];
      case "Aufruf":
        if (k.ziel.typ === "Name") return ["Aufruf " + k.ziel.name, alle(k.args)];
        return ["Aufruf", [["Ziel", k.ziel]].concat(alle(k.args))];
      case "Index": return ["Index", [["von", k.ziel], ["Stelle", k.index]]];
    }
    return [k.typ, []];
  }
  function baumText(prog, max) {
    var zeilen = [], mehr = 0;
    (function geh(k, vor, letzt, rolle, wurzel) {
      var i = info(k);
      if (zeilen.length < max) zeilen.push(wurzel ? i[0] : vor + (letzt ? "└─ " : "├─ ") + (rolle ? rolle + ": " : "") + i[0]);
      else mehr++;
      var weiter = wurzel ? "" : vor + (letzt ? "   " : "│  ");
      i[1].forEach(function (c, n) { geh(c[1], weiter, n === i[1].length - 1, c[0], false); });
    })(prog, "", true, null, true);
    if (mehr) zeilen.push("… und " + mehr + " weitere Knoten");
    return zeilen.join("\n");
  }

  /* ----------------------------- Beispiele --------------------------- */
  var BEISPIELE = [
    { name: "Fibonacci rekursiv", code: [
      "# Fibonacci, rekursiv",
      "funktion fib(n) {",
      "  wenn n < 2 { gib n }",
      "  gib fib(n - 1) + fib(n - 2)",
      "}",
      "",
      "für i in bereich(1, 11) {",
      "  zeige(\"fib(\" + i + \") =\", fib(i))",
      "}",
      "zeige(\"fib(20) =\", fib(20))"] },
    { name: "FizzBuzz", code: [
      "# FizzBuzz von 1 bis 20",
      "für i in bereich(1, 21) {",
      "  wenn i % 15 == 0 { zeige(\"FizzBuzz\") }",
      "  sonst wenn i % 3 == 0 { zeige(\"Fizz\") }",
      "  sonst wenn i % 5 == 0 { zeige(\"Buzz\") }",
      "  sonst { zeige(i) }",
      "}"] },
    { name: "Primzahlsieb", code: [
      "# Sieb des Eratosthenes",
      "sei grenze = 50",
      "sei ist_prim = []",
      "für k in bereich(grenze) { anhängen(ist_prim, k >= 2) }",
      "",
      "sei i = 2",
      "solange i * i < grenze {",
      "  wenn ist_prim[i] {",
      "    sei j = i * i",
      "    solange j < grenze {",
      "      ist_prim[j] = falsch",
      "      j = j + i",
      "    }",
      "  }",
      "  i = i + 1",
      "}",
      "",
      "sei primzahlen = []",
      "für n in bereich(grenze) {",
      "  wenn ist_prim[n] { anhängen(primzahlen, n) }",
      "}",
      "zeige(primzahlen)",
      "zeige(länge(primzahlen), \"Primzahlen unter\", grenze)"] },
    { name: "Türme von Hanoi", code: [
      "# Türme von Hanoi: n Scheiben brauchen 2^n - 1 Züge",
      "sei züge = 0",
      "",
      "funktion hanoi(n, von, nach, über, laut) {",
      "  wenn n == 0 { gib }",
      "  hanoi(n - 1, von, über, nach, laut)",
      "  züge = züge + 1",
      "  wenn laut { zeige(\"Scheibe\", n, \"von\", von, \"nach\", nach) }",
      "  hanoi(n - 1, über, nach, von, laut)",
      "}",
      "",
      "hanoi(3, \"A\", \"C\", \"B\", wahr)",
      "zeige(\"3 Scheiben:\", züge, \"Züge\")",
      "",
      "züge = 0",
      "hanoi(10, \"A\", \"C\", \"B\", falsch)",
      "zeige(\"10 Scheiben:\", züge, \"Züge\")"] },
    { name: "Zähler mit Closures", code: [
      "# Jede Funktion merkt sich die Umgebung, in der sie entstanden ist.",
      "funktion zähler(start, schritt) {",
      "  sei stand = start",
      "  gib funktion() {",
      "    stand = stand + schritt",
      "    gib stand",
      "  }",
      "}",
      "",
      "sei a = zähler(0, 1)",
      "sei b = zähler(100, 10)",
      "zeige(a(), a(), a())",
      "zeige(b(), b())",
      "zeige(\"a merkt sich:\", a())",
      "",
      "# Funktionen sind Werte: als Argument übergeben",
      "funktion abbilden(liste, f) {",
      "  sei ergebnis = []",
      "  für x in liste { anhängen(ergebnis, f(x)) }",
      "  gib ergebnis",
      "}",
      "zeige(abbilden([1, 2, 3, 4], funktion(x) { gib x * x }))"] },
    { name: "Mandelbrot als Text", code: [
      "# Mandelbrot-Menge aus zehn Zeichen",
      "sei zeichen = \" .:-=+*#%@\"",
      "",
      "für zeile in bereich(21) {",
      "  sei ci = (zeile - 10) / 10",
      "  sei ausgabe = \"\"",
      "  für spalte in bereich(60) {",
      "    sei cr = (spalte - 42) / 20",
      "    sei x = 0",
      "    sei y = 0",
      "    sei n = 0",
      "    solange n < 18 und x * x + y * y <= 4 {",
      "      sei neu = x * x - y * y + cr",
      "      y = 2 * x * y + ci",
      "      x = neu",
      "      n = n + 1",
      "    }",
      "    ausgabe = ausgabe + zeichen[abrunden(n / 2)]",
      "  }",
      "  zeige(ausgabe)",
      "}"] },
    { name: "Bubblesort", code: [
      "# Bubblesort: tauschen, bis nichts mehr zu tauschen ist",
      "sei zahlen = [34, 7, 23, 32, 5, 62, 14, 2]",
      "zeige(\"vorher:\", zahlen)",
      "",
      "sei n = länge(zahlen)",
      "sei getauscht = wahr",
      "sei durchläufe = 0",
      "solange getauscht {",
      "  getauscht = falsch",
      "  für i in bereich(n - 1) {",
      "    wenn zahlen[i] > zahlen[i + 1] {",
      "      sei merker = zahlen[i]",
      "      zahlen[i] = zahlen[i + 1]",
      "      zahlen[i + 1] = merker",
      "      getauscht = wahr",
      "    }",
      "  }",
      "  durchläufe = durchläufe + 1",
      "}",
      "",
      "zeige(\"nachher:\", zahlen)",
      "zeige(\"Durchläufe:\", durchläufe)"] }
  ].map(function (b) { return { name: b.name, code: b.code.join("\n") + "\n" }; });

  W.sprache = { tokenize: tokenize, parse: parse, run: run, examples: BEISPIELE };

  /* ------------------------------- Demo ------------------------------ */
  var REFERENZ = [
    "sei x = 10                 # Variable anlegen",
    "x = x + 1                  # neuen Wert zuweisen",
    "wenn x > 5 { … } sonst wenn x > 2 { … } sonst { … }",
    "solange x > 0 { … }        # abbrechen, weiter",
    "für e in [1, 2, 3] { … }   # auch: für i in bereich(10)",
    "funktion f(a, b) { gib a + b }",
    "",
    "Werte:     42  3.5  \"Text\"  wahr  falsch  nichts  [1, 2]",
    "Rechnen:   + - * / %    Vergleich: == != < <= > >=",
    "Logik:     und  oder  nicht",
    "Eingebaut: zeige  länge  anhängen  bereich",
    "           text  zahl  wurzel  abrunden"
  ].join("\n");
  var TOKEN_KLASSE = { "Schlüsselwort": "kw", "Name": "name", "Zahl": "wert", "Text": "wert", "Operator": "op", "Zeichen": "op" };
  var MAX_TOKENS = 600, MAX_KNOTEN = 400;

  function mount(rootEl) {
    var el = W.el, ansicht = "ausgabe", escGedrueckt = false;

    var auswahl = el("select", { class: "select d-sprache-auswahl", id: "d-sprache-beispiel", "aria-label": "Beispielprogramm" },
      BEISPIELE.map(function (b, i) { return el("option", { value: String(i) }, b.name); }));
    var start = el("button", { class: "btn btn--primary", type: "button", id: "d-sprache-start" }, "Ausführen");
    var mess = el("span", { class: "note d-sprache-mess", role: "status" });
    var nummern = el("div", { class: "d-sprache-nummern", "aria-hidden": "true" });
    var feld = el("textarea", {
      class: "input d-sprache-feld", id: "d-sprache-code", spellcheck: "false", wrap: "off",
      autocapitalize: "off", autocomplete: "off", autocorrect: "off", "aria-label": "Fabel-Programm",
      "aria-describedby": "d-sprache-hilfe"
    });
    var hilfe = el("p", { class: "note", id: "d-sprache-hilfe" },
      el("kbd", null, "Strg"), "/", el("kbd", null, "⌘"), " + ", el("kbd", null, "Enter"), " führt aus · ",
      el("kbd", null, "Tab"), " rückt ein · ", el("kbd", null, "Esc"), " gibt Tab wieder frei");
    var referenz = el("details", { class: "d-sprache-ref" },
      el("summary", null, "Kurzreferenz der Sprache"),
      el("pre", { class: "code" }, REFERENZ));

    var knoepfe = {}, flaechen = {};
    var seg = el("div", { class: "seg", role: "group", "aria-label": "Ansicht" },
      [["ausgabe", "Ausgabe"], ["tokens", "Tokens"], ["baum", "Syntaxbaum"]].map(function (a) {
        return (knoepfe[a[0]] = el("button", { type: "button", "aria-pressed": "false", onclick: function () { zeigeAnsicht(a[0]); } }, a[1]));
      }));
    var ausText = el("pre", { class: "d-sprache-ausgabe" });
    var ausFehler = el("div", { class: "d-sprache-fehler", role: "alert", hidden: true });
    flaechen.ausgabe = el("div", { class: "d-sprache-flaeche", tabindex: "0", role: "region", "aria-label": "Ausgabe des Programms" }, ausText, ausFehler);
    flaechen.tokens = el("div", { class: "d-sprache-flaeche", tabindex: "0", role: "region", "aria-label": "Tokens", hidden: true });
    flaechen.baum = el("pre", { class: "d-sprache-flaeche d-sprache-baum", tabindex: "0", role: "region", "aria-label": "Syntaxbaum", hidden: true });

    rootEl.appendChild(el("div", { class: "d-sprache" },
      el("div", { class: "d-sprache-spalte" },
        el("div", { class: "demo-bar" }, auswahl, start, mess),
        el("div", { class: "d-sprache-editor" }, nummern, feld),
        hilfe, referenz),
      el("div", { class: "d-sprache-spalte" },
        el("div", { class: "demo-bar" }, seg),
        flaechen.ausgabe, flaechen.tokens, flaechen.baum)));

    function zeigeAnsicht(name) {
      ansicht = name;
      Object.keys(flaechen).forEach(function (k) {
        flaechen[k].hidden = k !== name;
        knoepfe[k].setAttribute("aria-pressed", k === name ? "true" : "false");
      });
    }

    function zeichneNummern(fehlerZeile) {
      var n = feld.value.split("\n").length, teile = [];
      for (var i = 1; i <= n; i++) teile.push(el("span", { class: i === fehlerZeile ? "d-sprache-nr d-sprache-nr--fehler" : "d-sprache-nr" }, String(i)));
      nummern.replaceChildren.apply(nummern, teile);
      nummern.scrollTop = feld.scrollTop;
    }

    function zeichneTokens(l) {
      var kinder = [], sichtbar = l.tokens.filter(function (t) { return t.art !== "Zeilenende" && t.art !== "Ende"; });
      kinder.push(el("p", { class: "note d-sprache-legende" },
        W.fmt(sichtbar.length) + " Tokens · ",
        el("span", { class: "d-sprache-tok d-sprache-tok--kw" }, "Schlüsselwort"), " ",
        el("span", { class: "d-sprache-tok d-sprache-tok--name" }, "Name"), " ",
        el("span", { class: "d-sprache-tok d-sprache-tok--wert" }, "Wert"), " ",
        el("span", { class: "d-sprache-tok d-sprache-tok--op" }, "Zeichen")));
      var zeile = null, reihe = null;
      sichtbar.slice(0, MAX_TOKENS).forEach(function (t) {
        if (t.zeile !== zeile) {
          zeile = t.zeile;
          reihe = el("div", { class: "d-sprache-tokzeile" }, el("span", { class: "d-sprache-toknr" }, String(zeile)));
          kinder.push(reihe);
        }
        reihe.appendChild(el("span", { class: "d-sprache-tok d-sprache-tok--" + TOKEN_KLASSE[t.art], title: t.art + " · Zeile " + t.zeile + ", Spalte " + t.spalte }, t.roh));
      });
      if (sichtbar.length > MAX_TOKENS) kinder.push(el("p", { class: "note" }, "… und " + W.fmt(sichtbar.length - MAX_TOKENS) + " weitere"));
      if (l.fehler) kinder.push(el("p", { class: "d-sprache-hinweis" }, "Hier endet die Zerlegung: " + l.fehler.message));
      flaechen.tokens.replaceChildren.apply(flaechen.tokens, kinder);
    }

    function zeigeFehler(f, src) {
      var zeilen = src.split("\n"), text = (zeilen[f.line - 1] || "").replace(/\t/g, " "), spalte = f.col;
      if (text.length > 76) {                                   /* lange Zeilen um die Fehlerstelle herum kürzen */
        var ab = Math.max(0, Math.min(spalte - 40, text.length - 76));
        text = (ab > 0 ? "…" : "") + text.slice(ab + (ab > 0 ? 1 : 0), ab + 76);
        spalte -= ab;
      }
      var nr = String(f.line), rand = " ".repeat(nr.length);
      var marke = "^".repeat(Math.max(1, Math.min(f.len || 1, text.length - spalte + 1)));
      var auszug = el("pre", { class: "d-sprache-auszug", tabindex: "0", "aria-label": "Fehlerstelle im Programm" },
        nr + " | " + text + "\n" + rand + " | " + " ".repeat(Math.max(0, spalte - 1)) + marke);
      ausFehler.replaceChildren(
        el("p", { class: "d-sprache-fehlertitel" }, el("strong", null, f.art), " · " + f.message),
        auszug);
      ausFehler.hidden = false;
      zeigeAnsicht("ausgabe");
      /* Auf schmalen Bildschirmen die Markierung in den sichtbaren Teil des Auszugs holen. */
      var breite = auszug.scrollWidth - auszug.clientWidth;
      if (breite > 0) {
        var proZeichen = auszug.scrollWidth / (nr.length + 3 + Math.max(text.length, spalte - 1 + marke.length));
        var rechts = (nr.length + 3 + spalte - 1 + marke.length) * proZeichen;
        if (rechts > auszug.clientWidth) auszug.scrollLeft = Math.min(breite, rechts - auszug.clientWidth * 0.6);
      }
    }

    function markiere(f, src) {
      var zeilen = src.split("\n"), pos = 0;
      for (var i = 0; i < f.line - 1 && i < zeilen.length; i++) pos += zeilen[i].length + 1;
      pos = Math.min(src.length, pos + f.col - 1);
      try { feld.setSelectionRange(pos, Math.min(src.length, pos + (f.len || 1))); } catch (e) { /* nicht fokussierbar */ }
      var hoehe = parseFloat(getComputedStyle(feld).lineHeight) || 20;
      var oben = (f.line - 1) * hoehe;
      if (oben < feld.scrollTop || oben > feld.scrollTop + feld.clientHeight - 2 * hoehe) feld.scrollTop = Math.max(0, oben - 3 * hoehe);
    }

    function fuehreAus() {
      var src = feld.value, l = lex(src), res = run(src);
      ausText.textContent = res.output.join("\n");
      ausText.hidden = res.output.length === 0 && !!res.error;
      ausFehler.hidden = true;
      zeichneTokens(l);
      var baum = null;
      if (!l.fehler) { try { baum = parseTokens(l.tokens); } catch (e) { baum = null; } }
      flaechen.baum.textContent = baum ? baumText(baum, MAX_KNOTEN) : "Kein Syntaxbaum: Das Programm lässt sich nicht zerlegen.\n" + (res.error ? res.error.message : "");
      flaechen.baum.classList.toggle("d-sprache-baum--leer", !baum);
      if (res.error) {
        zeigeFehler(res.error, src);
        markiere(res.error, src);
        mess.textContent = res.error.art + " in Zeile " + res.error.line;
      } else {
        if (!res.output.length) ausText.textContent = "(Das Programm hat nichts ausgegeben.)";
        mess.textContent = W.fmt(res.steps) + " Schritte · " + (res.ms < 1 ? "unter 1" : W.fmt(res.ms)) + " ms";
      }
      mess.classList.toggle("d-sprache-mess--fehler", !!res.error);
      zeichneNummern(res.error ? res.error.line : 0);
      flaechen.ausgabe.scrollTop = res.error ? flaechen.ausgabe.scrollHeight : 0;
      return res;
    }

    function lade(i) {
      feld.value = BEISPIELE[i].code;
      feld.scrollTop = 0; feld.scrollLeft = 0;
      fuehreAus();
    }
    function fuegeEin(text) {
      var ok = false;
      try { ok = document.execCommand && document.execCommand("insertText", false, text); } catch (e) { ok = false; }
      if (!ok) feld.setRangeText(text, feld.selectionStart, feld.selectionEnd, "end");
    }

    auswahl.addEventListener("change", function () { lade(Number(auswahl.value)); });
    start.addEventListener("click", fuehreAus);
    feld.addEventListener("input", function () { zeichneNummern(0); });
    feld.addEventListener("scroll", function () { nummern.scrollTop = feld.scrollTop; });
    feld.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); fuehreAus(); return; }
      if (ev.key === "Escape") { escGedrueckt = true; return; }
      if (ev.key === "Tab" && !ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !escGedrueckt) {
        ev.preventDefault(); fuegeEin("  "); zeichneNummern(0);
      }
      escGedrueckt = false;
    });
    feld.addEventListener("blur", function () { escGedrueckt = false; });

    zeigeAnsicht("ausgabe");
    lade(0);

    return {
      run: fuehreAus,
      destroy: function () { rootEl.replaceChildren(); }
    };
  }

  W.register("sprache", {
    title: "Fabel",
    kind: "Sprachbau · Interpreter",
    lead: "Ich habe mir eine kleine Programmiersprache mit deutschen Schlüsselwörtern ausgedacht und ihren Interpreter geschrieben: Lexer, Pratt-Parser, Syntaxbaum und Auswertung mit Closures. Ändere ein Beispiel oder schreib ein eigenes Programm. Fehler melde ich mit Zeile und Spalte.",
    facts: ["Lexer, Parser und Interpreter ohne Bibliotheken", "Fehlermeldungen mit Zeile, Spalte und Markierung", "Schrittlimit stoppt Endlosschleifen"],
    moral: "Eine Sprache ist erst fertig, wenn auch ihre Fehlermeldungen stimmen.",
    mount: mount
  });
})();
