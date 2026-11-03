// Turns `bun run curve` output into the pull request comment: the check result, and every change
// from the base branch's own run.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "../dev-save-dump/args";
import { getClass } from "../../src/data/classes";
import { TEAMS, type Team } from "../random-play/team";
import { compareToBaseline, findCurveIssues, rowKey, type BenchRow } from "./bench";

export interface CurveRun {
  label: string;
  rows: BenchRow[];
}

const HARDEST_SHOWN = 5;
/** The comment's first line, so CI finds and edits this comment rather than another bot comment. */
export const CURVE_MARKER = "<!-- guard-curve -->";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pctPrecise = (x: number) => `${(x * 100).toFixed(1)}%`;
const signed = (x: number, digits = 0) => {
  const shown = Math.abs(x).toFixed(digits);
  return `${Number(shown) === 0 ? "±" : x > 0 ? "+" : "−"}${shown}`;
};
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

/** One line of the Teams table: means over every guard; a figure an older run did not record is undefined. */
interface TeamSummary {
  winRate: number;
  hpLost?: number;
  deaths?: number;
  rounds?: number;
  hardest: string;
}

const meanOf = (xs: (number | undefined)[]) => (xs.some((x) => x === undefined) ? undefined : mean(xs as number[]));

function summarize(rows: { key: string; winRate: number; hpLost?: number; deaths?: number; roundsMedian?: number }[]): TeamSummary {
  const hardest = [...rows].sort((a, b) => a.winRate - b.winRate)[0];
  return {
    winRate: mean(rows.map((r) => r.winRate)),
    hpLost: meanOf(rows.map((r) => r.hpLost)),
    deaths: meanOf(rows.map((r) => r.deaths)),
    rounds: meanOf(rows.filter((r) => r.winRate > 0).map((r) => r.roundsMedian)),
    hardest: hardest ? `${hardest.key} (${pct(hardest.winRate)})` : "-",
  };
}

/** "All guards" first, then each team, from one run's rows. */
function teamSummaries(rows: BenchRow[]): Map<string, TeamSummary> {
  const out = new Map([["All guards", summarize(rows.map((r) => ({ ...r, key: rowKey(r) })))]]);
  for (const name of new Set(rows.flatMap((r) => r.teams.map((t) => t.team)))) {
    out.set(name, summarize(rows.flatMap((r) => r.teams.filter((t) => t.team === name).map((t) => ({ ...t, key: rowKey(r) })))));
  }
  return out;
}

/** A value on the base and on the PR, with the change in points. */
const moved = (before: number, now: number, format: (x: number) => string, scale = 100, digits = 0) =>
  `${format(before)} → ${format(now)} (${signed((now - before) * scale, digits)})`;

/** A value on the base and on the PR, with the change; just the PR's value when the base lacks it. */
function cell(before: number | undefined, now: number | undefined, format: (x: number) => string, scale = 100, digits = 0): string {
  if (now === undefined) return "-";
  if (before === undefined) return format(now);
  return moved(before, now, format, scale, digits);
}

function teamsSection(head: CurveRun, base: CurveRun | null, teams: Team[]): string[] {
  const [now, before] = [teamSummaries(head.rows), base ? teamSummaries(base.rows) : new Map<string, TeamSummary>()];
  const rows = [...new Set([...now.keys(), ...before.keys()])].map((name) => {
    const [b, n] = [before.get(name), now.get(name)];
    return [
      name,
      cell(b?.winRate, n?.winRate, pctPrecise, 100, 1),
      cell(b?.hpLost, n?.hpLost, pct),
      cell(b?.deaths, n?.deaths, (x) => x.toFixed(2), 1, 2),
      cell(b?.rounds, n?.rounds, (x) => String(Math.round(x)), 1),
      n?.hardest ?? "-",
    ];
  });
  const members = teams
    .filter((t) => now.has(t.name))
    .map((t) => `- **${t.name}**: ${t.members.map((m) => `${getClass(m.classId).name} (${m.roles.join(", ")})`).join(", ")}`);
  return [
    "",
    "### Teams",
    "",
    table(["Team", "Win", "HP lost", "Deaths", "Rounds (median)", "Hardest guard"], rows),
    "",
    "HP lost, deaths and rounds are means over every guard; rounds count fights won.",
    ...(members.length > 0 ? ["", "Members:", "", ...members] : []),
  ];
}

