import { describe, expect, test } from "bun:test";
import { getClass } from "../src/data/classes";
import { createCharacter, recomputeCharacterStats } from "../src/engine/party";

describe("Knight passive: permanent stat buff", () => {
  // aggro has no level growth, so anything above cls.baseAggro on a fresh character comes from the passive.
  test("below level 5 (rank 0), aggro stays at the class base", () => {
    const cls = getClass("knight");
    const knight = createCharacter("v1", "Knight", cls, 4);
    recomputeCharacterStats(knight, 100);
    expect(knight.aggro).toBe(cls.baseAggro);
  });

  test("rank 1 (level 5): +3 aggro", () => {
    const cls = getClass("knight");
    const knight = createCharacter("v2", "Knight", cls, 5);
    recomputeCharacterStats(knight, 100);
    expect(knight.aggro).toBe(cls.baseAggro + 3);
  });

  test("rank 2 (level 20): +6 aggro", () => {
    const cls = getClass("knight");
    const knight = createCharacter("v3", "Knight", cls, 20);
    recomputeCharacterStats(knight, 100);
    expect(knight.aggro).toBe(cls.baseAggro + 6);
  });

  test("rank 3 (level 35): +9 aggro", () => {
    const cls = getClass("knight");
    const knight = createCharacter("v4", "Knight", cls, 35);
    recomputeCharacterStats(knight, 100);
    expect(knight.aggro).toBe(cls.baseAggro + 9);
  });

  test("rank 1/2/3 grant +5%/+10%/+15% maxHp and +7%/+10%/+14% defense over the same level with the passive artificially removed", () => {
    const cls = getClass("knight");
    for (const [level, hpPercent, defPercent] of [
      [5, 5, 7],
      [20, 10, 10],
      [35, 15, 14],
    ] as const) {
      const withPassive = createCharacter(`v-${level}`, "Knight", cls, level);
      recomputeCharacterStats(withPassive, 100);
      const noPassive = createCharacter(`v-${level}-base`, "Knight", cls, level);
      // createCharacter never runs recomputeCharacterStats, so this is the passive-free base.
      expect(withPassive.maxHp).toBe(Math.round(noPassive.maxHp * (1 + hpPercent / 100)));
      expect(withPassive.defense).toBe(Math.round(noPassive.defense * (1 + defPercent / 100)));
    }
  });
});
