import { describe, expect, test } from "bun:test";
import { getUnlockedPassiveRank } from "../src/data/classes";
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
