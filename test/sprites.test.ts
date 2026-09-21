import { describe, test, expect } from "bun:test";
import { RGBA } from "@opentui/core";
import { ALL_SPRITES, spriteWidth, spriteHeight, spriteForClass, spriteForMonster, assertMonsterSpritesConsistent, renderSpriteInSlot, compositeSpriteRow, type Sprite } from "../src/ui/sprites";
import { CLASSES } from "../src/data/classes";
import { MONSTER_ARCHETYPES, getArchetype, COMBAT_ROOM_ARCHETYPES, GUARD_ROOM_ARCHETYPES, FINAL_BOSS_ARCHETYPE } from "../src/data/monsters";
import { MONSTER_STYLE } from "../src/ui/theme";

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

  test("sprite coverage matches roles exactly: normal/elite/boss/final-boss", () => {
    expect(() => assertMonsterSpritesConsistent(MONSTER_ARCHETYPES)).not.toThrow();
    for (const archetype of MONSTER_ARCHETYPES) {
      for (const tier of ["normal", "elite", "boss"] as const) {
        const wants = archetype.roles.includes(tier);
        if (wants) {
          expect(() => spriteForMonster(archetype.id, tier)).not.toThrow();
        } else {
          expect(() => spriteForMonster(archetype.id, tier)).toThrow();
        }
      }
    }
  });

  test("assertMonsterSpritesConsistent rejects a declared role with no sprite and a sprite with no declared role", () => {
    const rat = getArchetype("dungeon-rat");
    expect(() => assertMonsterSpritesConsistent([{ ...rat, roles: ["normal", "elite"] }])).toThrow(/declares role "elite" but has no elite sprite/);
    const dragon = getArchetype("dragon");
    expect(() => assertMonsterSpritesConsistent([{ ...dragon, roles: ["elite"] }])).toThrow(/has no role "boss" but ships a boss sprite/);
  });

  test("every normal-role archetype has a normal sprite", () => {
    for (const archetype of COMBAT_ROOM_ARCHETYPES) {
      const normal = spriteForMonster(archetype.id, "normal");
      expect(spriteHeight(normal)).toBeLessThanOrEqual(10);
    }
  });

  // A missing entry here is what made half the bestiary render as "??" in the battlefield and
  // monster panels: `monsterStyle` falls back when the table drifts behind `data/monsters.json`.
  test("every monster archetype has a MONSTER_STYLE entry", () => {
    for (const archetype of MONSTER_ARCHETYPES) {
      expect(MONSTER_STYLE[archetype.id]).toBeDefined();
    }
  });

  test("MONSTER_STYLE abbreviations are unique and 3 characters wide", () => {
    const abbrs = Object.values(MONSTER_STYLE).map((s) => s.abbr);
    expect(new Set(abbrs).size).toBe(abbrs.length);
    for (const abbr of abbrs) expect(abbr).toMatch(/^[A-Z]{3}$/);
  });

  test("every guard archetype has distinct elite and boss sprites; final boss has boss only", () => {
    expect(GUARD_ROOM_ARCHETYPES.length).toBeGreaterThan(0);
    for (const archetype of GUARD_ROOM_ARCHETYPES) {
      const elite = spriteForMonster(archetype.id, "elite");
      const boss = spriteForMonster(archetype.id, "boss");
      expect(JSON.stringify(elite)).not.toBe(JSON.stringify(boss));
      if (archetype.roles.includes("normal")) {
        const normal = spriteForMonster(archetype.id, "normal");
        expect(new Set([normal, elite, boss].map((s) => JSON.stringify(s))).size).toBe(3);
      } else {
        expect(() => spriteForMonster(archetype.id, "normal")).toThrow();
      }
    }
    expect(FINAL_BOSS_ARCHETYPE.id).toBe("the-founder");
    expect(() => spriteForMonster("the-founder", "boss")).not.toThrow();
    expect(() => spriteForMonster("the-founder", "normal")).toThrow();
    expect(() => spriteForMonster("the-founder", "elite")).toThrow();
  });
});

describe("renderSpriteInSlot: bottom-aligned, centered, fixed-size output", () => {
  const dungeonRat = spriteForMonster("dungeon-rat", "normal");
  const boss = spriteForMonster("skeleton-guard", "boss");

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
    const lines = renderSpriteInSlot(dungeonRat, 13, 11);
    const hasColor = (line: (typeof lines)[number]) => line.some((c) => c.bg !== undefined);
    expect(hasColor(lines[0]!)).toBe(false);
    expect(hasColor(lines[12]!)).toBe(true);
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
    expect(row).toHaveLength(7);
    expect(row!.slice(0, 3).every((c) => isColor(c, "#111111"))).toBe(true);
    expect(row![3]!.bg).toBeUndefined();
    expect(row!.slice(4, 7).every((c) => isColor(c, "#222222"))).toBe(true);
  });

  test("an oversized sprite alone is centered on its own slot, bleeding equally on both sides", () => {
    const wide = solid("A", 7, "#111111");
    const [row] = compositeSpriteRow([wide], 3, 1, 1);
    expect(row).toHaveLength(7);
  });

  test("where 2 sprites overlap, the later (rightmost) sprite's opaque pixels win", () => {
    const left = solid("A", 3, "#111111");
    const rightWide = solid("B", 7, "#222222");
    const [row] = compositeSpriteRow([left, rightWide], 3, 1, 0);
    expect(isColor(row![2]!, "#222222")).toBe(true);
    expect(isColor(row![0]!, "#111111")).toBe(true);
  });

  test("a transparent pixel never covers what an earlier sprite already painted", () => {
    const left = solid("A", 3, "#111111");
    const rightWide: Sprite = { rows: [".BBBB"], palette: { B: "#222222" } };
    const [row] = compositeSpriteRow([left, rightWide], 3, 1, 0);
    expect(isColor(row![2]!, "#111111")).toBe(true);
    expect(isColor(row![3]!, "#222222")).toBe(true);
  });

  test("the rightmost sprite in the row is always shown in full, even under a huge middle sprite", () => {
    const left = solid("A", 3, "#111111");
    const huge = solid("C", 30, "#333333");
    const right = solid("D", 3, "#444444");
    const [row] = compositeSpriteRow([left, huge, right], 3, 1, 1);
    const rightColumns = row!.filter((c) => isColor(c, "#444444"));
    expect(rightColumns).toHaveLength(3);
  });
});
