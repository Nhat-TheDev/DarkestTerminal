import { StyledText, fg, bg, bold, type TextChunk } from "@opentui/core";
import type { LogEntryKind } from "../types";

export const PALETTE = {
  bg: "#100d0a",
  panelBg: "#171310",
  border: "#4a3a2a",
  borderAccent: "#8a5a2a",
  text: "#d8cbb0",
  dim: "#8a7d68",
  title: "#c9a227",
  hpHigh: "#5fa85f",
  hpMid: "#d1a23a",
  hpLow: "#c0392b",
  mp: "#5b8fc9",
  fearCalm: "#8a9a6a",
  fearUneasy: "#d1a23a",
  fearPanic: "#d1702a",
  fearBroken: "#c0392b",
  dead: "#6a5a52",
  disabled: "#5a5248",
  chipFg: "#12100c",
} as const;

export const CLASS_STYLE: Record<string, { abbr: string; color: string }> = {
  vanguard: { abbr: "VG", color: "#5b7fa6" },
  mage: { abbr: "MG", color: "#7a52a3" },
  rogue: { abbr: "RG", color: "#b5892c" },
  acolyte: { abbr: "AC", color: "#a8901a" },
  viking: { abbr: "VK", color: "#8a4a2a" },
  "plague-doctor": { abbr: "PD", color: "#3a4a3a" },
};

export const MONSTER_STYLE: Record<string, { abbr: string; color: string }> = {
  "dungeon-rat": { abbr: "RAT", color: "#7a5230" },
  "black-bat": { abbr: "BAT", color: "#5a4778" },
  slime: { abbr: "SLM", color: "#4a8a3a" },
  skeleton: { abbr: "SKL", color: "#c9c2b0" },
  zombie: { abbr: "ZMB", color: "#5a7a3a" },
  snake: { abbr: "SNK", color: "#3a7a4a" },
  lizard: { abbr: "LIZ", color: "#4a8a5a" },
  spider: { abbr: "SPD", color: "#2a1a3a" },
  "skeleton-archer": { abbr: "ARC", color: "#c9c2b0" },
  "skeleton-warrior": { abbr: "WAR", color: "#8a8579" },
  "skeleton-guard": { abbr: "GRD", color: "#8a8579" },
  "giant-spider": { abbr: "GSP", color: "#4a1f3a" },
  dragon: { abbr: "DRG", color: "#8a2a1a" },
  "zombie-knight": { abbr: "ZKN", color: "#5a7a3a" },
  "dark-knight": { abbr: "DKN", color: "#3a2a4a" },
  goblin: { abbr: "GOB", color: "#6b8442" },
  "goblin-shaman": { abbr: "GSH", color: "#7a9a4a" },
  "orc-brute": { abbr: "ORC", color: "#4e6b35" },
  "orc-chieftain": { abbr: "CHF", color: "#7a9a45" },
  "cultist-initiate": { abbr: "CLT", color: "#6a5a68" },
  "cultist-zealot": { abbr: "ZLT", color: "#8a3a40" },
  "ghoulish-crawler": { abbr: "CRW", color: "#7d8168" },
  "vampire-bat": { abbr: "VBT", color: "#7a3550" },
  "vampire-lord": { abbr: "VLD", color: "#b03040" },
  "toxic-toad": { abbr: "TOD", color: "#5c7a3d" },
  ghost: { abbr: "GHO", color: "#8e9fb5" },
  wraith: { abbr: "WTH", color: "#6a638a" },
  "skeleton-mage": { abbr: "SMG", color: "#5a4c8a" },
  "dire-wolf": { abbr: "WLF", color: "#6a6a74" },
  "swamp-slime": { abbr: "SSL", color: "#6a7f3a" },
  "fire-elemental": { abbr: "FIR", color: "#d05a18" },
  "water-elemental": { abbr: "WTR", color: "#4a90a8" },
  gargoyle: { abbr: "GRG", color: "#7a746a" },
  "armored-beetle": { abbr: "BTL", color: "#7a6c55" },
  "cave-bear": { abbr: "BER", color: "#8a6440" },
  "lesser-golem": { abbr: "GOL", color: "#7a746c" },
  "ancient-golem": { abbr: "AGL", color: "#9a938a" },
  mimic: { abbr: "MIM", color: "#8a5a2e" },
  "void-amalgamation": { abbr: "VOI", color: "#b060d8" },
  lich: { abbr: "LCH", color: "#7aa88a" },
  "the-founder": { abbr: "FDR", color: "#8a7690" },
};

export const BOSS_COLOR = "#8a1f1f";
export const ELITE_COLOR = "#c9a227";

export function plainChunk(text: string): TextChunk {
  return { __isChunk: true, text } as TextChunk;
}

export function colorChunk(text: string, color: string): TextChunk {
  return fg(color)(text) as TextChunk;
}

export function boldColorChunk(text: string, color: string): TextChunk {
  return fg(color)(bold(text)) as TextChunk;
}

export function chip(label: string, color: string): TextChunk {
  return bg(color)(fg(PALETTE.chipFg)(bold(` ${label} `))) as TextChunk;
}

/** Splits `text` on `[...]` segments (e.g. "[Esc]", "[i]"), rendering each bracketed key hint bold in the accent color and everything else dim — used for footer/hint lines that call out specific keys. */
export function highlightKeyHints(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  const pattern = /\[[^\]]+\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) chunks.push(colorChunk(text.slice(lastIndex, match.index), PALETTE.dim));
    chunks.push(boldColorChunk(match[0], PALETTE.title));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) chunks.push(colorChunk(text.slice(lastIndex), PALETTE.dim));
  return chunks;
}

export function hpColorFor(hp: number, maxHp: number): string {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio > 0.6) return PALETTE.hpHigh;
  if (ratio > 0.3) return PALETTE.hpMid;
  return PALETTE.hpLow;
}

export function progressBar(current: number, max: number, width: number, filledColor: string, emptyColor: string = PALETTE.disabled): TextChunk[] {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  const filledLen = Math.round(ratio * width);
  const emptyLen = width - filledLen;
  const chunks: TextChunk[] = [];
  if (filledLen > 0) chunks.push(colorChunk("█".repeat(filledLen), filledColor));
  if (emptyLen > 0) chunks.push(colorChunk("░".repeat(emptyLen), emptyColor));
  return chunks;
}

export function fearColorFor(tier: number): string {
  switch (tier) {
    case 1:
      return PALETTE.fearCalm;
    case 2:
      return PALETTE.fearUneasy;
    case 3:
      return PALETTE.fearPanic;
    default:
      return PALETTE.fearBroken;
  }
}

export const LOG_KIND_STYLE: Record<LogEntryKind, { icon: string; color: string }> = {
  attack: { icon: "⚔", color: PALETTE.hpLow },
  heal: { icon: "✚", color: PALETTE.hpHigh },
  buff: { icon: "↑", color: PALETTE.mp },
  debuff: { icon: "↓", color: PALETTE.fearPanic },
  item: { icon: "🎒", color: PALETTE.title },
  death: { icon: "☠", color: PALETTE.dead },
  info: { icon: "·", color: PALETTE.dim },
};

export function joinLines(lines: TextChunk[][]): StyledText {
  const chunks: TextChunk[] = [];
  lines.forEach((line, i) => {
    if (i > 0) chunks.push(plainChunk("\n"));
    chunks.push(...line);
  });
  return new StyledText(chunks);
}
