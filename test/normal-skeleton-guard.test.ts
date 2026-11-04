import { describe, test, expect } from "bun:test";
import { getArchetype, getMonsterSkill } from "../src/data/monsters";
import { runNormalSkeletonGuardFight } from "./helpers";

describe("normal-tier Skeleton Guard keeps its plain behaviour", () => {
  const kitNames = () => getArchetype("skeleton-guard").skillIds.map((id) => getMonsterSkill(id).name);

  test("only ever basic-attacks, at full and at low HP", () => {
    for (let seed = 0; seed < 30; seed++) {
      for (const lowHp of [false, true]) {
        const { guard, log } = runNormalSkeletonGuardFight(seed, 8, lowHp);
        const own = log.filter((l) => l.startsWith(guard.name));
        expect(own.some((l) => l.startsWith(`${guard.name} attacks`))).toBe(true);
        for (const name of kitNames()) expect(own.some((l) => l.includes(name))).toBe(false);
      }
    }
  });
  test("never gains guard-room state", () => {
    const { guard } = runNormalSkeletonGuardFight(3, 8, true);
    expect(guard.skillCooldowns === undefined || Object.keys(guard.skillCooldowns).length === 0).toBe(true);
    expect(guard.telegraphMeter).toBeUndefined();
    expect(guard.shell).toBeUndefined();
    expect(guard.enteredPhaseIndexes).toBeUndefined();
  });
  test("base stats and normal weights are unchanged", () => {
    const a = getArchetype("skeleton-guard");
    expect([a.baseHp, a.baseAttack, a.baseDefense, a.baseSpeed]).toEqual([110, 18, 12, 4]);
    expect(a.actionWeights?.normal).toEqual({ basicAttack: 100 });
  });
});
