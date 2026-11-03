import { TextAttributes, type CapturedFrame } from "@opentui/core";
import type { RunStats } from "./bot";
import type { GuardTally, GuardTier, SurvivalTally } from "./curve";

type Rgba = [number, number, number, number];

export interface FrameSpan {
  text: string;
  fg: Rgba;
  bg: Rgba;
  attributes: number;
}

/** A screen as captured, copied out of the renderer's buffers so it survives the next render. */
export interface FrameCapture {
  cols: number;
  rows: number;
  lines: FrameSpan[][];
}

export function toFrameCapture(frame: CapturedFrame): FrameCapture {
  return {
    cols: frame.cols,
    rows: frame.rows,
    lines: frame.lines.map((line) => line.spans.map((s) => ({ text: s.text, fg: s.fg.toInts(), bg: s.bg.toInts(), attributes: s.attributes }))),
  };
}

export interface ReportFinding {
  type: string;
  detail: string;
  uiKind: string;
  size: string;
  gameSeed: number;
  botSeed: number;
  start: string;
  recentSteps: string[];
  stack?: string;
  frame: FrameCapture | null;
  reproduce: string;
}

export interface GalleryEntry {
  uiKind: string;
  /** The event room the screen shows, if any. */
  event: string | null;
  /** The case it is drawn in: a combat tier, a fight's outcome, a reward or an empty one. */
  screenCase: string | null;
  size: string;
  count: number;
  frame: FrameCapture;
}

export interface TeamRow {
  team: string;
  runs: number;
  rooms: number;
  fear: number;
  satiety: number;
  wins: number;
  fights: number;
  itemsUsed: number;
  starvedTurns: number;
}

export interface FloorRow {
  depth: number;
  tier: GuardTier;
  wins: number;
  fights: number;
}

export interface RunSummary {
  guards: GuardTally;
  survival: SurvivalTally;
  teams: TeamRow[];
  floors: FloorRow[];
}

export function summarizeRuns(runs: RunStats[]): RunSummary {
  const summary: RunSummary = { guards: { elite: { fights: 0, wins: 0 }, boss: { fights: 0, wins: 0 } }, survival: { samples: 0, fear: 0, satiety: 0 }, teams: [], floors: [] };
  const teams = new Map<string, TeamRow & { samples: number }>();
  const floors = new Map<number, FloorRow>();
  for (const run of runs) {
    const team = teams.get(run.team) ?? { team: run.team, runs: 0, rooms: 0, fear: 0, satiety: 0, wins: 0, fights: 0, itemsUsed: 0, starvedTurns: 0, samples: 0 };
    teams.set(run.team, team);
    team.runs++;
    team.rooms += run.rooms;
    team.itemsUsed += run.itemsUsed;
    team.starvedTurns += run.starvedTurns;
    team.samples += run.samples.length;
    for (const { fear, satiety } of run.samples) {
      team.fear += fear;
      team.satiety += satiety;
      summary.survival.samples++;
      summary.survival.fear += fear;
      summary.survival.satiety += satiety;
    }
    for (const { depth, tier, won } of run.guards) {
      const floor = floors.get(depth) ?? { depth, tier, wins: 0, fights: 0 };
      floors.set(depth, floor);
      for (const row of [floor, team, summary.guards[tier]]) {
        row.fights++;
        if (won) row.wins++;
      }
    }
  }
  summary.teams = [...teams.values()]
    .map(({ samples, ...row }) => ({ ...row, fear: row.fear / Math.max(1, samples), satiety: row.satiety / Math.max(1, samples) }))
    .sort((a, b) => a.team.localeCompare(b.team));
  summary.floors = [...floors.values()].sort((a, b) => a.depth - b.depth);
  return summary;
}

export interface ReportInput {
  generatedAt: string;
  runs: number;
  steps: number;
  durationSec: number;
  outcomes: Record<string, number>;
  failures: ReportFinding[];
  warnings: ReportFinding[];
  gallery: GalleryEntry[];
  summary: RunSummary;
}