export function curveComment(head: CurveRun, base: CurveRun | null, findings: string[], teams: Team[] = TEAMS): string {
  const fights = head.rows.reduce((total, r) => total + r.fights, 0);
  const out = [
    CURVE_MARKER,
    "## Guard curve",
    "",
    `**Check: ${findings.length === 0 ? "passed" : `${findings.length} failure${findings.length === 1 ? "" : "s"}`}** · ${head.rows.length} guards · ${fights} fights · this PR ${head.label}${base ? ` vs base ${base.label}` : ""}`,
  ];
  if (findings.length > 0) out.push("", ...findings.map((f) => `- ${f}`));

  if (!base) out.push("", "The base branch has no `bun run curve`, so there is nothing to compare against.");
  out.push(...teamsSection(head, base, teams));

  if (base) {
    const changes = compareToBaseline(head.rows, base.rows);
    const notable = changes.filter((c) => c.notable);
    out.push("", `### Guards whose win rate moved more than 5 points (${notable.length})`);
    if (notable.length === 0) out.push("", "None.");
    else {
      out.push("", table(["Guard", "Win", "HP lost", "Rounds (median)"], notable.map((c) =>
        !c.now || !c.before
          ? [c.key, c.now ? `new, ${pct(c.now.winRate)}` : `gone, was ${pct(c.before!.winRate)}`, "-", "-"]
          : [c.key, moved(c.before.winRate, c.now.winRate, pct), moved(c.before.hpLost, c.now.hpLost, pct), moved(c.before.roundsMedian, c.now.roundsMedian, String, 1)]
      )));
    }
    out.push("", "The base is measured with its own code, so a change to the team policy or the bench shows here as well as a balance change.");
  }

  const hardest = [...head.rows].sort((a, b) => a.winRate - b.winRate).slice(0, HARDEST_SHOWN);
  out.push("", "### Hardest guards on this PR", "", table(["Guard", "Win", "95% interval", "HP lost"], hardest.map((r) => [rowKey(r), pct(r.winRate), `${pct(r.winLow)}–${pct(r.winHigh)}`, pct(r.hpLost)])));

  const baseRow = new Map((base?.rows ?? []).map((r) => [rowKey(r), r]));
  const all = head.rows.map((r) => {
    const b = baseRow.get(rowKey(r));
    return b
      ? [rowKey(r), moved(b.winRate, r.winRate, pct), moved(b.hpLost, r.hpLost, pct), moved(b.roundsMedian, r.roundsMedian, String, 1)]
      : [rowKey(r), pct(r.winRate), pct(r.hpLost), r.roundsMedian];
  });
  out.push("", "<details><summary>All guards</summary>", "", table(["Guard", "Win", "HP lost", "Rounds (median)"], all), "", "</details>", "");
  return out.join("\n");
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const read = (path: string) => JSON.parse(readFileSync(resolve(path), "utf8")).rows as BenchRow[];
  if (!args.head || !args.out) throw new Error("usage: --head curve.json [--base curve.json] [--head-label X] [--base-label Y] --out comment.md");
  const head: CurveRun = { label: args["head-label"] ?? "", rows: read(args.head) };
  const base: CurveRun | null = args.base && existsSync(resolve(args.base)) ? { label: args["base-label"] ?? "", rows: read(args.base) } : null;
  const findings = findCurveIssues(head.rows, read(join(import.meta.dir, "baseline.json")));
  writeFileSync(resolve(args.out), curveComment(head, base, findings));
}
