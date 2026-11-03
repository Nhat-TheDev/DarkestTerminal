import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "../dev-save-dump/args";

// SAVE_DIR is read when the engine is first imported, so it must be set before anything from src/ loads.
process.env.DARKEST_TERMINAL_SAVE_DIR = mkdtempSync(join(tmpdir(), "darkest-terminal-random-play-saves-"));
const { playRun } = await import("./bot");
const { renderReport, summarizeRuns, guardLine } = await import("./report");
const { TEAMS } = await import("./team");
const { checkCurve, checkGuardWinRate, requiredGuardWinRate, survivalOnTarget } = await import("./curve");
type ReportInput = import("./report").ReportInput;
type RunStats = import("./bot").RunStats;
type Finding = import("./checks").Finding;

const args = parseArgs(process.argv.slice(2));
const maxSteps = Number(args["max-steps"] ?? 5000);
const single = args["game-seed"] !== undefined;
const runsPerTeam = single ? 1 : Number(args.runs ?? 5);
const named = args.team === undefined ? null : TEAMS.find((t) => t.name.toLowerCase() === args.team!.toLowerCase());
if (named === undefined) throw new Error(`--team must be one of ${TEAMS.map((t) => t.name).join(", ")}, not "${args.team}"`);
const teams = named ? [named] : single ? TEAMS.slice(0, 1) : TEAMS;
const schedule = teams.flatMap((team) => Array.from({ length: runsPerTeam }, () => team));
const seedStart = Number(args["seed-start"] ?? 1);
// "none" (CI) writes no files: the printed failures and exit code are the whole result.
const reportMode = args.report ?? "html";
if (reportMode !== "html" && reportMode !== "none") throw new Error(`--report must be html or none, not "${reportMode}"`);
const curveMode = args.curve ?? "on";
if (curveMode !== "on" && curveMode !== "off") throw new Error(`--curve must be on or off, not "${curveMode}"`);

const report: ReportInput = {
  generatedAt: new Date().toISOString(),
  runs: 0,
  steps: 0,
  durationSec: 0,
  outcomes: {},
  failures: [],
  warnings: [],
  gallery: [],
  curve: [],
  summary: summarizeRuns([]),
  requiredWinRate: requiredGuardWinRate(false),
  survivalOnTarget: false,
};
const runStats: RunStats[] = [];
const gallery = new Map<string, ReportInput["gallery"][number]>();
const startedAt = performance.now();

for (const [i, team] of schedule.entries()) {
  const gameSeed = single ? Number(args["game-seed"]) : seedStart + i;
  const botSeed = single ? Number(args["bot-seed"] ?? gameSeed) : gameSeed * 7919 + 1;
  const result = await playRun({ gameSeed, botSeed, maxSteps, team });
  report.runs++;
  report.steps += result.steps;
  report.outcomes[result.outcome] = (report.outcomes[result.outcome] ?? 0) + 1;
  report.failures.push(...result.failures);
  report.warnings.push(...result.warnings);
  runStats.push(result.stats);
  for (const shot of result.gallery) {
    const key = `${shot.uiKind}@${shot.size}`;
    const existing = gallery.get(key);
    if (existing) existing.count += shot.count;
    else gallery.set(key, shot);
  }
  console.log(`run ${i + 1}/${schedule.length}  ${team.name}  start ${result.stats.startDepth}  seeds ${gameSeed}/${botSeed}  ${result.steps} steps  ${result.outcome}  ${result.failures.length} failures`);
}

report.gallery = [...gallery.values()];

/** Findings about a whole command rather than a moment in one run. */
const commandFindings = (findings: Finding[]): ReportInput["failures"] =>
  findings.map((f) => ({ ...f, uiKind: "command", size: "-", gameSeed: seedStart, botSeed: 0, start: "-", recentSteps: [], frame: null, reproduce: `bun run random-play ${process.argv.slice(2).join(" ")}`.trim() }));

report.summary = summarizeRuns(runStats);
report.survivalOnTarget = survivalOnTarget(report.summary.survival);
report.requiredWinRate = requiredGuardWinRate(report.survivalOnTarget);
if (!single) {
  report.failures.push(...commandFindings(checkGuardWinRate(report.summary.guards, report.survivalOnTarget)));
  if (curveMode === "on") {
    const curve = checkCurve();
    report.curve = curve.rows;
    report.failures.push(...commandFindings(curve.findings));
  }
}
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

console.log(`\n${guardLine(report)}`);
for (const t of report.summary.teams) {
  console.log(`  ${t.team}: ${t.runs} runs, ${t.rooms} rooms, guards ${t.wins}/${t.fights}, fear ${t.fear.toFixed(1)}, satiety ${t.satiety.toFixed(1)}`);
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
