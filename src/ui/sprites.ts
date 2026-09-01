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
  elites: Record<string, Sprite>;
  bosses: Record<string, Sprite>;
  events: Record<string, Sprite>;
  rest: Record<string, Sprite>;
  treasure: Record<string, Sprite>;
}

const SPRITES = spritesJson as unknown as SpritesFile;

export const MAX_UNIT_HEIGHT = 10;
export const MAX_ELITE_HEIGHT = 11;
export const MAX_BOSS_HEIGHT = 15;

export const CLASS_SPRITES: Record<string, Sprite> = SPRITES.classes;
export const MONSTER_SPRITES: Record<string, Sprite> = SPRITES.monsters;
export const ELITE_SPRITES: Record<string, Sprite> = SPRITES.elites;
export const BOSS_SPRITES: Record<string, Sprite> = SPRITES.bosses;
export const EVENT_SPRITES: Record<string, Sprite> = SPRITES.events;
export const REST_SPRITES: Record<string, Sprite> = SPRITES.rest;
export const TREASURE_SPRITES: Record<string, Sprite> = SPRITES.treasure;

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

// Sourced from data/sprites.json (edit via the sprite editor tool's "rest"/"treasure" categories)
// rather than hardcoded here, so they're actually reachable from the visual editor.
export const CAMPFIRE_SPRITE: Sprite = REST_SPRITES["campfire"]!;
export const TREASURE_CHEST_SPRITE: Sprite = TREASURE_SPRITES["chest"]!;

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

export function spriteForEvent(eventId: string): Sprite | null {
  return EVENT_SPRITES[eventId] ?? null;
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

export function renderSpriteInSlot(sprite: Sprite, slotHeight: number, slotWidth: number): TextChunk[][] {
  const h = spriteHeight(sprite);
  const w = spriteWidth(sprite);
  const topPad = Math.max(0, slotHeight - h);
  const topCrop = Math.max(0, h - slotHeight);
  const leftPad = Math.max(0, Math.floor((slotWidth - w) / 2));
  const rightPad = Math.max(0, slotWidth - w - leftPad);
  const leftCrop = Math.max(0, Math.floor((w - slotWidth) / 2));

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
      if (canvasRow >= slotHeight) continue;
      const row = sprite.rows[spriteRow]!;
      for (let c = 0; c < row.length; c++) {
        const ch = row[c]!;
        if (ch === ".") continue;
        buffer[canvasRow]![canvasStart + c] = bg(sprite.palette[ch]!)(" ") as TextChunk;
      }
    }
  });

  return buffer.map((row) => row.map((cell) => cell ?? plainChunk(" ")));
}

export const ALL_SPRITES: { name: string; sprite: Sprite; maxHeight: number }[] = [
  ...Object.entries(CLASS_SPRITES).map(([name, sprite]) => ({ name, sprite, maxHeight: MAX_UNIT_HEIGHT })),
  ...Object.entries(MONSTER_SPRITES).map(([name, sprite]) => ({ name, sprite, maxHeight: MAX_UNIT_HEIGHT })),
  ...Object.entries(ELITE_SPRITES).map(([name, sprite]) => ({ name: `${name}-elite`, sprite, maxHeight: MAX_ELITE_HEIGHT })),
  ...Object.entries(BOSS_SPRITES).map(([name, sprite]) => ({ name: `${name}-boss`, sprite, maxHeight: MAX_BOSS_HEIGHT })),
  ...Object.entries(EVENT_SPRITES).map(([name, sprite]) => ({ name: `${name}-event`, sprite, maxHeight: MAX_BOSS_HEIGHT })),
  ...Object.entries(REST_SPRITES).map(([name, sprite]) => ({ name: `${name}-rest`, sprite, maxHeight: MAX_BOSS_HEIGHT })),
  ...Object.entries(TREASURE_SPRITES).map(([name, sprite]) => ({ name: `${name}-treasure`, sprite, maxHeight: MAX_BOSS_HEIGHT })),
  { name: "tombstone", sprite: TOMBSTONE_SPRITE, maxHeight: MAX_BOSS_HEIGHT },
];
