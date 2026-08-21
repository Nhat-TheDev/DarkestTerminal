// Pixel-art sprites for the battlefield panel.
//
// A "pixel" here = 1 terminal cell (a space character with a background
// color) — see docs/gameplay-decisions.md-style rationale in the darkest-
// terminal README. Characters/monsters top out at 10 pixels tall, bosses at
// 13 (both hard limits the user specified). Sprite width is a free design
// choice; humanoids use 9 cols, the boss uses 11 for extra presence.
//
// The actual pixel grids live in ../../data/sprites.json (loaded below) so
// they can be tweaked without touching TypeScript. Each sprite is a grid of
// rows (equal-length strings); every character is either '.' (transparent —
// shows the panel background) or a key into that sprite's own `palette`
// (char -> hex color). test/sprites.test.ts asserts row-length/height/
// palette consistency so a JSON typo fails loudly instead of silently
// misrendering.

import { bg, type TextChunk } from "@opentui/core";
import { plainChunk } from "./theme";
import type { MonsterTier } from "../types";
import spritesJson from "../../data/sprites.json";

export interface Sprite {
  rows: string[];
  palette: Record<string, string>;
}

interface SpritesFile {
  classes: Record<string, Sprite>;
  monsters: Record<string, Sprite>;
  /**
   * 1 sprite per tier per archetype that can actually spawn as elite/boss
   * guard (has both eliteSkillIds and bossSkillIds — see src/data/floor.ts's
   * GUARD_ROOM_ARCHETYPES). Visual weight steps up normal -> elite -> boss.
   */
  elites: Record<string, Sprite>;
  bosses: Record<string, Sprite>;
}

const SPRITES = spritesJson as unknown as SpritesFile;

export const MAX_UNIT_HEIGHT = 10;
export const MAX_ELITE_HEIGHT = 11;
export const MAX_BOSS_HEIGHT = 13;

export const CLASS_SPRITES: Record<string, Sprite> = SPRITES.classes;
export const MONSTER_SPRITES: Record<string, Sprite> = SPRITES.monsters;
export const ELITE_SPRITES: Record<string, Sprite> = SPRITES.elites;
export const BOSS_SPRITES: Record<string, Sprite> = SPRITES.bosses;

/** Shown in place of a unit's own sprite once it's defeated (character, monster, elite, or boss alike). */
export const TOMBSTONE_SPRITE: Sprite = {
  rows: [
    ".............",
    "....GGG......",
    "....GIIG.....",
    "...GICCIG....",
    "...GIIIIG....",
    "...GIIIIG....",
    "...GGGGGG....",
    "..MMMMMMMMM..",
    ".MMMMMMMMMMM.",
  ],
  palette: {
    G: "#5a5248",
    I: "#8a8074",
    C: "#332e28",
    M: "#3a4a2a",
  },
};

/** Shown on the enemy side of the battlefield while the party is in a rest room. */
export const CAMPFIRE_SPRITE: Sprite = {
  rows: [
    ".............",
    "......Y......",
    ".....YOY.....",
    "....YOOOY....",
    "...ROOOOOR...",
    "....RRRRR....",
    "...BB...BB...",
    "..BB.....BB..",
    ".............",
  ],
  palette: {
    Y: "#f2c14e",
    O: "#e2711d",
    R: "#b23a1f",
    B: "#5a3a22",
  },
};

export function spriteForClass(classId: string): Sprite {
  const sprite = CLASS_SPRITES[classId];
  if (!sprite) throw new Error(`No sprite for class: ${classId}`);
  return sprite;
}

export function spriteForMonster(archetypeId: string, tier: MonsterTier): Sprite {
  const table = tier === "boss" ? BOSS_SPRITES : tier === "elite" ? ELITE_SPRITES : MONSTER_SPRITES;
  const sprite = table[archetypeId];
  if (!sprite) throw new Error(`No ${tier} sprite for monster archetype: ${archetypeId}`);
  return sprite;
}

export function spriteWidth(sprite: Sprite): number {
  return sprite.rows[0]?.length ?? 0;
}

export function spriteHeight(sprite: Sprite): number {
  return sprite.rows.length;
}

function renderSpriteRow(sprite: Sprite, rowIndex: number): TextChunk[] {
  const row = sprite.rows[rowIndex];
  if (!row) return [];
  const chunks: TextChunk[] = [];
  for (const ch of row) {
    chunks.push(ch === "." ? plainChunk(" ") : (bg(sprite.palette[ch]!)(" ") as TextChunk));
  }
  return chunks;
}

/**
 * Renders `sprite` bottom-aligned and horizontally centered inside a
 * `slotHeight` x `slotWidth` cell box (always returns exactly `slotHeight`
 * lines of exactly `slotWidth` cells) — lets a short creature and the tall
 * boss share one visual "ground line" when placed side by side.
 */
