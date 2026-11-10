/* Facts used across the page. Every number has a source (see the Quellen list in page.html).
   Prices: US dollars per million tokens, Claude API list prices. */
(function () {
  "use strict";
  var W = (typeof window !== "undefined" ? window : globalThis).Werkschau;

  W.models = {
    haiku:  { key: "haiku",  name: "Haiku 5.5",  id: "claude-haiku-5-5",  inP: 0.1, outP: 0.5, cacheP: 0.01, longAt: 100000, longIn: 0.5, longOut: 2.5, longCache: 0.05, effort: "medium" },
    sonnet: { key: "sonnet", name: "Sonnet 5.5", id: "claude-sonnet-5-5", inP: 2,   outP: 10,  cacheP: 0.1,  effort: "high" },
    opus:   { key: "opus",   name: "Opus 5.5",   id: "claude-opus-5-5",   inP: 4,   outP: 20,  cacheP: 0.2,  effort: "medium" },
    fable:  { key: "fable",  name: "Fable 5.2",  id: "claude-fable-5-2",  inP: 8,   outP: 40,  cacheP: 0.2,  effort: "high" }
  };
  W.modelOrder = ["haiku", "sonnet", "opus", "fable"];

  /* Published by Anthropic on anthropic.com/claude/fable (fetched 2026-11-10, read twice).
     Percent scores; f = Fable 5.2, o = Opus 5.5, p = Fable 5.1. */
  W.benchmarks = [
    { name: "FrontierCode 2.0", area: "Agentisches Programmieren", f: 49.1, o: 45.5, p: 32.4, note: "Fable-Werte auf Denkstufe xhigh" },
    { name: "FrontierSWE v2", area: "Agentisches Programmieren", f: 69.9, o: 62.3, p: 56.3 },
    { name: "AutomationBench", area: "Geschäftsabläufe", f: 51.4, o: 42.5, p: 31.4 },
    { name: "Terminal-Bench-Science 0.1", area: "Agentische Forschung", f: 74.6, o: 58.7, p: 52.6 },
    { name: "WANDR", area: "Agentische Suche", f: 82.1, o: 72.3, p: 68.7, note: "relaxed score" },
    { name: "OSWorld 2.1", area: "Computerbedienung", f: 89.3, o: 87.2, p: 83.5, note: "Offline-Set, Teilwertung" },
    { name: "RoboDojo Sim", area: "Robotik", f: 64.9, o: 39.4, p: 27.6, note: "von Anthropic intern gemessen" },
    { name: "AA-Briefcase v1.1", area: "Wissensarbeit", f: 66.1, o: 61.2, p: 61.5, note: "Rubrik-Wertung" },
    { name: "Remote Labor Index", area: "Wissensarbeit", f: 41.3, o: 21.3, p: 17.9, note: "Fable 5.2 auf Denkstufe high" },
    { name: "Humanity's Last Exam", area: "Fachübergreifendes Denken", f: 74.2, o: 67.7, p: 65.6, note: "mit Werkzeugen" },
    { name: "Chartography", area: "Diagramme lesen", f: 73.4, o: 64.4, p: 44.8, note: "ohne Werkzeuge" }
  ];

  /* Cost of n requests. cacheShare (0..1) is the part of the input read from the prompt cache.
     Cache writes are not included. */
  W.kosten = function (modelKey, n, inTok, outTok, cacheShare) {
    var m = W.models[modelKey];
    var long = m.longAt && inTok > m.longAt;
    var inP = long ? m.longIn : m.inP, outP = long ? m.longOut : m.outP, cacheP = long ? m.longCache : m.cacheP;
    var c = Math.min(Math.max(cacheShare || 0, 0), 1);
    return n * (inTok * (1 - c) * inP + inTok * c * cacheP + outTok * outP) / 1e6;
  };

  W.dollar = function (x) {
    if (x > 0 && x < 0.01) return "< $0,01";
    var digits = x < 10 ? 2 : x < 1000 ? 2 : 0;
    return "$" + x.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  /* The four questions of the Kompass and the rule that turns answers into a recommendation. */
  W.kompass = {
    fragen: [
      { id: "aufgabe", frage: "Was für eine Aufgabe ist es?", optionen: [
        { v: "masse",  w: 0, titel: "Masse mit einfacher Struktur", text: "Klassifizieren, extrahieren, weiterleiten, tausendfach." },
        { v: "alltag", w: 1, titel: "Alltag", text: "Chat, Texte, kleine Skripte, schnelle Fragen." },
        { v: "ernst",  w: 2, titel: "Ernsthafte Facharbeit", text: "Features bauen, Code prüfen, Analysen und Berichte schreiben." },
        { v: "offen",  w: 3, titel: "Groß und offen", text: "Architektur, Forschung, mehrere Repos, tagelange Agentenläufe." }
      ] },
      { id: "fehler", frage: "Was kostet ein Fehler?", optionen: [
        { v: "gering", w: -0.25, titel: "Wenig", text: "Fällt sofort auf und ist schnell korrigiert." },
        { v: "mittel", w: 0, titel: "Spürbar", text: "Kostet Zeit, ist aber zu reparieren." },
        { v: "teuer",  w: 0.4, titel: "Viel", text: "Schwer zu bemerken oder schwer zurückzudrehen." }
      ] },
      { id: "tempo", frage: "Wie schnell brauchst du die Antwort?", optionen: [
        { v: "sekunden", w: -0.5, titel: "In Sekunden", text: "Jemand sitzt davor und wartet." },
        { v: "minuten",  w: 0, titel: "In Minuten", text: "Ich arbeite nebenher weiter." },
        { v: "spaeter",  w: 0.25, titel: "Irgendwann", text: "Ich komme fürs fertige Ergebnis zurück." }
      ] },
      { id: "preis", frage: "Wie stark zählt der Preis?", optionen: [
        { v: "sehr",   w: -0.75, titel: "Sehr", text: "Hohe Stückzahl, jeder Cent pro Anfrage zählt." },
        { v: "normal", w: 0, titel: "Normal", text: "Soll im Rahmen bleiben." },
        { v: "egal",   w: 0.25, titel: "Kaum", text: "Das beste Ergebnis zählt." }
      ] }
    ],
    start: { aufgabe: "ernst", fehler: "mittel", tempo: "minuten", preis: "normal" },

    warum: {
      haiku: "Haiku 5.5 ist das schnellste und mit Abstand günstigste Modell. Für klar umrissene Aufgaben in großer Zahl reicht es.",
      sonnet: "Sonnet 5.5 verbindet Tempo und Klugheit am besten. Für Alltagsarbeit mit kurzen Antwortzeiten passt es.",
      opus: "Opus 5.5 ist Anthropics empfohlener Startpunkt für ernsthafte Programmier- und Wissensarbeit.",
      fable: "Das ist mein Feld: große, offene Aufgaben, bei denen Urteilsvermögen über viele Schritte zählt."
    },
    zusatz: {
      gering: "Fehler fallen bei dir schnell auf, das erlaubt ein kleineres Modell.",
      teuer: "Teure Fehler rechtfertigen mehr Gründlichkeit.",
      sekunden: "Weil jemand live wartet, zählt Tempo.",
      spaeter: "Du kommst fürs Ergebnis zurück, also darf die Arbeit dauern.",
      sehr: "Bei deiner Stückzahl entscheidet der Preis pro Token.",
      egal: "Der Preis ist zweitrangig, also zählt das beste Ergebnis."
    },
    weiter: {
      haiku: "Wechsle zu <b>Sonnet 5.5</b>.",
      sonnet: "Stell erst die Denkstufe höher, dann wechsle zu <b>Opus 5.5</b>.",
      opus: "Stell erst die Denkstufe auf <code>high</code>, dann wechsle zu <b>Fable 5.2</b>.",
      fable: "Gib mir mehr Kontext oder zerlege die Aufgabe. Ein stärkeres allgemein verfügbares Modell gibt es nicht."
    },

    /* answers: {aufgabe, fehler, tempo, preis} → {model, effort, gruende[], tipp, konflikt} */
    empfehle: function (a) {
      var K = W.kompass, score = 0;
      K.fragen.forEach(function (q) {
        var opt = q.optionen.filter(function (o) { return o.v === a[q.id]; })[0];
        if (opt) score += opt.w;
      });
      var idx = Math.min(3, Math.max(0, Math.round(score)));
      var model = W.modelOrder[idx];

      var effort;
      if (model === "haiku") effort = (a.tempo === "sekunden" || a.aufgabe === "masse") ? "low" : "medium";
      else if (model === "sonnet") effort = a.fehler === "teuer" ? "high" : (a.tempo === "sekunden" || a.aufgabe === "alltag") ? "low" : "medium";
      else if (model === "opus") effort = a.tempo === "sekunden" ? "low" : a.fehler === "teuer" ? "high" : "medium";
      else effort = a.tempo === "sekunden" ? "medium" : "high";

      var gruende = [K.warum[model]];
      ["fehler", "tempo", "preis"].forEach(function (id) {
        if (K.zusatz[a[id]] && gruende.length < 3) gruende.push(K.zusatz[a[id]]);
      });

      var tipp = "";
      if (a.tempo === "sekunden" && (model === "opus" || model === "fable")) tipp = "Fast Mode liefert bis zu 2,5-mal schnellere Ausgabe zum doppelten Preis.";
      else if (a.preis === "sehr" && a.tempo !== "sekunden") tipp = "Wenn die Antwort warten darf: Die Batch-API kostet die Hälfte.";
      else if (model === "fable") tipp = "Gib mir die ganze Aufgabe auf einmal und komm fürs Ergebnis zurück.";
      else if (model === "opus" && a.aufgabe === "offen") tipp = "Für die volle Größe der Aufgabe wäre ich die erste Wahl. Tempo oder Preis sprechen hier dagegen.";

      var konflikt = a.aufgabe === "offen" && model !== "fable";
      return { model: model, effort: effort, gruende: gruende, tipp: tipp, konflikt: konflikt, score: score };
    }
  };

  /* Tasks for the Selbsttest. `achte` says what a good answer contains. */
  W.aufgaben = [
    { id: "fehler", titel: "Fehler finden",
      prompt: "Diese Funktion soll den Median einer Zahlenliste liefern. Finde alle Fehler, erkläre jeden in einem Satz und gib eine korrigierte Fassung an.\n\nfunction median(werte) {\n  const sortiert = werte.sort();\n  const mitte = sortiert.length / 2;\n  if (sortiert.length % 2 === 0) {\n    return (sortiert[mitte] + sortiert[mitte + 1]) / 2;\n  }\n  return sortiert[mitte];\n}",
      achte: "Vier Fehler stecken drin: <b>sort() ohne Vergleichsfunktion</b> sortiert Zahlen als Text, <b>sort() verändert die Liste des Aufrufers</b>, im geraden Fall sind es die Positionen <b>mitte − 1 und mitte</b>, im ungeraden Fall ist <b>mitte keine ganze Zahl</b>. Dazu kommt die leere Liste. Wer findet alle fünf Punkte, ohne Fehler zu erfinden?" },
    { id: "logik", titel: "Logikrätsel",
      prompt: "Ada, Bea, Cleo und Dana haben je genau einen Bug behoben: in vier verschiedenen Sprachen (Go, Rust, Python, Kotlin) und an vier verschiedenen Tagen (Montag bis Donnerstag).\n\n1. Der Rust-Fix kam genau einen Tag nach Adas Fix.\n2. Bea hat nicht am Montag gefixt und nicht in Python.\n3. Der Kotlin-Fix war am Donnerstag.\n4. Cleo hat früher gefixt als Dana.\n5. Dana schreibt weder Rust noch Kotlin.\n6. Der Python-Fix kam vor dem Go-Fix.\n\nWer hat an welchem Tag in welcher Sprache gefixt? Zeig kurz, warum die Lösung eindeutig ist.",
      achte: "Es gibt genau eine Lösung, ich habe sie per Durchprobieren aller 576 Möglichkeiten geprüft: <b>Ada Montag Python, Cleo Dienstag Rust, Dana Mittwoch Go, Bea Donnerstag Kotlin</b>. Achte darauf, ob die Begründung trägt oder nur das Ergebnis behauptet wird." },
    { id: "schaetzen", titel: "Schätzen",
      prompt: "Schätze, wie viele Liter Kaffee in Deutschland an einem durchschnittlichen Tag getrunken werden. Nenne deine Annahmen, rechne offen und gib am Ende eine Spanne an, keine einzelne Zahl.",
      achte: "Eine gute Antwort legt die Annahmen offen (Einwohner, Anteil der Kaffeetrinker, Tassen pro Tag, Tassengröße) und landet bei <b>grob 30 bis 45 Millionen Litern</b>. Der Deutsche Kaffeeverband nennt gut 160 Liter pro Kopf und Jahr. Achte auf die Spanne und darauf, ob die Rechnung nachvollziehbar ist." },
    { id: "vorgabe", titel: "Schreiben nach Vorgabe",
      prompt: "Erkläre einem zehnjährigen Kind, was das Kontextfenster eines KI-Modells ist.\n\nRegeln: genau vier Sätze. Kein Satz hat mehr als 14 Wörter. Das Wort »Token« kommt nicht vor. Der letzte Satz ist eine Frage.",
      achte: "Zähl nach: <b>vier Sätze, höchstens 14 Wörter je Satz, kein »Token«, Frage am Schluss</b>. Stimmt die Erklärung trotzdem und klingt sie wie für ein Kind geschrieben?" },
    { id: "plan", titel: "Planen",
      prompt: "Unser Onlineshop ist ein Monolith mit einer einzelnen PostgreSQL-Datenbank und 40.000 Bestellungen am Tag. Wir wollen Lesezugriffe ohne Ausfallzeit auf Replikate verlagern.\n\nGib mir einen Plan in höchstens acht Schritten. Nenne zu jedem Schritt das größte Risiko und wie ich ihn zurückrolle.",
      achte: "Gute Pläne nennen die <b>Replikationsverzögerung</b> und das Problem, eigene Schreibvorgänge sofort wieder zu lesen, schalten Lesepfade <b>stufenweise</b> um, überwachen die Verzögerung und haben <b>für jeden Schritt</b> einen Rückweg. Wer hält die Grenze von acht Schritten ein?" },
    { id: "eigene", titel: "Eigene Aufgabe", prompt: "", achte: "Nimm etwas aus deiner echten Arbeit. Am meisten lernst du aus einer Aufgabe, deren richtige Antwort du kennst." }
  ];

  /* What happened in this session. Times are Central European Time, read off the system clock as the work went on. */
  W.protokoll = [
    { zeit: "18:01", titel: "Leeres Repository", text: "Eine einzige Datei liegt darin: die Lizenz." },
    { zeit: "18:04", titel: "Fakten geprüft", text: "Preise, Kontextfenster und Denkstufen aus der API-Dokumentation. Die Benchmark-Tabelle von anthropic.com zweimal abgerufen und abgeglichen." },
    { zeit: "18:10", titel: "Designsystem und Demo-Schnittstelle", text: "Farben, Schriften, Bausteine. Dazu ein Vertrag, an den sich jede Demo hält." },
    { zeit: "18:12", titel: "Sechs Kopien, sechs Demos", text: "Sechs parallele Kopien von mir bauen je eine Arbeitsprobe und testen sie selbst im Browser." },
    { zeit: "18:13", titel: "Die Seite selbst", text: "Währenddessen entstehen Vorstellung, Vergleich, Kostenrechner, Kompass und Selbsttest." },
    { zeit: "18:24", titel: "Erster Blick im Browser", text: "Screenshots in hell und dunkel, breit und schmal. Kleinigkeiten korrigiert." },
    { zeit: "18:37", titel: "Alle sechs Demos fertig", text: "Jede Kopie hat ihre Demo in vier Ansichten geprüft und ihre Logik mit Tests belegt. Am längsten brauchte das Schwerkraft-Spiel: Seine Level wurden per Suchlauf abgestimmt." },
    { zeit: "18:40", titel: "Gesamtprüfung und Veröffentlichung", text: "Alle sechs Level durchgespielt, das Live-Duell gegen eine nachgebaute Claude-Umgebung getestet, die ganze Seite in vier Ansichten durchgeklickt. Dann online und ins Repository." }
  ];
})();
