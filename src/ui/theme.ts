import { StyledText, fg, bg, bold, type TextChunk } from "@opentui/core";

// Dark "darkest dungeon"-ish palette. Used both for renderer/box chrome
// (hex strings passed straight to backgroundColor/borderColor) and for
// styled text chunks below.
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
  chipFg: "#12100c",
} as const;

export const CLASS_STYLE: Record<string, { abbr: string; color: string }> = {
  vanguard: { abbr: "CV", color: "#5b7fa6" },
  mage: { abbr: "PS", color: "#7a52a3" },
  rogue: { abbr: "ST", color: "#b5892c" },
  chaplain: { abbr: "TS", color: "#a8901a" },
};

export const MONSTER_STYLE: Record<string, { abbr: string; color: string }> = {
  "dungeon-rat": { abbr: "CH", color: "#7a5230" },
  "black-bat": { abbr: "DB", color: "#5a4778" },
  "skeleton-guard": { abbr: "XS", color: "#8a8579" },
};

export const BOSS_COLOR = "#8a1f1f";

export function plainChunk(text: string): TextChunk {
  return { __isChunk: true, text } as TextChunk;
}

export function colorChunk(text: string, color: string): TextChunk {
  return fg(color)(text) as TextChunk;
}

export function boldColorChunk(text: string, color: string): TextChunk {
  return fg(color)(bold(text)) as TextChunk;
}

/** A small colored "block" tile standing in for a character/monster sprite. */
export function chip(label: string, color: string): TextChunk {
  return bg(color)(fg(PALETTE.chipFg)(bold(` ${label} `))) as TextChunk;
}

export function hpColorFor(hp: number, maxHp: number): string {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio > 0.6) return PALETTE.hpHigh;
  if (ratio > 0.3) return PALETTE.hpMid;
  return PALETTE.hpLow;
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

/** Joins pre-built chunk arrays (1 per line) into a single StyledText, inserting real newlines between them. */
export function joinLines(lines: TextChunk[][]): StyledText {
  const chunks: TextChunk[] = [];
  lines.forEach((line, i) => {
    if (i > 0) chunks.push(plainChunk("\n"));
    chunks.push(...line);
  });
  return new StyledText(chunks);
}
