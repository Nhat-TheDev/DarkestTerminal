import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "../dev-save-dump/args";

// SAVE_DIR is read when the engine is first imported, so it must be set before anything from src/ loads.
process.env.DARKEST_TERMINAL_SAVE_DIR = mkdtempSync(join(tmpdir(), "darkest-terminal-random-play-saves-"));
const { playRun } = await import("./bot");
const { ROOM_EVENT_IDS, screenLabel, writeEvidence } = await import("./evidence");
const { levelAt } = await import("./curve");
const { renderReport, summarizeRuns, guardLine } = await import("./report");
const { TEAMS } = await import("./team");
type ReportInput = import("./report").ReportInput;
type RunStats = import("./bot").RunStats;
type Scenario = import("./bot").Scenario;
type Team = import("./team").Team;

const evidence = process.argv.includes("--evidence");
const args = parseArgs(process.argv.slice(2).filter((a) => a !== "--evidence"));
const maxSteps = Number(args["max-steps"] ?? 5000);
const single = args["game-seed"] !== undefined;
const runsPerTeam = single ? 1 : Number(args.runs ?? 5);
const named = args.team === undefined ? null : TEAMS.find((t) => t.name.toLowerCase() === args.team!.toLowerCase());
if (named === undefined) throw new Error(`--team must be one of ${TEAMS.map((t) => t.name).join(", ")}, not "${args.team}"`);
const teams = named ? [named] : single ? TEAMS.slice(0, 1) : TEAMS;
// Evidence runs start where each screen is reached: every room event (each ends on its exit scene), a rest room, a temple, both guard tiers,
// a defeat and a fresh run with its opening scenes.
const EVENT_FLOOR = 12;
const levelOn = (depth: number) => Math.round(levelAt(depth));
const SCENARIOS: Scenario[] = [
  { name: "fresh run", depth: 1, level: 1, roomArg: "entry", fresh: true },
  { name: "rest room", depth: EVENT_FLOOR, level: levelOn(EVENT_FLOOR), roomArg: "rest", stopOnLeavingRoom: true },
  { name: "temple", depth: EVENT_FLOOR, level: levelOn(EVENT_FLOOR), roomArg: "temple", stopOnLeavingRoom: true },
  ...ROOM_EVENT_IDS.map((id) => ({ name: `event ${id}`, depth: EVENT_FLOOR, level: levelOn(EVENT_FLOOR), roomArg: "event", forceEventId: id, stopOnLeavingRoom: true })),
  { name: "elite guard", depth: 11, level: levelOn(11), roomArg: "boss" },
  { name: "boss guard", depth: 15, level: levelOn(15), roomArg: "boss" },
  { name: "defeat", depth: 95, level: 1, roomArg: "boss" },
];
const seedStart = Number(args["seed-start"] ?? 1);
// A scenario's seed and team come from its name, so adding or dropping an event leaves every other scenario's screens as they were.
const nameHash = (name: string) => createHash("sha1").update(name).digest().readUInt32BE(0);
const schedule: { team: Team; scenario?: Scenario; gameSeed?: number }[] = evidence
  ? SCENARIOS.map((scenario) => {
      const hash = nameHash(scenario.name);
      return { team: named ?? TEAMS[hash % TEAMS.length]!, scenario, gameSeed: seedStart + (hash % 1_000_000) };
    })
  : teams.flatMap((team) => Array.from({ length: runsPerTeam }, () => ({ team })));
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
  summary: summarizeRuns([]),
};
const runStats: RunStats[] = [];
const gallery = new Map<string, ReportInput["gallery"][number]>();
const startedAt = performance.now();

for (const [i, { team, scenario, gameSeed: scenarioSeed }] of schedule.entries()) {
  const gameSeed = single ? Number(args["game-seed"]) : (scenarioSeed ?? seedStart + i);
  const botSeed = single ? Number(args["bot-seed"] ?? gameSeed) : gameSeed * 7919 + 1;
  const result = await playRun({ gameSeed, botSeed, maxSteps, team, scenario });
  report.runs++;
  report.steps += result.steps;
  report.outcomes[result.outcome] = (report.outcomes[result.outcome] ?? 0) + 1;
  report.failures.push(...result.failures);
  report.warnings.push(...result.warnings);
  runStats.push(result.stats);
  for (const shot of result.gallery) {
    const key = `${screenLabel({ kind: shot.uiKind, event: shot.event, screenCase: shot.screenCase })}@${shot.size}`;
    const existing = gallery.get(key);
    if (existing) existing.count += shot.count;
    else gallery.set(key, shot);
  }
  console.log(`run ${i + 1}/${schedule.length}  ${team.name}  ${scenario ? `${scenario.name}  ` : ""}start ${result.stats.startDepth}  seeds ${gameSeed}/${botSeed}  ${result.steps} steps  ${result.outcome}  ${result.failures.length} failures`);
}

report.gallery = [...gallery.values()];

report.summary = summarizeRuns(runStats);
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

console.log(`\n${guardLine(report.summary)}`);
for (const t of report.summary.teams) {
  console.log(`  ${t.team}: ${t.runs} runs, ${t.rooms} rooms, guards ${t.wins}/${t.fights}, fear ${t.fear.toFixed(1)}, satiety ${t.satiety.toFixed(1)}`);
}
console.log(`\n${report.failures.length} failures, ${report.warnings.length} warnings, ${report.gallery.length} screens reached in ${report.durationSec.toFixed(0)} s`);
const outDir = evidence || reportMode === "html" ? (args.out ? resolve(args.out) : mkdtempSync(join(tmpdir(), "darkest-terminal-random-play-"))) : "";
if (evidence) {
  const manifest = writeEvidence(outDir, report.gallery, report.failures.length);
  console.log(`evidence: ${manifest.screens.length} screens in ${outDir}`);
}
if (reportMode === "html") {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.html"), renderReport(report));
  writeFileSync(join(outDir, "failures.json"), JSON.stringify(report.failures.map(({ frame: _frame, ...rest }) => rest), null, 2));
  console.log(`report: ${join(outDir, "report.html")}`);
}
process.exit(report.failures.length > 0 ? 1 : 0);
