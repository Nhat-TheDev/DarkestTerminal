import { describe, expect, test } from "bun:test";
import { getClass } from "../src/data/classes";
import { createCharacter, recomputeCharacterStats } from "../src/engine/party";

describe("Knight passive: permanent stat buff", () => {
  test("the passive adds no aggro at any rank", () => {
    const cls = getClass("knight");
    for (const level of [4, 5, 20, 35]) {
      const knight = createCharacter(`v${level}`, "Knight", cls, level);
      recomputeCharacterStats(knight, 100);
      expect(knight.aggro).toBe(cls.baseAggro);
    }
  });

  test("rank 1/2/3 grant +5%/+10%/+15% maxHp and +7%/+10%/+14% defense over the same level with the passive artificially removed", () => {
    // Isolate the passive's contribution by comparing a Knight against a hypothetical
    // non-Knight class at the same level is unreliable (different base stats/growth weights).
    // Instead, verify the exact expected values directly from the formula: recomputeCharacterStats
    // applies the passive as a final multiplier on (base + artifact boost), and a fresh character
    // with no artifacts/curses/statuses has boost = 0, so maxHp/defense should equal
    // base.maxHp/base.defense scaled by exactly the rank's percent.
    const cls = getClass("knight");
    for (const [level, hpPercent, defPercent] of [
      [5, 5, 7],
      [20, 10, 10],
      [35, 15, 14],
    ] as const) {
      const withPassive = createCharacter(`v-${level}`, "Knight", cls, level);
      recomputeCharacterStats(withPassive, 100);
      const noPassive = createCharacter(`v-${level}-base`, "Knight", cls, level);
      // noPassive.maxHp/defense are the raw createCharacter values (statsForLevel's output, i.e.
      // the passive-free base) since createCharacter never calls recomputeCharacterStats itself.
      expect(withPassive.maxHp).toBe(Math.round(noPassive.maxHp * (1 + hpPercent / 100)));
      expect(withPassive.defense).toBe(Math.round(noPassive.defense * (1 + defPercent / 100)));
    }
  });
});