export const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const css = ([r, g, b, a]: Rgba) => `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;

export function spansToHtml(frame: FrameCapture): string {
  const rows = frame.lines.map((line) =>
    line
      .map((s) => {
        const style = [`color:${css(s.fg)}`];
        if (s.bg[3] > 0) style.push(`background:${css(s.bg)}`);
        if (s.attributes & TextAttributes.BOLD) style.push("font-weight:700");
        if (s.attributes & TextAttributes.UNDERLINE) style.push("text-decoration:underline");
        if (s.attributes & TextAttributes.DIM) style.push("opacity:.6");
        return `<span style="${style.join(";")}">${escapeHtml(s.text)}</span>`;
      })
      .join("")
  );
  return `<pre class="term">${rows.join("\n")}</pre>`;
}

interface FindingGroup {
  type: string;
  detail: string;
  occurrences: ReportFinding[];
}

function groupFindings(findings: ReportFinding[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const f of findings) {
    const key = `${f.type}|${f.detail}`;
    const group = groups.get(key) ?? { type: f.type, detail: f.detail, occurrences: [] };
    group.occurrences.push(f);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.occurrences.length - a.occurrences.length);
}

function findingCard(group: FindingGroup, tone: "fail" | "warn"): string {
  const example = group.occurrences[0]!;
  const screens = [...new Set(group.occurrences.map((o) => `${o.uiKind} @ ${o.size}`))];
  return `<details class="card ${tone}">
  <summary><span class="tag">${escapeHtml(group.type)}</span> ${escapeHtml(group.detail)} <span class="count">×${group.occurrences.length}</span></summary>
  <p class="meta">Screens: ${screens.map(escapeHtml).join(", ")}</p>
  <p class="meta">First seen: game seed ${example.gameSeed}, bot seed ${example.botSeed}, start ${escapeHtml(example.start)}</p>
  <pre class="cmd">${escapeHtml(example.reproduce)}</pre>
  ${example.stack ? `<pre class="stack">${escapeHtml(example.stack)}</pre>` : ""}
  <p class="meta">Last steps (oldest first):</p>
  <pre class="steps">${escapeHtml(example.recentSteps.join("\n"))}</pre>
  ${example.frame ? spansToHtml(example.frame) : ""}
