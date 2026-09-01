import type { TextChunk } from "@opentui/core";
import type { Monster } from "../types";
import { PALETTE, MONSTER_STYLE, BOSS_COLOR, ELITE_COLOR, plainChunk } from "./theme";
import { MAX_BOSS_HEIGHT } from "./sprites";

export const SLOT_WIDTH = 13;
export const SLOT_GAP = 2;
export const DIVIDER_WIDTH = 3;
export const EMPTY_ENEMY_WIDTH = 30;
export const UNIT_BLOCK_HEIGHT = MAX_BOSS_HEIGHT + 3;

export function centerText(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const pad = width - text.length;
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + text + " ".repeat(pad - left);
}

export function monsterStyle(m: Monster): { abbr: string; color: string } {
  if (m.tier === "boss") return { abbr: "BOSS", color: BOSS_COLOR };
  if (m.tier === "elite") return { abbr: "ELITE", color: ELITE_COLOR };
  return MONSTER_STYLE[m.archetypeId] ?? { abbr: "??", color: PALETTE.dim };
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "…";
}

export function mergeBlocksHorizontally(blocks: TextChunk[][][], gapWidth: number): TextChunk[][] {
  const lineCount = blocks[0]?.length ?? 0;
  const merged: TextChunk[][] = [];
  for (let i = 0; i < lineCount; i++) {
    const line: TextChunk[] = [];
    blocks.forEach((block, idx) => {
      if (idx > 0) line.push(plainChunk(" ".repeat(gapWidth)));
      line.push(...(block[i] ?? []));
    });
    merged.push(line);
  }
  return merged;
}
