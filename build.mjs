// Builds the single-file page from src/.
//   index.html          standalone document: open it in any browser, or serve it from any static host
//   dist/artifact.html  the same page as a fragment, in the shape the Claude Artifact tool publishes
// No dependencies: node build.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const list = (dir, ext) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => f.endsWith(ext)).sort().map((f) => `${dir}/${f}`) : []);

const cssFiles = ["src/styles.css", "src/css/shell.css", ...list("src/css", ".css").filter((f) => f !== "src/css/shell.css")];
const demoFiles = list("src/js/demos", ".js");
const jsFiles = ["src/js/core.js", "src/js/data.js", ...demoFiles, "src/js/vergleich.js", "src/js/kompass.js", "src/js/duell.js", "src/js/shell.js"];
const testFiles = list("tests", ".mjs");

const countLines = (files) => files.reduce((n, f) => n + read(f).split("\n").length, 0);
const countChecks = (files) => files.reduce((n, f) => n + (read(f).match(/\bassert\b[.(]|\bcheck\(/g) || []).length, 0);
const sourceFiles = [...cssFiles, ...jsFiles, "src/page.html", "build.mjs", ...testFiles];
const stats = { lines: countLines(sourceFiles), files: sourceFiles.length, checks: countChecks(testFiles), demos: demoFiles.length };

const css = cssFiles.map((f) => `/* ${f} */\n${read(f)}`).join("\n");
// One <script> per source file, so a fault in one file cannot take the rest of the page down.
const tag = (code) => `<script>\n${code.replace(/<\/script/gi, "<\\/script")}\n</script>`;
const js = [tag(`window.Werkschau = window.Werkschau || {}; window.Werkschau.stats = ${JSON.stringify(stats)};`), ...jsFiles.map((f) => tag(`/* ${f} */\n${read(f)}`))].join("\n");

const page = read("src/page.html");
const headMatch = page.match(/<!--HEAD-->([\s\S]*?)<!--\/HEAD-->/);
if (!headMatch) throw new Error("src/page.html: HEAD markers missing");
const head = headMatch[1].replace("<!--CSS-->", () => `<style>\n${css}\n</style>`).trim();
const body = page.replace(headMatch[0], "").replace("<!--JS-->", () => js).trim();

const standalone = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%232336dc'/%3E%3Ccircle cx='16' cy='16' r='8' fill='%23ffc233'/%3E%3C/svg%3E">
${head}
</head>
<body>
${body}
</body>
</html>
`;
writeFileSync(join(root, "index.html"), standalone);
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/artifact.html"), `${head}\n${body}\n`);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`index.html ${kb(standalone)} · ${stats.files} Dateien · ${stats.lines} Zeilen · ${stats.checks} Prüfungen · ${stats.demos} Demos`);
