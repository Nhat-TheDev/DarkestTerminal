import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "../dev-save-dump/args";

// SAVE_DIR is read when the engine is first imported, so it must be set before anything from src/ loads.
process.env.DARKEST_TERMINAL_SAVE_DIR = mkdtempSync(join(tmpdir(), "darkest-terminal-random-play-saves-"));
const { playRun } = await import("./bot");
const { renderReport } = await import("./report");
type ReportInput = import("./report").ReportInput;

const args = parseArgs(process.argv.slice(2));
const maxSteps = Number(args["max-steps"] ?? 2000);
const single = args["game-seed"] !== undefined;
const runs = single ? 1 : Number(args.runs ?? 20);
const seedStart = Number(args["seed-start"] ?? 1);
// "none" (CI) writes no files: the printed failures and exit code are the whole result.
const reportMode = args.report ?? "html";
if (reportMode !== "html" && reportMode !== "none") throw new Error(`--report must be html or none, not "${reportMode}"`);

const report: ReportInput = {
  generatedAt: new Date().toISOString(),
  runs: 0,
  steps: 0,
  durationSec: 0,
  outcomes: {},
  failures: [],
  warnings: [],
  gallery: [],
};
const gallery = new Map<string, ReportInput["gallery"][number]>();
const startedAt = performance.now();

for (let i = 0; i < runs; i++) {
  const gameSeed = single ? Number(args["game-seed"]) : seedStart + i;
  const botSeed = single ? Number(args["bot-seed"] ?? gameSeed) : gameSeed * 7919 + 1;
  const result = await playRun({ gameSeed, botSeed, maxSteps });
  report.runs++;
  report.steps += result.steps;
  report.outcomes[result.outcome] = (report.outcomes[result.outcome] ?? 0) + 1;
  report.failures.push(...result.failures);
  report.warnings.push(...result.warnings);
  for (const shot of result.gallery) {
    const key = `${shot.uiKind}@${shot.size}`;
    const existing = gallery.get(key);
    if (existing) existing.count += shot.count;
    else gallery.set(key, shot);
  }
  console.log(`run ${i + 1}/${runs}  seeds ${gameSeed}/${botSeed}  ${result.steps} steps  ${result.outcome}  ${result.failures.length} failures`);
}

report.gallery = [...gallery.values()];
report.durationSec = (performance.now() - startedAt) / 1000;

const groups = new Map<string, ReportInput["failures"]>();
for (const f of report.failures) {
  const key = `${f.type}: ${f.detail}`;
  groups.set(key, [...(groups.get(key) ?? []), f]);
}
for (const [key, found] of groups) {
  const first = found[0]!;
  console.log(`\nFAIL ${key}  (x${found.length})`);
  console.log(`  screens: ${[...new Set(found.map((f) => `${f.uiKind}@${f.size}`))].join(", ")}`);
  console.log(`  replay:  ${first.reproduce}`);
  if (first.stack) console.log(first.stack.split("\n").slice(0, 4).map((line) => `  ${line.trim()}`).join("\n"));
}

console.log(`\n${report.failures.length} failures, ${report.warnings.length} warnings, ${report.gallery.length} screens reached in ${report.durationSec.toFixed(0)} s`);
if (reportMode === "html") {
  const outDir = args.out ? resolve(args.out) : mkdtempSync(join(tmpdir(), "darkest-terminal-random-play-"));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.html"), renderReport(report));
  writeFileSync(join(outDir, "failures.json"), JSON.stringify(report.failures.map(({ frame: _frame, ...rest }) => rest), null, 2));
  console.log(`report: ${join(outDir, "report.html")}`);
}
process.exit(report.failures.length > 0 ? 1 : 0);
