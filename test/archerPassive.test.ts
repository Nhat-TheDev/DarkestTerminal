import { describe, test, expect } from "bun:test";
import { applySkillEffects, startCombat } from "../src/engine/combat";
import { getSkill, getEffectiveSkill } from "../src/data/classes";
import { mitigatedOffense } from "../src/engine/resolver";
import { spawnMonster } from "../src/data/monsters";
import { makeCtx } from "./helpers";

/** A floor-1 monster's HP pool is far too small to survive a high-level Archer's hit at all,
 *  crit or not — every trial would one-shot and clamp `dealt` to the same maxHp value regardless
 *  of the crit roll, masking the very thing these tests check. Inflating `target.hp` (the damage
 *  clamp only reads `target.hp`, never `target.maxHp`) removes that confound. */
function tankyTarget() {
  const target = spawnMonster("goblin", 1);
  target.hp = 1_000_000;
  return target;
}

describe("Archer passive: character-level crit", () => {
  test("archer-quick-shot (no innate crit) can now crit at a level-35 Archer's +8% rate", () => {
    const skill = getSkill("archer-quick-shot");
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

  test("archer-aimed-shot's own 30-40% crit chance still adds the passive's chance on top", () => {
    const skill = getEffectiveSkill(getSkill("archer-aimed-shot"), 35); // rank 3: 40% own crit chance
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

  test("archer-deadeye-shot (already guaranteed 100%) still uses the passive's multiplier when it's higher than the skill's own", () => {
    const { ctx } = makeCtx();
    const archer = ctx.party.find((p) => p.classId === "archer")!;
    archer.level = 35;
    const skill = getEffectiveSkill(getSkill("archer-deadeye-shot"), 35); // rank 1: no own critMultiplierPercent
    const combat = startCombat("test-room", [], ctx, false);
    const target = tankyTarget();
    const before = target.hp;
    applySkillEffects(skill, archer, [target], combat, ctx, []);
    const dealt = before - target.hp;

    const effect = skill.effects![0]!;
    const base = (effect.amount ?? 0) + mitigatedOffense(archer.attack * ((effect.offenseMultiplierPercent ?? 100) / 100), target.defense);
    const expectedWithArcherMultiplier = Math.max(1, Math.round(base * 1.8)); // rank-3 passive multiplier (180%) beats the skill's own default (150%)
    expect(dealt).toBe(expectedWithArcherMultiplier);
  });

  test("a non-Archer character's basic attack is unaffected by this passive", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.level = 35;
    const skill = getSkill("vanguard-slash");
    const combat = startCombat("test-room", [], ctx, false);
    const target = tankyTarget();
    const before = target.hp;
    applySkillEffects(skill, vanguard, [target], combat, ctx, []);
    const dealt = before - target.hp;

    const effect = skill.effects![0]!;
    const base = (effect.amount ?? 0) + mitigatedOffense(vanguard.attack * ((effect.offenseMultiplierPercent ?? 100) / 100), target.defense);
    expect(dealt).toBe(Math.max(1, Math.round(base)));
  });
});
