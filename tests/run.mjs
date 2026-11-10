// Runs every logic test (no browser needed): node tests/run.mjs
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [dir + f], { encoding: "utf8" });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${f}`);
  if (!ok) console.log((r.stdout + r.stderr).trim().split("\n").slice(-12).join("\n"));
}
console.log(failed ? `${failed} von ${files.length} fehlgeschlagen` : `alle ${files.length} Testdateien bestanden`);
process.exit(failed ? 1 : 0);
