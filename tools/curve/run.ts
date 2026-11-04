import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "../dev-save-dump/args";

// SAVE_DIR is read when the engine is first imported, so it must be set before anything from src/ loads.
process.env.DARKEST_TERMINAL_SAVE_DIR = mkdtempSync(join(tmpdir(), "darkest-terminal-curve-saves-"));
const { benchRow, compareToBaseline, findCurveIssues, guardCases, pct } = await import("./bench");
const { TEAMS } = await import("../random-play/team");
const { table, escapeHtml, htmlPage } = await import("../random-play/report");
type BenchRow = import("./bench").BenchRow;
type RowChange = import("./bench").RowChange;
type LevelPick = import("./bench").LevelPick;

const args = parseArgs(process.argv.slice(2).filter((a) => a !== "--check"));
const check = process.argv.includes("--check");
// The base's artifact is measured with the default options only, so a check compares like with like.
if (check && ["only", "tier", "teams", "level", "precision", "max-fights"].some((k) => k in args)) {
  throw new Error("--check runs every guard with the default options; drop the other flags");
}

const level = (args.level ?? "avg") as LevelPick;
if (!["min", "avg", "max"].includes(level)) throw new Error(`--level must be min, avg or max, not "${args.level}"`);
const tier = args.tier;
if (tier !== undefined && tier !== "elite" && tier !== "boss") throw new Error(`--tier must be elite or boss, not "${tier}"`);
const only = args.only?.split(",").map((s) => s.trim().toLowerCase());
const teams = args.teams === undefined ? TEAMS : args.teams.split(",").map((name) => {
  const team = TEAMS.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  if (!team) throw new Error(`--teams must name teams among ${TEAMS.map((t) => t.name).join(", ")}, not "${name}"`);
  return team;
});
const precision = Number(args.precision ?? 0.05);
const maxFights = Number(args["max-fights"] ?? 1000);
const baselinePath = args.baseline ? resolve(args.baseline) : null;
const baseline: BenchRow[] | null = baselinePath ? JSON.parse(readFileSync(baselinePath, "utf8")).rows : null;

const cases = guardCases().filter((c) => (!only || only.includes(c.id)) && (!tier || c.tier === tier));
if (cases.length === 0) throw new Error("no guard matches --only/--tier");

const startedAt = performance.now();
const rows: BenchRow[] = [];
for (const guard of cases) {
  const row = benchRow(guard, { teams, level, precision, maxFights });
  rows.push(row);
  const byTeam = row.teams.map((t) => `${t.team.slice(0, 3)} ${pct(t.winRate)}`).join("  ");
  console.log(
    `${row.id.padEnd(18)} ${row.tier.padEnd(5)} floor ${String(row.depth).padStart(3)} L${String(row.level).padStart(3)}  ` +
      `win ${pct(row.winRate).padStart(4)} [${pct(row.winLow)}-${pct(row.winHigh)}] n=${row.fights}  ` +
      `rounds ${row.roundsMedian} (${row.roundsP10}-${row.roundsP90})  hp lost ${pct(row.hpLost)}  deaths ${row.deaths.toFixed(2)}  | ${byTeam}`
  );
}
const durationSec = (performance.now() - startedAt) / 1000;
const fights = rows.reduce((total, r) => total + r.fights, 0);
console.log(`\n${rows.length} guards, ${fights} fights in ${durationSec.toFixed(0)} s`);

const changes: RowChange[] | null = baseline ? compareToBaseline(rows, baseline).filter((c) => c.now || !only) : null;
if (changes) {
  const notable = changes.filter((c) => c.notable);
  console.log(`\nAgainst ${baselinePath}: ${notable.length} of ${changes.length} guards changed their win rate by more than 5 points`);
  for (const c of notable) {
    if (!c.now || !c.before) console.log(`  ${c.key}: ${c.now ? "new" : "gone"}`);
    else console.log(`  ${c.key}: win ${pct(c.before.winRate)} -> ${pct(c.now.winRate)}, hp lost ${c.hpLost >= 0 ? "+" : ""}${pct(c.hpLost)}, rounds ${c.roundsMedian >= 0 ? "+" : ""}${c.roundsMedian}`);
  }
}

const options = { level, precision, maxFights, teams: teams.map((t) => t.name), only: only ?? null, tier: tier ?? null };

const outDir = args.out ? resolve(args.out) : mkdtempSync(join(tmpdir(), "darkest-terminal-curve-"));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "curve.json"), JSON.stringify({ generatedAt: new Date().toISOString(), options, rows }, null, 2));
writeFileSync(
  join(outDir, "report.html"),
  htmlPage(
    "Guard curve",
    "  .wrap { overflow-x:auto; } th, td { white-space:nowrap; }",
    `<h1>Guard curve</h1>
<p class="meta">${escapeHtml(new Date().toISOString())} · ${rows.length} guards · ${fights} fights · ${durationSec.toFixed(0)} s · level ${level} · teams ${escapeHtml(options.teams.join(", "))}</p>
<p class="meta">Real engine fights from full HP with the starting items and no artifacts, played by the random-play team policy. Rounds count won fights only.</p>
${changes ? `<h2>Against baseline</h2><div class="wrap">${table(
    ["Guard", "Win before", "Win now", "Hp lost change", "Rounds change"],
    changes.filter((c) => c.notable).map((c) => [c.key, c.before ? pct(c.before.winRate) : "-", c.now ? pct(c.now.winRate) : "-", pct(c.hpLost), c.roundsMedian])
  )}</div>` : ""}
<h2>Guards</h2>
<div class="wrap">${table(
    ["Guard", "Tier", "Floor", "Level", "Fights", "Win", "95% interval", "Timed out", "Rounds p10", "Rounds median", "Rounds p90", "Hp lost", "Deaths", "Mp used", "Items used", ...teams.map((t) => t.name)],
    rows.map((r) => [r.id, r.tier, r.depth, r.level, r.fights, pct(r.winRate), `${pct(r.winLow)}-${pct(r.winHigh)}`, r.timedOut, r.roundsP10, r.roundsMedian, r.roundsP90, pct(r.hpLost), r.deaths.toFixed(2), pct(r.mpUsed), r.itemsUsed.toFixed(1), ...r.teams.map((t) => pct(t.winRate))])
  )}</div>`
  )
);
console.log(`report: ${join(outDir, "report.html")}\ndata:   ${join(outDir, "curve.json")}`);

if (check) {
  const findings = findCurveIssues(rows);
  for (const f of findings) console.log(`FAIL curve: ${f}`);
  console.log(`${findings.length} curve failures`);
  process.exit(findings.length > 0 ? 1 : 0);
}
process.exit(0);
