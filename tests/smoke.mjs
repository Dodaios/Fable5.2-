// Opens the built index.html in headless Chromium and exercises the page.
// Needs Playwright (npm i -D playwright). Run: node build.mjs && node tests/smoke.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const url = pathToFileURL(fileURLToPath(new URL("../index.html", import.meta.url))).href;
const DEMOS = ["orbit", "sprache", "pfad", "daten", "musik", "shader"];

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
let checks = 0;
const check = (cond, msg) => { assert.ok(cond, msg); checks++; };

for (const view of [
  { name: "Desktop hell", width: 1280, height: 900, colorScheme: "light" },
  { name: "Desktop dunkel", width: 1280, height: 900, colorScheme: "dark" },
  { name: "Telefon hell", width: 390, height: 844, colorScheme: "light" },
  { name: "Telefon dunkel", width: 390, height: 844, colorScheme: "dark" },
]) {
  const page = await browser.newPage({ viewport: { width: view.width, height: view.height }, colorScheme: view.colorScheme });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.Werkschau && window.Werkschau.showDemo);

  check((await page.textContent("h1")).includes("Fable 5.2"), `${view.name}: Überschrift`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${view.name}: kein Querscrollen`);

  // every demo mounts, shows something, and can be torn down again
  for (const id of DEMOS) {
    await page.click(`#tab-${id}`);
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => {
      const stage = document.getElementById("demo-stage");
      return { text: stage.textContent, children: stage.querySelectorAll("*").length, title: document.getElementById("demo-title").textContent };
    });
    check(!state.text.includes("gestolpert"), `${view.name}: ${id} startet ohne Fehler`);
    check(state.children > 8, `${view.name}: ${id} zeigt Inhalt`);
    check(state.title.length > 2, `${view.name}: ${id} hat einen Titel`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${view.name}: ${id} ohne Querscrollen`);
  }

  // benchmark chart: eleven rows, table view carries the same numbers
  check((await page.locator("#bm .bm-row").count()) === 11, `${view.name}: elf Benchmark-Zeilen`);
  await page.click("#bm-toggle");
  check((await page.locator("#bm-table-wrap tbody tr").count()) === 11, `${view.name}: Tabellenansicht`);
  check((await page.textContent("#bm-table-wrap")).includes("41,3 %"), `${view.name}: Tabellenwerte`);
  await page.click("#bm-toggle");

  // cost calculator
  await page.click("#calc-presets button:nth-child(4)");
  const costs = await page.locator("#calc-out-list output").allTextContents();
  check(costs.join("|") === "$1,10|$22,00|$44,00|$88,00", `${view.name}: Kostenrechner 10.000 Tickets (${costs.join("|")})`);

  // Kompass
  check((await page.textContent("#kompass-a .k-model")) === "Opus 5.5", `${view.name}: Kompass startet bei Opus`);
  await page.check("#k-aufgabe-offen");
  check((await page.textContent("#kompass-a .k-model")) === "Fable 5.2", `${view.name}: offene Aufgabe → Fable`);
  await page.check("#k-aufgabe-masse");
  await page.check("#k-preis-sehr");
  check((await page.textContent("#kompass-a .k-model")) === "Haiku 5.5", `${view.name}: Masse + Preis → Haiku`);

  // Selbsttest outside an Artifact viewer: tasks can be copied, the live buttons stay hidden
  check((await page.locator("#duell-tasks button").count()) === 6, `${view.name}: sechs Aufgaben`);
  check((await page.inputValue("#duell-prompt")).includes("median"), `${view.name}: erste Aufgabe geladen`);
  check(await page.isHidden("#duell-go"), `${view.name}: Live-Knopf ohne Artifact verborgen`);
  await page.click("#duell-tasks button:nth-child(2)");
  check((await page.inputValue("#duell-prompt")).includes("Kotlin"), `${view.name}: Aufgabe wechseln`);

  check((await page.locator("#log li").count()) >= 5, `${view.name}: Protokoll gefüllt`);
  check(errors.length === 0, `${view.name}: keine Fehler in der Konsole (${errors.slice(0, 3).join(" | ")})`);
  await page.close();
}

await browser.close();
console.log(`ok (${checks} Prüfungen)`);
