import { describe, expect, test } from "bun:test";
import { combatHooks } from "../src/engine/combatHooks";
import { resolveSkillEffect, type Actor } from "../src/engine/resolver";
import { spawnMonster } from "../src/data/monsters";
import { makeCtx } from "./helpers";

function fireOnDamageDealt(source: Actor, target: Actor, damage: number, ctx: ReturnType<typeof makeCtx>["ctx"]): void {
  for (const hook of combatHooks) hook.onDamageDealt?.(source, target, damage, ctx, []);
}

describe("Rogue passive: bonus poison damage vs. poisoned targets", () => {
  test("a Rogue's hit on a poisoned target deals bonus poison-type damage", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.level = 35; // rank 3: +30% + 20 flat
    const target = spawnMonster("goblin", 1); // no poison resist, safe baseline
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poisoned" }, rogue, target, { log: [] });
    const before = target.hp;
    fireOnDamageDealt(rogue, target, 10, ctx);
    expect(target.hp).toBeLessThan(before);
    // bonus = round(10 * 0.30) + 20 = 23
    expect(before - target.hp).toBe(23);
  });

  test("no bonus applies when the target has no poison-family status active", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.level = 35;
    const target = spawnMonster("goblin", 1);
    const before = target.hp;
    fireOnDamageDealt(rogue, target, 10, ctx);
    expect(target.hp).toBe(before);
  });

  test("no bonus applies below level 5 (rank 0)", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.level = 1;
    const target = spawnMonster("goblin", 1);
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poisoned" }, rogue, target, { log: [] });
    const before = target.hp;
    fireOnDamageDealt(rogue, target, 10, ctx);
    expect(target.hp).toBe(before);
  });
});

describe("Mage passive: stacking defense shred on hit", () => {
  test("a Mage's hit stacks the mage-shred status on the target, reducing its defense", () => {
    const { ctx } = makeCtx();
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    mage.level = 35; // rank 3: -10% / -12 flat, whichever is larger in magnitude
    const target = spawnMonster("goblin", 1);
    target.defense = 40;
    const before = target.defense;
    fireOnDamageDealt(mage, target, 10, ctx);
    // max(12, round(40 * 10 / 100)) = max(12, 4) = 12
    expect(target.defense).toBe(before - 12);
    expect(target.activeStatusEffects.find((s) => s.statusEffectId === "mage-shred")?.stacks).toBe(1);
  });

  test("a 2nd hit adds another stack, up to maxStacks", () => {
    const { ctx } = makeCtx();
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    mage.level = 35;
    const target = spawnMonster("goblin", 1);
    target.defense = 40;
    fireOnDamageDealt(mage, target, 10, ctx);
    fireOnDamageDealt(mage, target, 10, ctx);
    expect(target.activeStatusEffects.find((s) => s.statusEffectId === "mage-shred")?.stacks).toBe(2);
    expect(target.defense).toBe(40 - 12 - 12);
  });

  test("no shred applies below level 5 (rank 0)", () => {
    const { ctx } = makeCtx();
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    mage.level = 1;
    const target = spawnMonster("goblin", 1);
    const before = target.defense;
    fireOnDamageDealt(mage, target, 10, ctx);
    expect(target.defense).toBe(before);
    expect(target.activeStatusEffects.length).toBe(0);
  });
});

const PLAGUE_DOCTOR_DEBUFF_POOL = ["poisoned", "burning", "weakened", "blinded", "slowed", "enfeebled"];

describe("Plague Doctor passive: double-roll debuff proc", () => {
  test("at rank 3 (50% per roll), across many trials, roughly 75% of hits land at least 1 debuff", () => {
    const trials = 500;
    let landedAtLeastOne = 0;
    for (let i = 0; i < trials; i++) {
      const { ctx } = makeCtx(i + 1);
      const doctor = ctx.party.find((p) => p.classId === "plague-doctor")!;
      doctor.level = 35; // rank 3: 50% per roll
      const target = spawnMonster("goblin", 1);
      fireOnDamageDealt(doctor, target, 10, ctx);
      if (target.activeStatusEffects.some((s) => PLAGUE_DOCTOR_DEBUFF_POOL.includes(s.statusEffectId))) landedAtLeastOne++;
    }
    // 1 - (1-0.5)^2 = 0.75 expected.
    const rate = landedAtLeastOne / trials;
    expect(rate).toBeGreaterThan(0.65);
    expect(rate).toBeLessThan(0.85);
  });

  test("the applied debuff is always one of the 6-entry pool", () => {
    for (let i = 0; i < 100; i++) {
      const { ctx } = makeCtx(i + 1);
      const doctor = ctx.party.find((p) => p.classId === "plague-doctor")!;
      doctor.level = 35;
      const target = spawnMonster("goblin", 1);
      fireOnDamageDealt(doctor, target, 10, ctx);
      for (const active of target.activeStatusEffects) {
        expect(PLAGUE_DOCTOR_DEBUFF_POOL).toContain(active.statusEffectId);
      }
    }
  });

  test("no proc at all below level 5 (rank 0)", () => {
    const { ctx } = makeCtx();
    const doctor = ctx.party.find((p) => p.classId === "plague-doctor")!;
    doctor.level = 1;
    const target = spawnMonster("goblin", 1);
    fireOnDamageDealt(doctor, target, 10, ctx);
    expect(target.activeStatusEffects.length).toBe(0);
  });
});
