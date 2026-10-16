import { describe, test, expect } from "bun:test";
import { applySkillEffects, startCombat } from "../src/engine/combat";
import { getSkill, getEffectiveSkill } from "../src/data/classes";
import { mitigatedOffense } from "../src/engine/resolver";
import { spawnMonster } from "../src/data/monsters";
import { makeCtx, withoutDamageRolls } from "./helpers";

/** Inflated hp, so no trial one-shots and clamps `dealt` to the same value whatever the crit roll (the clamp reads `hp`, not `maxHp`). */
function tankyTarget() {
  const target = spawnMonster("goblin", 1);
  target.hp = 1_000_000;
  return target;
}

describe("Archer passive: character-level crit", () => {
  withoutDamageRolls();
  test("quick-shot (no innate crit) can now crit at a level-35 Archer's +8% rate", () => {
    const skill = getSkill("quick-shot");
    const trials = 2000;
    const dealtValues: number[] = [];
    for (let i = 0; i < trials; i++) {
      const { ctx } = makeCtx(i + 1);
      const archer = ctx.party.find((p) => p.classId === "archer")!;
      archer.level = 35;
      const combat = startCombat("test-room", [], ctx, false);
      const target = tankyTarget();
      const before = target.hp;
      applySkillEffects(skill, archer, [target], combat, ctx, []);
      dealtValues.push(before - target.hp);
    }
    const maxDealt = Math.max(...dealtValues);
    const rate = dealtValues.filter((d) => d === maxDealt).length / trials;
    // Expected 8%; wide tolerance keeps this test stable across rng seed changes.
    expect(rate).toBeGreaterThan(0.04);
    expect(rate).toBeLessThan(0.13);
  });

  test("aimed-shot's own 30-40% crit chance still adds the passive's chance on top", () => {
    const skill = getEffectiveSkill(getSkill("aimed-shot"), 35); // rank 3: 40% own crit chance
    const trials = 2000;
    const dealtValues: number[] = [];
    for (let i = 0; i < trials; i++) {
      const { ctx } = makeCtx(i + 1);
      const archer = ctx.party.find((p) => p.classId === "archer")!;
      archer.level = 35;
      const combat = startCombat("test-room", [], ctx, false);
      const target = tankyTarget();
      const before = target.hp;
      applySkillEffects(skill, archer, [target], combat, ctx, []);
      dealtValues.push(before - target.hp);
    }
    const maxDealt = Math.max(...dealtValues);
    const rate = dealtValues.filter((d) => d === maxDealt).length / trials;
    // Expected 0.4 (skill) + 0.08 (passive) = 48%.
    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(0.56);
  });

  test("deadeye-shot (already guaranteed 100%) still uses the passive's multiplier when it's higher than the skill's own", () => {
    const { ctx } = makeCtx();
    const archer = ctx.party.find((p) => p.classId === "archer")!;
    archer.level = 35;
    const skill = getEffectiveSkill(getSkill("deadeye-shot"), 35); // rank 1: no own critMultiplierPercent
    const combat = startCombat("test-room", [], ctx, false);
    const target = tankyTarget();
    const before = target.hp;
    applySkillEffects(skill, archer, [target], combat, ctx, []);
    const dealt = before - target.hp;

    const effect = skill.effects![0]!;
    const base = (effect.amount ?? 0) + mitigatedOffense(archer.attack * ((effect.offenseMultiplierPercent ?? 100) / 100), target.defense);
    const expectedWithArcherMultiplier = Math.max(1, Math.round(base * 1.8)); // rank-3 passive 180% beats the skill's default 150%
    expect(dealt).toBe(expectedWithArcherMultiplier);
  });

  test("a non-Archer character's basic attack is unaffected by this passive", () => {
    const { ctx } = makeCtx();
    const knight = ctx.party.find((p) => p.classId === "knight")!;
    knight.level = 35;
    const skill = getSkill("slash");
    const combat = startCombat("test-room", [], ctx, false);
    const target = tankyTarget();
    const before = target.hp;
    applySkillEffects(skill, knight, [target], combat, ctx, []);
    const dealt = before - target.hp;

    const effect = skill.effects![0]!;
    const base = (effect.amount ?? 0) + mitigatedOffense(knight.attack * ((effect.offenseMultiplierPercent ?? 100) / 100), target.defense);
    expect(dealt).toBe(Math.max(1, Math.round(base)));
  });
});
