// Pixel-art sprites for the battlefield panel.
//
// A "pixel" here = 1 terminal cell (a space character with a background
// color) — see docs/gameplay-decisions.md-style rationale in the darkest-
// terminal README. Characters/monsters top out at 10 pixels tall, bosses at
// 13 (both hard limits the user specified). Sprite width is a free design
// choice; humanoids use 9 cols, the boss uses 11 for extra presence.
//
// Each sprite is a grid of rows (equal-length strings). Every character is
// either '.' (transparent — shows the panel background) or a key into that
// sprite's own `palette` (char -> hex color). test/sprites.test.ts asserts
// row-length/height/palette consistency so a typo here fails loudly instead
// of silently misrendering.

import { bg, type TextChunk } from "@opentui/core";
import { plainChunk } from "./theme";

export interface Sprite {
  rows: string[];
  palette: Record<string, string>;
}

export const MAX_UNIT_HEIGHT = 10;
export const MAX_BOSS_HEIGHT = 13;

// ---------------------------------------------------------------------------
// Party classes (9 wide, 10 tall)
// ---------------------------------------------------------------------------

export const VANGUARD_SPRITE: Sprite = {
  rows: [
    "..HHHHH..",
    ".HSSSSSH.",
    ".HSSSSSH.",
    "WAAAAAAA.",
    "WABBBBAA.",
    "WABBBBAA.",
    ".AA.B.AA.",
    "..LL.LL..",
    "..LL.LL..",
    "..LL.LL..",
  ],
  palette: {
    H: "#2a3540",
    S: "#c9a27a",
    A: "#5b7fa6",
    B: "#3d5a78",
    L: "#2a2420",
    W: "#8fb0d6",
  },
};

export const SHADOW_MAGE_SPRITE: Sprite = {
  rows: [
    "....H..W.",
    "...HHH.W.",
    "..SSSSSW.",
    ".AAAAAAW.",
    ".ABBBBAW.",
    ".ABBBBAW.",
    ".AAAAAAA.",
    "AAAAAAAAA",
    "BBBBBBBBB",
    "BBBBBBBBB",
  ],
  palette: {
    H: "#2a1f3a",
    S: "#c9a27a",
    A: "#7a52a3",
    B: "#5a3a7a",
    W: "#b5892c",
  },
};

export const ROGUE_SPRITE: Sprite = {
  rows: [
    "...HHH...",
    ".HHHHHHH.",
    ".HHHHHHH.",
    ".AAAAAAA.",
    ".ABBBBAW.",
    ".AA.B.AA.",
    ".AA.B.AA.",
    "..LL.LL..",
    "..LL.LL..",
    "..LL.LL..",
  ],
  palette: {
    H: "#2a2015",
    A: "#b5892c",
    B: "#8a6a1e",
    L: "#2a2420",
    W: "#c9c2b0",
  },
};

export const CHAPLAIN_SPRITE: Sprite = {
  rows: [
    "..HHHHH..",
    ".HSSSSSH.",
    ".HSSSSSH.",
    ".AAAAAAA.",
    ".ABBWBBA.",
    ".ABBBBBA.",
    ".AAAAAAA.",
    "AAAAAAAAA",
    "AAAAAAAAA",
    "BBBBBBBBB",
  ],
  palette: {
    H: "#8a7050",
    S: "#c9a27a",
    A: "#a8901a",
    B: "#c9b04a",
    W: "#f0e6c8",
  },
};

export const CLASS_SPRITES: Record<string, Sprite> = {
  vanguard: VANGUARD_SPRITE,
  "shadow-mage": SHADOW_MAGE_SPRITE,
  rogue: ROGUE_SPRITE,
  chaplain: CHAPLAIN_SPRITE,
};

// ---------------------------------------------------------------------------
// Monsters (9 wide, <=10 tall — small creatures don't need the full budget)
// ---------------------------------------------------------------------------

export const DUNGEON_RAT_SPRITE: Sprite = {
  rows: ["..E...E..", ".OOOOOOO.", "OOOOOOOOO", "OOOOOOOOO", ".OO.OO.T.", "..O...O.."],
  palette: {
    O: "#7a5230",
    E: "#4a3320",
    T: "#4a3320",
  },
};

export const BLACK_BAT_SPRITE: Sprite = {
  rows: ["W.......W", "WW.....WW", "WWW...WWW", ".WWWOWWW.", "..WOOOW..", "...OOO..."],
  palette: {
    W: "#5a4778",
    O: "#2a2038",
  },
};

export const SKELETON_GUARD_SPRITE: Sprite = {
  rows: [
    "..HHHHH..",
    ".HSSSSSH.",
    ".HS.S.SH.",
    ".AAAAAAW.",
    ".ABBBBAW.",
    ".ABBBBAW.",
    ".AA.B.AA.",
    "..LL.LL..",
    "..LL.LL..",
    "..LL.LL..",
  ],
  palette: {
    H: "#3a3830",
    S: "#c9c2b0",
    A: "#6a6558",
    B: "#4a473e",
    L: "#a8a294",
    W: "#8a7050",
  },
};

export const MONSTER_SPRITES: Record<string, Sprite> = {
  "dungeon-rat": DUNGEON_RAT_SPRITE,
  "black-bat": BLACK_BAT_SPRITE,
  "skeleton-guard": SKELETON_GUARD_SPRITE,
};

// ---------------------------------------------------------------------------
// Boss (11 wide, 13 tall — the elite "Đại Tướng" variant, see data/monsters.ts)
// ---------------------------------------------------------------------------

export const BOSS_SPRITE: Sprite = {
  rows: [
    ".C.C.C.C.C.",
    "..HHHHHHH..",
    ".HSSSSSSSH.",
    ".HS.E.E.SH.",
    ".HSSSSSSSH.",
    "BAAAAAAAAAW",
    "BABBBBBBBAW",
    "BABBBBBBBAW",
    ".AA.BBB.AA.",
    "..AA.B.AA..",
    "..LLL.LLL..",
    "..LLL.LLL..",
    "..LL...LL..",
  ],
  palette: {
    C: "#8a1f1f",
    H: "#3a1010",
    S: "#c9c2b0",
    E: "#ff3b3b",
    A: "#5a2020",
    B: "#8a1f1f",
    L: "#4a1515",
    W: "#c9a227",
  },
};

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

export const ALL_SPRITES: { name: string; sprite: Sprite; maxHeight: number }[] = [
  { name: "vanguard", sprite: VANGUARD_SPRITE, maxHeight: MAX_UNIT_HEIGHT },
  { name: "shadow-mage", sprite: SHADOW_MAGE_SPRITE, maxHeight: MAX_UNIT_HEIGHT },
  { name: "rogue", sprite: ROGUE_SPRITE, maxHeight: MAX_UNIT_HEIGHT },
  { name: "chaplain", sprite: CHAPLAIN_SPRITE, maxHeight: MAX_UNIT_HEIGHT },
  { name: "dungeon-rat", sprite: DUNGEON_RAT_SPRITE, maxHeight: MAX_UNIT_HEIGHT },
  { name: "black-bat", sprite: BLACK_BAT_SPRITE, maxHeight: MAX_UNIT_HEIGHT },
  { name: "skeleton-guard", sprite: SKELETON_GUARD_SPRITE, maxHeight: MAX_UNIT_HEIGHT },
  { name: "boss", sprite: BOSS_SPRITE, maxHeight: MAX_BOSS_HEIGHT },
];
