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
  passive: "#9b7ad1",
  fearCalm: "#8a9a6a",
  fearUneasy: "#d1a23a",
  fearPanic: "#d1702a",
  fearBroken: "#c0392b",
  dead: "#6a5a52",
  disabled: "#5a5248",
  chipFg: "#12100c",
  markerDamageParty: "#e5484d",
  markerDamageMonster: "#f2f2f2",
  markerHealParty: "#8fd694",
  markerHealMonster: "#3c9a4a",
} as const;

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
  item: { icon: "◆", color: PALETTE.title },
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
