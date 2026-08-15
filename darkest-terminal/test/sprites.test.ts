import { describe, test, expect } from "bun:test";
import { ALL_SPRITES, spriteWidth, spriteHeight, spriteForClass, spriteForMonster, renderSpriteInSlot } from "../src/ui/sprites";
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

  test("every monster archetype has a non-boss sprite, and the boss variant resolves separately", () => {
    for (const archetype of MONSTER_ARCHETYPES) {
      const normal = spriteForMonster(archetype.id, false);
      expect(spriteHeight(normal)).toBeLessThanOrEqual(10);
      const boss = spriteForMonster(archetype.id, true);
      expect(spriteHeight(boss)).toBeLessThanOrEqual(13);
    }
  });
});

describe("renderSpriteInSlot: bottom-aligned, centered, fixed-size output", () => {
  const dungeonRat = spriteForMonster("dungeon-rat", false);
  const boss = spriteForMonster("dungeon-rat", true); // any archetype resolves to the shared boss sprite

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
