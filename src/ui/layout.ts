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

/**
 * Last-resort label for an archetype nobody added to `MONSTER_STYLE`: the last hyphen-separated
 * word of the id, uppercased to 3 letters (`swamp-slime` -> `SLI`). Ugly, but it still names the
 * thing on screen — the previous `??` told the player nothing and hid the fact that half the
 * bestiary had drifted out of the style table. `MONSTER_STYLE` coverage is asserted in
 * `test/sprites.test.ts`, so reaching this is a test failure, not a silent shrug.
 */
function derivedAbbr(archetypeId: string): string {
  const lastWord = archetypeId.split("-").pop() ?? archetypeId;
  return lastWord.slice(0, 3).toUpperCase();
}

export function monsterStyle(m: Monster): { abbr: string; color: string } {
  if (m.tier === "boss") return { abbr: "BOSS", color: BOSS_COLOR };
  if (m.tier === "elite") return { abbr: "ELITE", color: ELITE_COLOR };
  return MONSTER_STYLE[m.archetypeId] ?? { abbr: derivedAbbr(m.archetypeId), color: PALETTE.dim };
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "…";
}

/** Greedy word wrap. Words longer than `width` get their own line rather than being cut — nothing
    on these panels is long enough for that to matter, and losing characters would be worse. */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter((w) => w.length > 0)) {
    if (current.length === 0) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [""];
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
