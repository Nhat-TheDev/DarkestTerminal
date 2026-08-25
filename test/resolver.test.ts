import { describe, test, expect } from "bun:test";
import { resolveSkillEffect, getFearTier, rollLosesControl, tickStatusEffects, mitigatedOffense } from "../src/engine/resolver";
import type { LogEntry } from "../src/types";
import { makeCtx } from "./helpers";

describe("resolver", () => {
  test("damage formula: max(1, round(amount + mitigatedOffense(attack, defense)))", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    const before = target.hp;
    resolveSkillEffect({ kind: "damage", amount: 10 }, attacker, target, { log: [] });
    expect(before - target.hp).toBe(Math.max(1, Math.round(10 + mitigatedOffense(attacker.attack, target.defense))));
  });

  test("damage is floored at 1 even vs. huge defense", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[1]!;
    const target = ctx.party[0]!;
    target.defense = 999;
    const before = target.hp;
    resolveSkillEffect({ kind: "damage", amount: 1 }, attacker, target, { log: [] });
    expect(before - target.hp).toBe(1);
  });

  test("heal clamps at maxHp", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.hp = target.maxHp - 5;
    resolveSkillEffect({ kind: "heal", amount: 999 }, target, target, { log: [] });
    expect(target.hp).toBe(target.maxHp);
  });

  test("modifyStat clamps fear/hunger/thirst to [0, 100]", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.survival.fear = 95;
    resolveSkillEffect({ kind: "modifyStat", stat: "fear", amount: 50 }, target, target, { log: [] });
    expect(target.survival.fear).toBe(100);
  });

  test("modifyCombatStat status effect installs immediately and undoes on expiry (guard is now a 1-turn buff)", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const baseDef = vanguard.defense;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "guard" }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(baseDef + 6);

    tickStatusEffects(vanguard, { log });
    expect(vanguard.defense).toBe(baseDef);
    expect(vanguard.activeStatusEffects).toHaveLength(0);
  });

  test("a status effect's own recurring damage tick (DoT, e.g. Poisoned) is flat, not attack-minus-defense (regression: source===target self-tick was going through the full damage formula)", () => {
    const { ctx } = makeCtx();
    const victim = ctx.monsters[0]!;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poisoned" }, victim, victim, { log });
    const before = victim.hp;
    tickStatusEffects(victim, { log });
    expect(before - victim.hp).toBe(4);
  });

  test("re-applying an active status effect refreshes duration instead of stacking (bong: 2-turn debuff)", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "burning" }, vanguard, vanguard, { log });
    tickStatusEffects(vanguard, { log });
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "burning" }, vanguard, vanguard, { log });
    expect(vanguard.activeStatusEffects).toHaveLength(1);
    expect(vanguard.activeStatusEffects[0]!.turnsRemaining).toBe(2);
  });

  test("fear tiers match docs/gameplay-decisions.md §3", () => {
    expect(getFearTier(0)).toBe(1);
    expect(getFearTier(39)).toBe(1);
    expect(getFearTier(40)).toBe(2);
    expect(getFearTier(69)).toBe(2);
    expect(getFearTier(70)).toBe(3);
    expect(getFearTier(99)).toBe(3);
    expect(getFearTier(100)).toBe(4);
  });

  test("rollLosesControl only ever triggers at fear tier 4", () => {
    const alwaysTrue = () => 0;
    expect(rollLosesControl(99, alwaysTrue)).toBe(false);
    expect(rollLosesControl(100, alwaysTrue)).toBe(true);
    const alwaysFalse = () => 0.9;
    expect(rollLosesControl(100, alwaysFalse)).toBe(false);
  });
});

