import { describe, expect, test } from "bun:test";
import { computeDamage, previewSkillDamage } from "../tools/game-editor/calc";
import { getEffectiveSkill, getSkill } from "../src/data/classes";
import { BALANCE } from "../src/data/balanceConfig";

describe("game-editor computeDamage: the range of one swing", () => {
  const hit = () => {
    const result = computeDamage({ offense: 100, defense: 20, amount: 30 });
    if ("error" in result) throw new Error(result.error);
    return result;
  };

  test("brackets the unvaried damage by combat.damageVariancePercent", () => {
    const { rawTotal, finalDamage, finalDamageMin, finalDamageMax } = hit();
    const p = BALANCE.combat.damageVariancePercent / 100;
    expect(finalDamageMin).toBe(Math.max(1, Math.floor(rawTotal * (1 - p))));
    expect(finalDamageMax).toBe(Math.max(1, Math.ceil(rawTotal * (1 + p))));
    expect(finalDamageMin).toBeLessThanOrEqual(finalDamage);
    expect(finalDamageMax).toBeGreaterThanOrEqual(finalDamage);
  });

  test("is never below 1, whatever the variance", () => {
    const result = computeDamage({ offense: 0, defense: 500, amount: 0 });
    if ("error" in result) throw new Error(result.error);
    expect(result.finalDamageMin).toBeGreaterThanOrEqual(1);
  });
});

describe("previewSkillDamage", () => {
  test("a damage effect that scales with attack and magic power reads both", () => {
    const skill = getEffectiveSkill(getSkill("cross-slash"), 10);
    const preview = (magicPower: number) => previewSkillDamage(skill, { attack: 20, magicPower }, { defense: 0 }, 1, true).totalFinalDamage;
    expect(preview(30)).toBeGreaterThan(preview(0));
  });
});
