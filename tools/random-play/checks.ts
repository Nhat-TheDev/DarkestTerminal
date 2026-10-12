import type { GameState } from "../../src/types";
import type { EngineContext } from "../../src/engine/combat";

/** One problem a check found. `detail` must not name the screen or seed — the report groups findings by `type` + `detail`. */
export interface Finding {
  type: string;
  detail: string;
}

const TEXT_LEAKS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bundefined\b/, label: "undefined" },
  { pattern: /\bNaN\b/, label: "NaN" },
  { pattern: /\bInfinity\b/, label: "Infinity" },
  { pattern: /\[object Object\]/, label: "[object Object]" },
  { pattern: /\{\{\w*\}?\}?/, label: "unfilled {{template}}" },
  { pattern: /\x1b/, label: "raw escape byte" },
  { pattern: /\[\d{1,3}(;\d{1,3})*m/, label: "raw ANSI color code" },
];

export function findTextLeaks(frame: string): Finding[] {
  return TEXT_LEAKS.filter(({ pattern }) => pattern.test(frame)).map(({ pattern, label }) => ({
    type: "textLeak",
    detail: `${label}: "${lineMatching(frame, pattern).trim()}"`,
  }));
}

export function findLongDecimals(frame: string): Finding[] {
  const pattern = /\d+\.\d{3,}/;
  if (!pattern.test(frame)) return [];
  return [{ type: "longDecimal", detail: `"${lineMatching(frame, pattern).trim()}"` }];
}

function lineMatching(frame: string, pattern: RegExp): string {
  return frame.split("\n").find((line) => pattern.test(line)) ?? "";
}

export function findInvariantViolations(state: GameState, ctx: EngineContext): Finding[] {
  const found: string[] = [];
  const checkNumber = (label: string, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) found.push(`${label} is ${value}`);
  };
  const checkPool = (label: string, current: number, max: number) => {
    if (current < 0 || current > max) found.push(`${label} ${current} outside 0..${max}`);
  };

  for (const c of state.party) {
    for (const key of ["hp", "maxHp", "mp", "maxMp", "attack", "defense", "magicPower", "aggro", "speed"] as const) checkNumber(`character.${key}`, c[key]);
    checkNumber("character.survival.fear", c.survival.fear);
    checkPool("character hp", c.hp, c.maxHp);
    checkPool("character mp", c.mp, c.maxMp);
    if (new Set(c.equippedArtifactIds).size !== c.equippedArtifactIds.length) found.push("a character has the same artifact equipped twice");
  }
  for (const m of ctx.monsters) {
    for (const key of ["hp", "maxHp", "attack", "defense", "speed"] as const) checkNumber(`monster.${key}`, m[key]);
    checkPool("monster hp", m.hp, m.maxHp);
  }
  for (const s of ctx.summons) {
    for (const key of ["hp", "maxHp", "attack", "defense", "magicPower", "speed"] as const) checkNumber(`summon.${key}`, s[key]);
    checkPool("summon hp", s.hp, s.maxHp);
  }
  if (new Set(ctx.summons.map((s) => s.id)).size !== ctx.summons.length) found.push("two summons share an id");

  const abilityIds = state.party.map((c) => c.equippedAbilityId).filter((id): id is string => !!id);
  if (new Set(abilityIds).size !== abilityIds.length) found.push("two characters carry the same Ability");

  checkNumber("coins", state.coins);
  checkNumber("satiety", state.satiety);
  if (state.coins < 0) found.push(`coins ${state.coins} below 0`);
  for (const count of Object.values(state.inventory)) {
    if (!Number.isInteger(count) || count < 0) found.push(`inventory count ${count} is not a whole number >= 0`);
  }
  if (!state.floor.rooms.some((r) => r.id === state.currentRoomId)) found.push("currentRoomId is not a room on this floor");
  if (state.gameOver !== null && state.combat !== null) found.push("run is over but a combat is still open");

  return [...new Set(found)].map((detail) => ({ type: "invariant", detail }));
}

/** What the footer advertises, read off the screen the way a player reads it. */
export interface FooterInfo {
  text: string;
  /** Keys a bot may press, as `mockInput.pressKey` names. Ctrl+C is left out. */
  keys: string[];
  /** Every digit any hint advertises (`[1-4]`, `[5]`). */
  digits: Set<number>;
  hasPaging: boolean;
  /** A `[` with no closing `]` — the footer was cut mid-token. */
  broken: boolean;
}

const BOX_CHARS = /^[┌└│├─┐┘]/;

