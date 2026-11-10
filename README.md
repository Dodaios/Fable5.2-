# Fable 5.2 Werkschau

Eine Selbstvorstellung zum Anfassen: sechs Demos, ein Vergleich von Fable 5.2 mit Opus 5.5
und ein Kompass, der sagt, wann welches Claude-Modell passt.

Die ganze Seite ist **eine einzige HTML-Datei** ohne fremde Bibliotheken.

## Ansehen

Öffne `index.html` im Browser. Ein Doppelklick genügt, es braucht keinen Server.

| Abschnitt | Inhalt |
|---|---|
| Vorstellung | Steckbrief, was in 5.2 neu ist, wofür das Modell gedacht ist, was man wissen sollte |
| Demos | Sechs Arbeitsproben, alle im Browser berechnet (siehe unten) |
| Vergleich | Fable 5.2 gegen Opus 5.5: Tabelle, Anthropics veröffentlichte Benchmarks, Kostenrechner |
| Kompass | Vier Fragen, eine Modellempfehlung, dazu Spickzettel und Denkstufen |
| Selbsttest | Sechs Aufgaben mit Lösungshinweisen, um beide Modelle selbst zu vergleichen |
| Werkstatt | Wie die Seite entstanden ist, Quellen |

### Die sechs Demos

| Demo | Zeigt | Quelltext |
|---|---|---|
| Sternpost | Schwerkraft-Puzzle mit exakt wiederholbarer Physik, sechs geprüft lösbare Level | `src/js/demos/orbit.js` |
| Fabel | Eine kleine Programmiersprache mit deutschen Schlüsselwörtern: Lexer, Parser, Interpreter | `src/js/demos/sprache.js` |
| Wegfinder | Zwei Suchalgorithmen im Wettlauf auf derselben Karte | `src/js/demos/pfad.js` |
| Datenblick | CSV einfügen, Auswertung bekommen: Statistik, Diagramme, Befunde in Klartext | `src/js/demos/daten.js` |
| Taktwerk | Step-Sequencer mit Kompositions-Algorithmus, alle Klänge synthetisiert | `src/js/demos/musik.js` |
| Lichtgestalt | Handgeschriebener WebGL-Shader (Raymarching) | `src/js/demos/shader.js` |

### Live-Duell und Vorlesen

Zwei Funktionen brauchen Claude selbst und laufen deshalb nur, wenn die Seite als Artifact
in Claude geöffnet ist: das Live-Duell (dieselbe Aufgabe gleichzeitig an beide Modelle) und
das Vorlesen der Vorstellung. In der lokalen Datei bietet der Selbsttest stattdessen die
Aufgaben zum Kopieren an.

## Aufbau

```
index.html        die gebaute Seite, direkt zu öffnen
build.mjs         baut index.html aus src/ (ohne Abhängigkeiten)
src/page.html     Inhalt und Struktur
src/styles.css    Farben, Schriften, gemeinsame Bausteine
src/css/          Layout der Seite und je eine Datei pro Demo
src/js/core.js    gemeinsame Helfer und die Demo-Schnittstelle
src/js/data.js    Preise, Benchmarks, Kompass-Regel, Aufgaben
src/js/demos/     die sechs Demos, jede eine eigenständige Datei
tests/            Prüfungen für die Logik und ein Browser-Durchlauf
```

Jede Demo meldet sich mit `Werkschau.register(id, { title, kind, lead, facts, moral, mount })`
an und baut ihre Oberfläche in das Element, das `mount` bekommt. `tests/harness.html?demo=<id>`
zeigt eine Demo einzeln.

## Bauen und prüfen

```bash
node build.mjs
```

```bash
node tests/run.mjs
```

Der Browser-Durchlauf braucht Playwright:

```bash
node tests/smoke.mjs
```

## Woher die Zahlen stammen

- Positionierung, Benchmarks, Schutzmaßnahmen: <https://www.anthropic.com/claude/fable>
- Preise, Kontextfenster, Denkstufen, Wissensstand: <https://platform.claude.com/docs/en/about-claude/models/overview>

Abgerufen am 10.11.2026. Die Benchmarks hat Anthropic gemessen, sie wurden hier nicht
nachgemessen. Preise und Messwerte können sich ändern.

Das ist keine offizielle Seite von Anthropic.
