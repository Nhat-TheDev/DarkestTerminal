import { describe, expect, test } from "bun:test";
import { getClass } from "../src/data/classes";
import { createCharacter, recomputeCharacterStats } from "../src/engine/party";

describe("Vanguard passive: permanent stat buff", () => {
  // aggro has no level growth, so anything above cls.baseAggro on a fresh character comes from the passive.
  test("below level 5 (rank 0), aggro stays at the class base", () => {
    const cls = getClass("vanguard");
    const vanguard = createCharacter("v1", "Vanguard", cls, 4);
    recomputeCharacterStats(vanguard, 100);
    expect(vanguard.aggro).toBe(cls.baseAggro);
  });

  test("rank 1 (level 5): +3 aggro", () => {
    const cls = getClass("vanguard");
    const vanguard = createCharacter("v2", "Vanguard", cls, 5);
    recomputeCharacterStats(vanguard, 100);
    expect(vanguard.aggro).toBe(cls.baseAggro + 3);
  });

  test("rank 2 (level 20): +6 aggro", () => {
    const cls = getClass("vanguard");
    const vanguard = createCharacter("v3", "Vanguard", cls, 20);
    recomputeCharacterStats(vanguard, 100);
    expect(vanguard.aggro).toBe(cls.baseAggro + 6);
  });

  test("rank 3 (level 35): +9 aggro", () => {
    const cls = getClass("vanguard");
    const vanguard = createCharacter("v4", "Vanguard", cls, 35);
    recomputeCharacterStats(vanguard, 100);
    expect(vanguard.aggro).toBe(cls.baseAggro + 9);
  });

  test("rank 1/2/3 grant +5%/+10%/+15% maxHp and +7%/+10%/+14% defense over the same level with the passive artificially removed", () => {
    const cls = getClass("vanguard");
    for (const [level, hpPercent, defPercent] of [
      [5, 5, 7],
      [20, 10, 10],
      [35, 15, 14],
    ] as const) {
      const withPassive = createCharacter(`v-${level}`, "Vanguard", cls, level);
      recomputeCharacterStats(withPassive, 100);
      const noPassive = createCharacter(`v-${level}-base`, "Vanguard", cls, level);
      // createCharacter never runs recomputeCharacterStats, so this is the passive-free base.
      expect(withPassive.maxHp).toBe(Math.round(noPassive.maxHp * (1 + hpPercent / 100)));
      expect(withPassive.defense).toBe(Math.round(noPassive.defense * (1 + defPercent / 100)));
    }
  });
});
