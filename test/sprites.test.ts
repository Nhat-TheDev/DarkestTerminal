import { describe, test, expect } from "bun:test";
import { RGBA } from "@opentui/core";
import { ALL_SPRITES, spriteWidth, spriteHeight, spriteForClass, spriteForMonster, renderSpriteInSlot, compositeSpriteRow, type Sprite } from "../src/ui/sprites";
import { CLASSES } from "../src/data/classes";
import { MONSTER_ARCHETYPES } from "../src/data/monsters";

describe("sprite dimensions and palette consistency", () => {
  for (const { name, sprite, maxHeight } of ALL_SPRITES) {
    test(`${name}: every row has the same width, declared by row 0`, () => {
      const width = spriteWidth(sprite);
      expect(width).toBeGreaterThan(0);
      for (const row of sprite.rows) {
        expect(row.length).toBe(width);
      }
    });

    test(`${name}: height is within the design limit (${maxHeight})`, () => {
      expect(spriteHeight(sprite)).toBeLessThanOrEqual(maxHeight);
      expect(spriteHeight(sprite)).toBeGreaterThan(0);
    });

    test(`${name}: every non-'.' character used has a palette entry`, () => {
      const used = new Set(sprite.rows.join("").split("").filter((c) => c !== "."));
      for (const c of used) {
        expect(sprite.palette[c]).toBeDefined();
      }
    });

    test(`${name}: palette colors are valid #rrggbb hex`, () => {
      for (const color of Object.values(sprite.palette)) {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });
  }

  test("every playable class has a sprite", () => {
    for (const cls of CLASSES) {
      expect(() => spriteForClass(cls.id)).not.toThrow();
    }
  });

  test("every monster archetype has a normal sprite", () => {
    for (const archetype of MONSTER_ARCHETYPES) {
      const normal = spriteForMonster(archetype.id, "normal");
      expect(spriteHeight(normal)).toBeLessThanOrEqual(10);
    }
  });

  test("every archetype that can actually spawn as elite/boss (has both skill kits — see GUARD_ROOM_ARCHETYPES in src/data/floor.ts) has its own distinct elite AND boss sprite", () => {
    const guardCapable = MONSTER_ARCHETYPES.filter((a) => a.eliteSkillIds && a.bossSkillIds);
    expect(guardCapable.length).toBeGreaterThan(0);
    for (const archetype of guardCapable) {
      const normal = spriteForMonster(archetype.id, "normal");
      const elite = spriteForMonster(archetype.id, "elite");
      const boss = spriteForMonster(archetype.id, "boss");
      expect(spriteHeight(elite)).toBeLessThanOrEqual(11);
      expect(spriteHeight(boss)).toBeLessThanOrEqual(13);
      // Each tier must be its own art, not a fallback to a shared/neighboring tier's sprite.
      const keys = new Set([normal, elite, boss].map((s) => JSON.stringify(s)));
      expect(keys.size).toBe(3);
    }
  });
});

describe("renderSpriteInSlot: bottom-aligned, centered, fixed-size output", () => {
  const dungeonRat = spriteForMonster("dungeon-rat", "normal");
  const boss = spriteForMonster("skeleton-guard", "boss"); // skeleton-guard is one of the archetypes with its own boss sprite

  test("always returns exactly slotHeight lines of exactly slotWidth cells, for a short and a tall sprite", () => {
    for (const sprite of [dungeonRat, boss]) {
      const lines = renderSpriteInSlot(sprite, 13, 11);
      expect(lines).toHaveLength(13);
      for (const line of lines) {
        const totalCells = line.reduce((sum, chunk) => sum + chunk.text.length, 0);
        expect(totalCells).toBe(11);
      }
    }
  });

  test("bottom-aligns: padding rows come first, so the top rows are blank and the bottom rows carry colored pixels", () => {
    // Pixels are conveyed via background color on space characters, not glyphs,
    // so "content" here means "has a bg color", not "has non-space text".
    const lines = renderSpriteInSlot(dungeonRat, 13, 11);
    const hasColor = (line: (typeof lines)[number]) => line.some((c) => c.bg !== undefined);
    expect(hasColor(lines[0]!)).toBe(false); // top padding row: fully transparent
    expect(hasColor(lines[12]!)).toBe(true); // sprite's own last row: has real pixels
  });
});

describe("compositeSpriteRow: overlap when a sprite is wider than its slot", () => {
  const solid = (char: string, width: number, color: string): Sprite => ({
    rows: [char.repeat(width)],
    palette: { [char]: color },
  });
  const isColor = (chunk: { bg?: RGBA }, hex: string) => chunk.bg !== undefined && chunk.bg.equals(RGBA.fromHex(hex));

  test("sprites that fit their slot behave like plain side-by-side concatenation", () => {
    const a = solid("A", 3, "#111111");
    const b = solid("B", 3, "#222222");
    const [row] = compositeSpriteRow([a, b], 3, 1, 1);
    // 3 cells of A, 1 blank gap cell, 3 cells of B — 7 cells total, no overlap.
    expect(row).toHaveLength(7);
    expect(row!.slice(0, 3).every((c) => isColor(c, "#111111"))).toBe(true);
    expect(row![3]!.bg).toBeUndefined(); // gap cell stays blank
    expect(row!.slice(4, 7).every((c) => isColor(c, "#222222"))).toBe(true);
  });

  test("an oversized sprite alone is centered on its own slot, bleeding equally on both sides", () => {
    const wide = solid("A", 7, "#111111"); // 4 cells wider than the slot
    const [row] = compositeSpriteRow([wide], 3, 1, 1);
    expect(row).toHaveLength(7); // no clamping — the sprite's own full width, centered (0 shift needed for a lone sprite)
  });

  test("where 2 sprites overlap, the later (rightmost) sprite's opaque pixels win", () => {
    const left = solid("A", 3, "#111111"); // slot 0: nominal columns [0,3)
    // slot 1 nominal start = 3 (gap 0); centered offset = floor((3-7)/2) = -2 → starts at column 1, overlapping left's columns 1-2.
    const rightWide = solid("B", 7, "#222222");
    const [row] = compositeSpriteRow([left, rightWide], 3, 1, 0);
    // column 2 is inside the overlap — the later sprite (B) must win there.
    expect(isColor(row![2]!, "#222222")).toBe(true);
    expect(isColor(row![0]!, "#111111")).toBe(true); // untouched left edge still shows the left sprite
  });

  test("a transparent pixel never covers what an earlier sprite already painted", () => {
    const left = solid("A", 3, "#111111"); // columns [0,3)
    // width 5, centered offset = floor((3-5)/2) = -1 → starts at column 2: its transparent 1st
    // column lands exactly on left's column 2, so it must NOT erase left's pixel there.
    const rightWide: Sprite = { rows: [".BBBB"], palette: { B: "#222222" } };
    const [row] = compositeSpriteRow([left, rightWide], 3, 1, 0);
    expect(isColor(row![2]!, "#111111")).toBe(true); // still the left sprite's color, not blanked
    expect(isColor(row![3]!, "#222222")).toBe(true); // rightWide's own opaque pixels still show past the overlap
  });

  test("the rightmost sprite in the row is always shown in full, even under a huge middle sprite", () => {
    const left = solid("A", 3, "#111111");
    const huge = solid("C", 30, "#333333"); // wide enough to bleed over both neighbors
    const right = solid("D", 3, "#444444");
    const [row] = compositeSpriteRow([left, huge, right], 3, 1, 1);
    // Locate the columns where `right` was painted (it's the last sprite, so its own pixels always survive there).
    const rightColumns = row!.filter((c) => isColor(c, "#444444"));
    expect(rightColumns).toHaveLength(3);
  });
});
