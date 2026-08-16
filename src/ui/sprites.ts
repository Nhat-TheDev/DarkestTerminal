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
import spritesJson from "../../data/sprites.json";

export interface Sprite {
  rows: string[];
  palette: Record<string, string>;
}

interface SpritesFile {
  classes: Record<string, Sprite>;
  monsters: Record<string, Sprite>;
  boss: Sprite;
}

const SPRITES = spritesJson as unknown as SpritesFile;

export const MAX_UNIT_HEIGHT = 10;
export const MAX_BOSS_HEIGHT = 13;

export const CLASS_SPRITES: Record<string, Sprite> = SPRITES.classes;
export const MONSTER_SPRITES: Record<string, Sprite> = SPRITES.monsters;
export const BOSS_SPRITE: Sprite = SPRITES.boss;

export function spriteForClass(classId: string): Sprite {
  const sprite = CLASS_SPRITES[classId];
  if (!sprite) throw new Error(`No sprite for class: ${classId}`);
  return sprite;
}

export function spriteForMonster(archetypeId: string, isBoss: boolean): Sprite {
  if (isBoss) return BOSS_SPRITE;
  const sprite = MONSTER_SPRITES[archetypeId];
  if (!sprite) throw new Error(`No sprite for monster archetype: ${archetypeId}`);
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
  const leftPad = Math.max(0, Math.floor((slotWidth - w) / 2));
  const rightPad = Math.max(0, slotWidth - w - leftPad);

  const lines: TextChunk[][] = [];
  for (let i = 0; i < topPad; i++) lines.push([plainChunk(" ".repeat(slotWidth))]);
  for (let r = 0; r < h; r++) {
    const row: TextChunk[] = [];
    if (leftPad > 0) row.push(plainChunk(" ".repeat(leftPad)));
    row.push(...renderSpriteRow(sprite, r));
    if (rightPad > 0) row.push(plainChunk(" ".repeat(rightPad)));
    lines.push(row);
  }
  return lines;
}

// Derived from whatever data/sprites.json actually contains, so a newly
// added class/monster sprite is automatically covered by
// test/sprites.test.ts without also having to update this list by hand.
export const ALL_SPRITES: { name: string; sprite: Sprite; maxHeight: number }[] = [
  ...Object.entries(CLASS_SPRITES).map(([name, sprite]) => ({ name, sprite, maxHeight: MAX_UNIT_HEIGHT })),
  ...Object.entries(MONSTER_SPRITES).map(([name, sprite]) => ({ name, sprite, maxHeight: MAX_UNIT_HEIGHT })),
  { name: "boss", sprite: BOSS_SPRITE, maxHeight: MAX_BOSS_HEIGHT },
];