export function renderSpriteInSlot(sprite: Sprite, slotHeight: number, slotWidth: number): TextChunk[][] {
  const h = spriteHeight(sprite);
  const w = spriteWidth(sprite);
  const topPad = Math.max(0, slotHeight - h);
  const topCrop = Math.max(0, h - slotHeight); // sprite taller than slot: bottom-aligned, so drop overflow rows from the top
  const leftPad = Math.max(0, Math.floor((slotWidth - w) / 2));
  const rightPad = Math.max(0, slotWidth - w - leftPad);
  const leftCrop = Math.max(0, Math.floor((w - slotWidth) / 2)); // sprite wider than slot: crop centered, mirroring leftPad's centering

  const lines: TextChunk[][] = [];
  for (let i = 0; i < topPad; i++) lines.push([plainChunk(" ".repeat(slotWidth))]);
  for (let r = topCrop; r < h; r++) {
    const row: TextChunk[] = [];
    if (leftPad > 0) row.push(plainChunk(" ".repeat(leftPad)));
    row.push(...renderSpriteRow(sprite, r).slice(leftCrop, leftCrop + slotWidth));
    if (rightPad > 0) row.push(plainChunk(" ".repeat(rightPad)));
    lines.push(row);
  }
  return lines;
}

/**
 * Composites `sprites` side by side into 1 bottom-aligned block of exactly
 * `slotHeight` rows — 1 nominal `slotWidth`-cell slot per sprite, `gap` blank
 * columns between slot edges. Unlike renderSpriteInSlot, a sprite wider than
 * `slotWidth` is NOT clamped: it's centered on its own slot (same rounding
 * as renderSpriteInSlot) and allowed to bleed into neighboring slots. Where
 * 2 sprites' opaque pixels overlap, the sprite later in the array always
 * wins (painted last) — so on the battlefield the rightmost unit in a row is
 * always shown in full, and an oversized sprite can partially cover its left
 * neighbor instead of corrupting the layout.
 */
export function compositeSpriteRow(sprites: Sprite[], slotWidth: number, slotHeight: number, gap: number): TextChunk[][] {
  if (sprites.length === 0) return Array.from({ length: slotHeight }, () => []);

  const starts = sprites.map((sprite, i) => {
    const nominalStart = i * (slotWidth + gap);
    const offset = Math.floor((slotWidth - spriteWidth(sprite)) / 2);
    return nominalStart + offset;
  });
  const ends = sprites.map((sprite, i) => starts[i]! + spriteWidth(sprite));
  const shift = -Math.min(0, ...starts);
  const canvasWidth = Math.max(...ends) + shift;

  const buffer: (TextChunk | null)[][] = Array.from({ length: slotHeight }, () => new Array(canvasWidth).fill(null));

  sprites.forEach((sprite, i) => {
    const h = spriteHeight(sprite);
    const topPad = Math.max(0, slotHeight - h);
    const canvasStart = starts[i]! + shift;
    for (let spriteRow = 0; spriteRow < h; spriteRow++) {
      const canvasRow = topPad + spriteRow;
      if (canvasRow >= slotHeight) continue; // sprite taller than the slot — a separate concern from width overflow
      const row = sprite.rows[spriteRow]!;
      for (let c = 0; c < row.length; c++) {
        const ch = row[c]!;
        if (ch === ".") continue; // transparent — don't cover whatever another sprite already painted there
        buffer[canvasRow]![canvasStart + c] = bg(sprite.palette[ch]!)(" ") as TextChunk;
      }
    }
  });

  return buffer.map((row) => row.map((cell) => cell ?? plainChunk(" ")));
}

// Derived from whatever data/sprites.json actually contains, so a newly
// added class/monster sprite is automatically covered by
// test/sprites.test.ts without also having to update this list by hand.
export const ALL_SPRITES: { name: string; sprite: Sprite; maxHeight: number }[] = [
  ...Object.entries(CLASS_SPRITES).map(([name, sprite]) => ({ name, sprite, maxHeight: MAX_UNIT_HEIGHT })),
  ...Object.entries(MONSTER_SPRITES).map(([name, sprite]) => ({ name, sprite, maxHeight: MAX_UNIT_HEIGHT })),
  ...Object.entries(ELITE_SPRITES).map(([name, sprite]) => ({ name: `${name}-elite`, sprite, maxHeight: MAX_ELITE_HEIGHT })),
  ...Object.entries(BOSS_SPRITES).map(([name, sprite]) => ({ name: `${name}-boss`, sprite, maxHeight: MAX_BOSS_HEIGHT })),
  { name: "tombstone", sprite: TOMBSTONE_SPRITE, maxHeight: MAX_BOSS_HEIGHT },
  { name: "campfire", sprite: CAMPFIRE_SPRITE, maxHeight: MAX_BOSS_HEIGHT },
];