</details>`;
}

export function table(headers: string[], rows: (string | number)[][]): string {
  if (rows.length === 0) return '<p class="none">None.</p>';
  const cells = (tag: string, row: (string | number)[]) => `<tr>${row.map((c) => `<${tag}>${escapeHtml(String(c))}</${tag}>`).join("")}</tr>`;
  return `<table>${cells("th", headers)}${rows.map((r) => cells("td", r)).join("")}</table>`;
}

const rate = (wins: number, fights: number) => (fights === 0 ? "-" : `${wins}/${fights} (${Math.round((wins / fights) * 100)}%)`);

export function guardLine(summary: RunSummary): string {
  const { guards, survival } = summary;
  const tiers = (Object.keys(guards) as GuardTier[]).map((tier) => `${tier} ${rate(guards[tier].wins, guards[tier].fights)}`);
  const samples = Math.max(1, survival.samples);
  return `guards: ${tiers.join(", ")}; average highest fear ${(survival.fear / samples).toFixed(1)}, satiety ${(survival.satiety / samples).toFixed(1)}`;
}

/** A dev tool's HTML page in the shared dark theme; `css` adds to the base styles. */
export function htmlPage(title: string, css: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg:#14110f; --text:#d8cfc4; --dim:#8a8077; --line:#3a332d; }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--text); font:14px/1.5 system-ui, sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:16px; margin:32px 0 12px; border-bottom:1px solid var(--line); padding-bottom:6px; }
  .meta { color:var(--dim); margin:6px 0; } .none { color:var(--dim); }
  table { border-collapse:collapse; } th, td { border:1px solid var(--line); padding:3px 8px; text-align:right; } th:first-child, td:first-child { text-align:left; }
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function renderReport(input: ReportInput): string {
  const failureGroups = groupFindings(input.failures);
  const warningGroups = groupFindings(input.warnings);
  const gallery = [...input.gallery].sort((a, b) => a.count - b.count || a.uiKind.localeCompare(b.uiKind));
  const kinds = [...new Set(gallery.map((g) => g.uiKind))].sort();
  const sizes = [...new Set(gallery.map((g) => g.size))];
  const outcomes = Object.entries(input.outcomes).map(([k, v]) => `${escapeHtml(k)} ${v}`).join(" · ");

  return htmlPage(
    "Random-play report",
    `  :root { --panel:#1e1a17; --fail:#c0473a; --warn:#c9973a; }
  .card { background:var(--panel); border-left:3px solid var(--line); margin:8px 0; padding:8px 12px; }
  .card.fail { border-left-color:var(--fail); } .card.warn { border-left-color:var(--warn); }
  summary { cursor:pointer; } .tag { font-family:monospace; font-weight:700; } .count { color:var(--dim); }
  pre { overflow-x:auto; } .cmd, .stack, .steps { background:#0e0c0a; padding:8px; font-size:12px; }
  .term { font:12px/1.2 Menlo, Consolas, "DejaVu Sans Mono", monospace; background:#0b0908; padding:8px; display:inline-block; max-width:100%; }
  .filters { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
  .shot { margin:16px 0; } .shot h3 { font-size:14px; margin:0 0 4px; font-family:monospace; }`,
    `<h1>Random-play report</h1>
<p class="meta">${escapeHtml(input.generatedAt)} · ${input.runs} runs · ${input.steps} steps · ${input.durationSec.toFixed(0)} s · ${outcomes}</p>

<h2>Teams</h2>
<p class="meta">${escapeHtml(guardLine(input.summary))}</p>
${table(
  ["Team", "Runs", "Rooms", "Avg highest fear", "Avg satiety", "Guards won", "Items used", "Low-MP basic attacks"],
  input.summary.teams.map((t) => [t.team, t.runs, t.rooms, t.fear.toFixed(1), t.satiety.toFixed(1), rate(t.wins, t.fights), t.itemsUsed, t.starvedTurns])
)}

<h2>Guard floors</h2>
${table(["Floor", "Tier", "Won"], input.summary.floors.map((f) => [f.depth, f.tier, rate(f.wins, f.fights)]))}

<h2>Failures (${failureGroups.length} kinds, ${input.failures.length} total)</h2>
${failureGroups.map((g) => findingCard(g, "fail")).join("\n") || '<p class="none">None.</p>'}

<h2>Warnings (${warningGroups.length} kinds, ${input.warnings.length} total)</h2>
${warningGroups.map((g) => findingCard(g, "warn")).join("\n") || '<p class="none">None.</p>'}

<h2>Gallery (${gallery.length} screens, rarest first)</h2>
<div class="filters">
  <label>Screen <select id="kind"><option value="">all</option>${kinds.map((k) => `<option>${escapeHtml(k)}</option>`).join("")}</select></label>
  <label>Size <select id="size"><option value="">all</option>${sizes.map((s) => `<option>${escapeHtml(s)}</option>`).join("")}</select></label>
</div>
${gallery
  .map(
    (g) => `<section class="shot" data-kind="${escapeHtml(g.uiKind)}" data-size="${escapeHtml(g.size)}">
  <h3>${escapeHtml([g.uiKind, g.event, g.screenCase].filter(Boolean).join(" · "))} @ ${escapeHtml(g.size)} <span class="count">seen ${g.count}×</span></h3>
  ${spansToHtml(g.frame)}
</section>`
  )
  .join("\n")}
<script>
  const kind = document.getElementById("kind"), size = document.getElementById("size");
  const apply = () => document.querySelectorAll(".shot").forEach((el) => {
    el.hidden = (kind.value && el.dataset.kind !== kind.value) || (size.value && el.dataset.size !== size.value);
  });
  kind.addEventListener("change", apply); size.addEventListener("change", apply);
</script>`
  );
}
