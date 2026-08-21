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