/** The footer sits below the last panel: the trailing non-blank lines that don't start with a box border. */
export function footerText(frame: string): string {
  const lines = frame.split("\n").map((l) => l.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const footer: string[] = [];
  while (lines.length > 0 && lines[lines.length - 1] !== "" && !BOX_CHARS.test(lines[lines.length - 1]!)) footer.unshift(lines.pop()!.trim());
  return footer.join(" ");
}

export function parseFooter(text: string): FooterInfo {
  const keys = new Set<string>();
  const digits = new Set<number>();
  let hasPaging = false;
  for (const [, token] of text.matchAll(/\[([^\]]+)\]/g)) {
    const range = /^(\d)-(\d)$/.exec(token!);
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d++) digits.add(d);
    } else if (/^\d$/.test(token!)) {
      digits.add(Number(token));
    } else if (token === "Enter" || token === "Any") {
      keys.add("RETURN");
    } else if (token === "Esc") {
      keys.add("ESCAPE");
    } else if (token === "←/→") {
      hasPaging = true;
      keys.add("ARROW_LEFT");
      keys.add("ARROW_RIGHT");
    } else if (token!.length === 1) {
      keys.add(token!);
    }
  }
  for (const d of digits) keys.add(String(d));
  const lastOpen = text.lastIndexOf("[");
  return { text, keys: [...keys], digits, hasPaging, broken: lastOpen > text.lastIndexOf("]") };
}

/** What a keypress changed; A3 decides from this whether an advertised key did nothing or an unadvertised one did something. */
export interface KeyEffect {
  key: string;
  advertised: boolean;
  frameChanged: boolean;
  uiChanged: boolean;
  stateChanged: boolean;
  /** The save file was rewritten (Quicksave), which neither the frame nor the state shows. */
  saveWritten: boolean;
}

export function classifyKeyEffect(effect: KeyEffect, footer: FooterInfo): { failures: Finding[]; warnings: Finding[] } {
  const isDigit = /^\d$/.test(effect.key);
  if (effect.advertised) {
    const isPaging = effect.key === "ARROW_LEFT" || effect.key === "ARROW_RIGHT";
    if (isPaging || effect.frameChanged || effect.uiChanged || effect.stateChanged) return { failures: [], warnings: [] };
    if (effect.saveWritten) return { failures: [], warnings: [{ type: "noFeedback", detail: `[${effect.key}] saved the run but nothing on screen changed` }] };
    // A digit on a tab-like screen (characterInfo) may pick what is already picked, so it is only worth a look.
    const finding = { type: "deadKey", detail: `[${effect.key}] is advertised but pressing it changed nothing` };
    return isDigit ? { failures: [], warnings: [finding] } : { failures: [finding], warnings: [] };
  }
  if (isDigit && !footer.hasPaging && (effect.stateChanged || effect.uiChanged)) {
    const what = effect.stateChanged ? "changed the run" : "changed the screen";
    return { failures: [{ type: "hiddenKey", detail: `digit ${effect.key} is not in the footer but pressing it ${what}` }], warnings: [] };
  }
  return { failures: [], warnings: [] };
}

/** The always-available global hint every footer ends with — if it is visible, nothing to its left was cut. */
export const LAST_GLOBAL_HINT = "[Ctrl+C] Quit";

export function findFooterIssues(footer: FooterInfo): Finding[] {
  if (footer.text === "") return [{ type: "missingFooter", detail: "no footer row below the panels" }];
  const found: Finding[] = [];
  if (!footer.text.includes(LAST_GLOBAL_HINT)) found.push({ type: "footerTruncated", detail: `footer does not reach ${LAST_GLOBAL_HINT}` });
  if (footer.broken) found.push({ type: "footerTruncated", detail: "footer ends inside a [key] token" });
  return found;
}

/** Panels that must be on screen, and how many content rows the main (choices) panel must keep. */
export interface LayoutRequirement {
  panelTitles: string[];
  mainPanelTitle: string;
  minMainRows: number;
}

export function findLayoutIssues(frame: string, req: LayoutRequirement): { failures: Finding[]; warnings: Finding[] } {
  const failures: Finding[] = [];
  const lines = frame.split("\n");
  for (const title of req.panelTitles) {
    if (!lines.some((l) => l.includes(`─${title}`))) failures.push({ type: "panelMissing", detail: `panel "${title}" is not on screen` });
  }
  const mainRows = panelContentRows(lines, req.mainPanelTitle);
  if (mainRows !== null && mainRows < req.minMainRows) {
    failures.push({ type: "panelMissing", detail: `panel "${req.mainPanelTitle}" has ${mainRows} content rows (needs ${req.minMainRows})` });
  }
  const warnings: Finding[] = lines.some((l) => /[A-Za-z0-9]│/.test(l))
    ? [{ type: "possibleClip", detail: "text touches a panel's right border" }]
    : [];
  return { failures, warnings };
}

/** Rows inside the border of the panel titled `title`, or null when it is not on screen. */
export function panelContentRows(lines: string[], title: string): number | null {
  const top = lines.findIndex((l) => l.includes(`─${title}`));
  if (top < 0) return null;
  const col = lines[top]!.indexOf(`─${title}`) - 1;
  let rows = 0;
  for (let i = top + 1; i < lines.length && lines[i]![col] === "│"; i++) rows++;
  return rows;
}
