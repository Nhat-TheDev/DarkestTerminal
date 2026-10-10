import { describe, expect, test } from "bun:test";
import { getClass, getUnlockedPassiveRank, validatePassiveStatusIds } from "../src/data/classes";
import type { PassiveSkillDefinition } from "../src/types";

describe("getUnlockedPassiveRank", () => {
  const passive: PassiveSkillDefinition = {
    id: "test-passive",
    name: "Test",
    description: "test",
    ranks: [
      { rank: 1, unlockLevel: 5 },
      { rank: 2, unlockLevel: 20 },
      { rank: 3, unlockLevel: 35 },
    ],
  };

  test("below level 5 is rank 0", () => {
    expect(getUnlockedPassiveRank(passive, 4)).toBe(0);
  });
  test("level 5-19 is rank 1", () => {
    expect(getUnlockedPassiveRank(passive, 5)).toBe(1);
    expect(getUnlockedPassiveRank(passive, 19)).toBe(1);
  });
  test("level 20-34 is rank 2", () => {
    expect(getUnlockedPassiveRank(passive, 20)).toBe(2);
    expect(getUnlockedPassiveRank(passive, 34)).toBe(2);
  });
  test("level 35+ is rank 3", () => {
    expect(getUnlockedPassiveRank(passive, 35)).toBe(3);
    expect(getUnlockedPassiveRank(passive, 100)).toBe(3);
  });
});

describe("validatePassiveStatusIds", () => {
  test("accepts every class as loaded, and refuses a rank naming a status that does not exist", () => {
    const viking = getClass("viking");
    expect(() => validatePassiveStatusIds(viking.id, viking.passiveSkill)).not.toThrow();
    const typo: PassiveSkillDefinition = {
      ...viking.passiveSkill,
      ranks: viking.passiveSkill.ranks.map((r, i) => (i === 1 ? { ...r, thresholdStatusEffectId: "bloodrgae-ii" } : r)),
    };
    expect(() => validatePassiveStatusIds(viking.id, typo)).toThrow(/viking.*bloodrgae-ii/);
  });

  test("checks the status a Mage rank stacks, and the ones a Rogue or Plague Doctor passive names", () => {
    const mage = getClass("mage");
    const typo: PassiveSkillDefinition = { ...mage.passiveSkill, ranks: mage.passiveSkill.ranks.map((r) => ({ ...r, onHitStatusEffectId: "shreded" })) };
    expect(() => validatePassiveStatusIds(mage.id, typo)).toThrow(/mage.*onHitStatusEffectId "shreded"/);
    const rogue = getClass("rogue");
    expect(() => validatePassiveStatusIds(rogue.id, { ...rogue.passiveSkill, requiresTargetStatusId: "poisonned" })).toThrow(/requiresTargetStatusId "poisonned"/);
    const doctor = getClass("plague-doctor");
    expect(() => validatePassiveStatusIds(doctor.id, { ...doctor.passiveSkill, debuffPool: ["burning", "not-a-status"] })).toThrow(/debuffPool "not-a-status"/);
  });
});
