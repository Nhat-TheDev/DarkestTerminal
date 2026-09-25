import { describe, expect, test } from "bun:test";
import { getClass } from "../src/data/classes";
import { createCharacter, recomputeCharacterStats } from "../src/engine/party";

describe("Vanguard passive: permanent stat buff", () => {
  // aggro never grows with level on its own (createCharacter sets it to cls.baseAggro flat, and
  // recomputeCharacterStats's non-passive terms are all 0 for a fresh character with no artifacts/
  // curses/statuses) — so any aggro above cls.baseAggro at level 5+ can only come from the passive.
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
    // Isolate the passive's contribution by comparing a Vanguard against a hypothetical
    // non-Vanguard class at the same level is unreliable (different base stats/growth weights).
    // Instead, verify the exact expected values directly from the formula: recomputeCharacterStats
    // applies the passive as a final multiplier on (base + artifact boost), and a fresh character
    // with no artifacts/curses/statuses has boost = 0, so maxHp/defense should equal
    // base.maxHp/base.defense scaled by exactly the rank's percent.
    const cls = getClass("vanguard");
    for (const [level, hpPercent, defPercent] of [
      [5, 5, 7],
      [20, 10, 10],
      [35, 15, 14],
    ] as const) {
      const withPassive = createCharacter(`v-${level}`, "Vanguard", cls, level);
      recomputeCharacterStats(withPassive, 100);
      const noPassive = createCharacter(`v-${level}-base`, "Vanguard", cls, level);
      // noPassive.maxHp/defense are the raw createCharacter values (statsForLevel's output, i.e.
      // the passive-free base) since createCharacter never calls recomputeCharacterStats itself.
      expect(withPassive.maxHp).toBe(Math.round(noPassive.maxHp * (1 + hpPercent / 100)));
      expect(withPassive.defense).toBe(Math.round(noPassive.defense * (1 + defPercent / 100)));
    }
  });
});
