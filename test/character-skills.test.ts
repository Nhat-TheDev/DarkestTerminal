import { describe, test, expect, afterAll } from "bun:test";
import { CLASSES, getClass, getSkill, getEffectiveSkill, getUnlockedPassiveRank } from "../src/data/classes";
import { GROWTH_WEIGHTS } from "../src/data/growthWeights";
import { STATUS_EFFECTS, getStatusEffect } from "../src/data/statusEffects";
import { createCharacter } from "../src/engine/party";
import { getActorByRef, startCombat, queueAction, resolveRound, autoResolveTargets, livingMonsterRefs, livingCharacterRefs } from "../src/engine/combat";
import { mitigatedOffense, getFearTier, rollHits, getFearAccuracyPenalty, isHelpfulStatusEffect, resolveSkillEffect } from "../src/engine/resolver";
import type { CombatantRef, LogEntry, SkillDefinition, Character } from "../src/types";
import { makeCtx, spawnInto, pickAnyAction } from "./helpers";
import { getSummonArchetype, getSummonSkill, getSummonCast } from "../src/data/summons";

// Several tests below push mock entries onto STATUS_EFFECTS/CLASSES[0].skills to exercise new mechanics.
// Bun shares module state across test files within one run, so truncate back to the original length once
// this file's tests are done to avoid leaking mock entries into other test files' assertions.
const initialStatusEffectsCount = STATUS_EFFECTS.length;
const initialVanguardSkillsCount = CLASSES[0]!.skills.length;
afterAll(() => {
  STATUS_EFFECTS.length = initialStatusEffectsCount;
  CLASSES[0]!.skills.length = initialVanguardSkillsCount;
});

describe("new skill mechanics", () => {
  test("Shield Guard applies both guard and taunt in a single cast", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    resolveRound(combat, ctx);

    expect(combat.log.some((l) => l.text.includes("gains the Guard effect"))).toBe(true);
    expect(combat.log.some((l) => l.text.includes("gains the Taunt effect"))).toBe(true);
  });

  test("stuns status makes the bearer skip their turn entirely", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.activeStatusEffects.push({ statusEffectId: "stunned", turnsRemaining: 1 });
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    queueAction(combat, { kind: "character", id: rogue.id }, "rogue-stab", [enemyRef], ctx);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) continue;
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("is stunned"))).toBe(true);
    expect(combat.log.some((l) => l.text.includes("Rogue") && l.text.includes("uses"))).toBe(false);
  });

  test("Poison Coat buff makes a landed hit auto-apply Poisoned", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    // lesser-golem (Golem race, 40% physical resist) rather than skeleton-guard (its Skeletal
    // subRace is now 30% WEAK to physical) — this test needs the monster to survive round 1's
    // party-wide attacks so round 2 can verify Poison Coat's on-hit proc.
    const tanky = spawnInto(ctx, "lesser-golem");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: rogue.id };

    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) queueAction(combat, self, "rogue-poison-coat", [self], ctx);
      else {
        const { skillId, targets } = pickAnyAction(ctx, combat, ref);
        queueAction(combat, ref, skillId, targets, ctx);
      }
    }
    resolveRound(combat, ctx);
    expect(rogue.activeStatusEffects.some((s) => s.statusEffectId === "poison-coat")).toBe(true);

    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) queueAction(combat, self, "rogue-knife-throw", [enemyRef], ctx);
      else {
        const { skillId, targets } = pickAnyAction(ctx, combat, ref);
        queueAction(combat, ref, skillId, targets, ctx);
      }
    }
    resolveRound(combat, ctx);
    const enemyActor = getActorByRef(enemyRef, ctx);
    expect(enemyActor.activeStatusEffects.some((s) => s.statusEffectId === "poisoned")).toBe(true);
  });

  test("dual-relation skill (Purify) damages when aimed at an enemy, cleanses when aimed at an ally", () => {
    const { ctx } = makeCtx();
    const acolyte = createCharacter("cp-test", "Acolyte Test", getClass("acolyte"), 10);
    ctx.party.push(acolyte);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.activeStatusEffects.push({ statusEffectId: "burning", turnsRemaining: 2 });

    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const acolyteRef: CombatantRef = { kind: "character", id: acolyte.id };

    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    const hpBefore = getActorByRef(enemyRef, ctx).hp;
    expect(queueAction(combat, acolyteRef, "acolyte-purify", [enemyRef], ctx)).toBeNull();
    resolveRound(combat, ctx);
    expect(getActorByRef(enemyRef, ctx).hp).toBeLessThan(hpBefore);

    const allyRef: CombatantRef = { kind: "character", id: vanguard.id };
    expect(queueAction(combat, acolyteRef, "acolyte-purify", [allyRef], ctx)).toBeNull();
    resolveRound(combat, ctx);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "burning")).toBe(false);
  });

  test("Purify strips the debuff, not an earlier-applied buff, when the ally carries both", () => {
    const { ctx } = makeCtx();
    const acolyte = createCharacter("cp-test2", "Acolyte Test", getClass("acolyte"), 10);
    ctx.party.push(acolyte);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    // Buff applied BEFORE the debuff, so a naive "remove index 0" would strip the wrong one.
    vanguard.activeStatusEffects.push({ statusEffectId: "guard", turnsRemaining: 3 });
    vanguard.activeStatusEffects.push({ statusEffectId: "burning", turnsRemaining: 2 });

    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const acolyteRef: CombatantRef = { kind: "character", id: acolyte.id };
    const allyRef: CombatantRef = { kind: "character", id: vanguard.id };

    expect(queueAction(combat, acolyteRef, "acolyte-purify", [allyRef], ctx)).toBeNull();
    resolveRound(combat, ctx);

    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "burning")).toBe(false);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "guard")).toBe(true);
  });

  test("Purify does nothing when the ally has a buff but no debuff, instead of stripping the buff", () => {
    const { ctx } = makeCtx();
    const acolyte = createCharacter("cp-test3", "Acolyte Test", getClass("acolyte"), 10);
    ctx.party.push(acolyte);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.activeStatusEffects.push({ statusEffectId: "guard", turnsRemaining: 3 }); // no debuff present

    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const acolyteRef: CombatantRef = { kind: "character", id: acolyte.id };
    const allyRef: CombatantRef = { kind: "character", id: vanguard.id };

    expect(queueAction(combat, acolyteRef, "acolyte-purify", [allyRef], ctx)).toBeNull();
    resolveRound(combat, ctx);

    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "guard")).toBe(true);
  });

  test("ultimate skills always hit even at high fear, but scale damage down instead of missing", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("vanguard-sword-judgment");
    vanguard.mp = 999;
    vanguard.survival.fear = 99;
    const skeleton = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [skeleton.id], ctx, false);
    const enemyRef: CombatantRef = { kind: "monster", id: skeleton.id };
    const enemyActor = getActorByRef(enemyRef, ctx);
    const fullPowerDamage = Math.max(1, 30 + mitigatedOffense(vanguard.attack, enemyActor.defense));

    queueAction(combat, { kind: "character", id: vanguard.id }, "vanguard-sword-judgment", [enemyRef], ctx);
    const hpBefore = enemyActor.hp;
    resolveRound(combat, ctx);
    const actualDamage = hpBefore - enemyActor.hp;

    expect(combat.log.some((l) => l.text.includes("misses its attack"))).toBe(false);
    expect(actualDamage).toBeGreaterThan(0);
    expect(actualDamage).toBeLessThan(fullPowerDamage);
  });

  test("an ultimate's fear-tier penalty scales its whole power budget (offenseMultiplierPercent-based portion included), not just its flat amount", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("vanguard-sword-judgment"); // rank 1: amount 30, offenseMultiplierPercent 85
    vanguard.mp = 999;
    vanguard.survival.fear = 99; // Fear Tier 4 -> ultimateEffectivenessMultiplier = 0.6
    // vampire-bat (Beast race, Predator subRace) rather than skeleton-guard — its Skeletal subRace
    // is 30% weak to physical, which would inflate actualDamage past amountOnlyScaledDamage and
    // confound this test's whole point (isolating the fear-tier scaling formula, not race damage).
    const enemy = spawnInto(ctx, "vampire-bat");
    const combat = startCombat("r1", [enemy.id], ctx, false);
    const enemyRef: CombatantRef = { kind: "monster", id: enemy.id };
    const enemyActor = getActorByRef(enemyRef, ctx);
    // If only `amount` were scaled (the pre-fix behavior), damage would be
    // round(30*0.6) + mitigatedOffense(vanguard.attack*0.85, defense) — the offense-scaled term unaffected.
    const amountOnlyScaledDamage = Math.max(1, Math.round(30 * 0.6) + mitigatedOffense(vanguard.attack * 0.85, enemyActor.defense));

    queueAction(combat, { kind: "character", id: vanguard.id }, "vanguard-sword-judgment", [enemyRef], ctx);
    const hpBefore = enemyActor.hp;
    resolveRound(combat, ctx);
    const actualDamage = hpBefore - enemyActor.hp;

    expect(actualDamage).toBeLessThan(amountOnlyScaledDamage);
  });

  test("the damage log line names the skill that dealt it, so it's clear which attack landed", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const enemyRef: CombatantRef = { kind: "monster", id: rat.id };

    queueAction(combat, { kind: "character", id: rogue.id }, "rogue-knife-throw", [enemyRef], ctx);
    resolveRound(combat, ctx);

    expect(combat.log.some((l) => /^Dungeon Rat takes \d+ damage from Rogue's Knife Throw\.$/.test(l.text))).toBe(true);
  });

  test("a plain basic attack (no skillName passed to resolveSkillEffect) keeps the old damage log wording", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    const log: LogEntry[] = [];

    resolveSkillEffect({ kind: "damage", amount: 0 }, rat, rogue, { log });

    expect(log.some((l) => new RegExp(`^${rogue.name} takes \\d+ damage from Dungeon Rat\\.$`).test(l.text))).toBe(true);
  });

  test("Storm-Empowered's on-hit splash names its source in the damage log, hyphen dropped", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.mp = 999;
    const rat = spawnInto(ctx, "dungeon-rat");
    const self: CombatantRef = { kind: "character", id: viking.id };
    const enemyRef: CombatantRef = { kind: "monster", id: rat.id };
    const combat = startCombat("r1", [rat.id], ctx, false);

    queueAction(combat, self, "viking-lightning-axe", [self], ctx);
    resolveRound(combat, ctx);
    const logBefore = combat.log.length;
    queueAction(combat, self, "viking-axe-slash", [enemyRef], ctx);
    resolveRound(combat, ctx);

    const newLines = combat.log.slice(logBefore).map((l) => l.text);
    expect(newLines.some((t) => /^Dungeon Rat takes \d+ damage from Viking's Axe Slash\.$/.test(t))).toBe(true);
    expect(newLines.some((t) => /^Dungeon Rat takes \d+ damage from Viking's Storm Empowered\.$/.test(t))).toBe(true);
  });
});

describe("queued action refund when it never executes", () => {
  test("skill mp is never spent when the last monster dies to a faster ally before the caster's own turn comes up", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    vanguard.speed = 999;
    rogue.speed = 1;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.hp = 1;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const ratRef: CombatantRef = { kind: "monster", id: rat.id };

    const rogueMpBefore = rogue.mp;
    queueAction(combat, { kind: "character", id: vanguard.id }, "vanguard-slash", [ratRef], ctx);
    expect(queueAction(combat, { kind: "character", id: rogue.id }, "rogue-knife-throw", [ratRef], ctx)).toBeNull();
    expect(rogue.mp).toBe(rogueMpBefore);

    resolveRound(combat, ctx);

    expect(combat.outcome).toBe("victory");
    expect(combat.log.some((l) => l.text.includes(rogue.name))).toBe(false);
    expect(rogue.mp).toBe(rogueMpBefore);
  });

  test("skill mp is never spent when a singleAlly heal's target is already dead", () => {
    const { ctx } = makeCtx();
    const acolyte = createCharacter("acolyte1", "Acolyte", getClass("acolyte"));
    ctx.party.push(acolyte);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const vanguardRef: CombatantRef = { kind: "character", id: vanguard.id };
    const monster = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [monster.id], ctx, false);

    const acolyteMpBefore = acolyte.mp;
    expect(queueAction(combat, { kind: "character", id: acolyte.id }, "acolyte-heal", [vanguardRef], ctx)).toBeNull();
    expect(acolyte.mp).toBe(acolyteMpBefore);

    vanguard.hp = 0;
    vanguard.isAlive = false;
    resolveRound(combat, ctx);

    expect(combat.outcome).toBeUndefined();
    expect(combat.log.some((l) => l.text.includes(acolyte.name) && l.text.includes("wasted"))).toBe(true);
    expect(acolyte.mp).toBe(acolyteMpBefore);
  });

  test("skill mp and cooldown are never spent when the caster is stunned before acting", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.activeStatusEffects.push({ statusEffectId: "stunned", turnsRemaining: 1 });
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const selfRef: CombatantRef = { kind: "character", id: vanguard.id };

    const mpBefore = vanguard.mp;
    expect(queueAction(combat, selfRef, "vanguard-shield-guard", [selfRef], ctx)).toBeNull();
    expect(vanguard.mp).toBe(mpBefore);
    expect(vanguard.cooldownsRemaining["vanguard-shield-guard"]).toBeUndefined();

    resolveRound(combat, ctx);

    expect(combat.log.some((l) => l.text.includes("is stunned"))).toBe(true);
    expect(vanguard.mp).toBe(mpBefore);
    expect(vanguard.cooldownsRemaining["vanguard-shield-guard"]).toBeUndefined();
  });
});

describe("skill rank resolution", () => {
  const mockSkill: SkillDefinition = {
    id: "mock-skill",
    name: "Mock Skill",
    description: "",
    mpCost: 5,
    target: "singleEnemy",
    effects: [{ kind: "damage", amount: 10 }],
    slot: 1,
    unlockLevel: 1,
    ranks: [
      { rank: 1, unlockLevel: 1, mpCost: 5, effects: [{ kind: "damage", amount: 10 }] },
      { rank: 2, unlockLevel: 7, mpCost: 6, effects: [{ kind: "damage", amount: 13 }] },
      { rank: 3, unlockLevel: 15, mpCost: 7, effects: [{ kind: "damage", amount: 16 }] },
    ],
  };

  test("below rank-2 threshold resolves to rank-1 numbers", () => {
    const effective = getEffectiveSkill(mockSkill, 6);
    expect(effective.mpCost).toBe(5);
    expect(effective.effects).toEqual([{ kind: "damage", amount: 10 }]);
  });

  test("at/above rank-2 threshold but below rank-3 resolves to rank-2 numbers", () => {
    const effective = getEffectiveSkill(mockSkill, 7);
    expect(effective.mpCost).toBe(6);
    expect(effective.effects).toEqual([{ kind: "damage", amount: 13 }]);
    expect(getEffectiveSkill(mockSkill, 14).mpCost).toBe(6);
  });

  test("at/above rank-3 threshold resolves to rank-3 numbers", () => {
    const effective = getEffectiveSkill(mockSkill, 15);
    expect(effective.mpCost).toBe(7);
    expect(effective.effects).toEqual([{ kind: "damage", amount: 16 }]);
    expect(getEffectiveSkill(mockSkill, 100).mpCost).toBe(7);
  });

  test("a skill with no ranks is returned unchanged", () => {
    const noRanks = getSkill("vanguard-slash");
    expect(getEffectiveSkill(noRanks, 100)).toBe(noRanks);
  });

  test("a rank switching to a different effects array doesn't leak the previous rank's effects", () => {
    const mixedSkill: SkillDefinition = {
      id: "mock-mixed-skill",
      name: "Mock Mixed Skill",
      description: "",
      mpCost: 5,
      target: "singleAllyOrEnemy",
      effects: [{ kind: "heal", amount: 10, appliesToRelation: "ally" }, { kind: "damage", amount: 10, appliesToRelation: "enemy" }],
      slot: 1,
      unlockLevel: 1,
      ranks: [
        { rank: 1, unlockLevel: 1, mpCost: 5, effects: [{ kind: "heal", amount: 10, appliesToRelation: "ally" }, { kind: "damage", amount: 10, appliesToRelation: "enemy" }] },
        { rank: 2, unlockLevel: 7, mpCost: 6, effects: [{ kind: "damage", amount: 13 }] },
      ],
    };
    const rank2 = getEffectiveSkill(mixedSkill, 7);
    expect(rank2.effects).toEqual([{ kind: "damage", amount: 13 }]);
  });
});


describe("onHitAoeDamage, conditionalBonus, lifestealPercent, accuracyPenaltyPercent", () => {
  test("onHitAoeDamage: a landed hit splashes AoE damage to every living enemy", () => {
    STATUS_EFFECTS.push({
      id: "test-storm-empowered",
      name: "Test Storm-Empowered",
      description: "",
      perTurnEffects: [],
      onHitAoeDamage: { amount: 6, isMagic: true, ignoreDefensePercent: 30 },
    });
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.activeStatusEffects.push({ statusEffectId: "test-storm-empowered", turnsRemaining: 3 });
    const rat1 = spawnInto(ctx, "dungeon-rat");
    const rat2 = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat1.id, rat2.id], ctx, false);
    const enemyRefs = livingMonsterRefs(combat, ctx);
    const hpBefore = enemyRefs.map((r) => getActorByRef(r, ctx).hp);

    queueAction(combat, { kind: "character", id: vanguard.id }, "vanguard-slash", [enemyRefs[0]!], ctx);
    resolveRound(combat, ctx);

    for (let i = 0; i < enemyRefs.length; i++) {
      expect(getActorByRef(enemyRefs[i]!, ctx).hp).toBeLessThan(hpBefore[i]!);
    }
  });

  test("onHitAoeDamage: an AoE skill splashes once per cast, not once per target", () => {
    STATUS_EFFECTS.push({
      id: "test-storm-empowered-aoe",
      name: "Test Storm-Empowered AoE",
      description: "",
      perTurnEffects: [],
      onHitAoeDamage: { amount: 6, isMagic: true, ignoreDefensePercent: 30 },
    });
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.mp = 999;
    vanguard.unlockedSkillIds.push("vanguard-heavy-charge");
    vanguard.activeStatusEffects.push({ statusEffectId: "test-storm-empowered-aoe", turnsRemaining: 3 });
    const rat1 = spawnInto(ctx, "dungeon-rat");
    const rat2 = spawnInto(ctx, "dungeon-rat");
    rat1.maxHp = 500;
    rat1.hp = 500;
    rat2.maxHp = 500;
    rat2.hp = 500;
    const combat = startCombat("r1", [rat1.id, rat2.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    const targets = autoResolveTargets("allEnemies", self, combat, ctx) ?? [];

    const directDmg = Math.max(1, Math.round(mitigatedOffense(vanguard.attack * 0.7, rat1.defense) + 20));
    const splashDmg = Math.max(1, Math.round(mitigatedOffense(vanguard.magicPower, rat1.defense * 0.7) + 6));

    queueAction(combat, self, "vanguard-heavy-charge", targets, ctx);
    resolveRound(combat, ctx);

    const dmgTaken1 = 500 - getActorByRef({ kind: "monster", id: rat1.id }, ctx).hp;
    const dmgTaken2 = 500 - getActorByRef({ kind: "monster", id: rat2.id }, ctx).hp;

    expect(dmgTaken1).toBe(directDmg + splashDmg);
    expect(dmgTaken2).toBe(directDmg + splashDmg);
  });

  test("onHitAoeDamage: splash damage is scoped to the current combat's enemies, not every monster on the floor", () => {
    STATUS_EFFECTS.push({
      id: "test-storm-empowered-scope",
      name: "Test Storm-Empowered Scope",
      description: "",
      perTurnEffects: [],
      onHitAoeDamage: { amount: 6, isMagic: true, ignoreDefensePercent: 30 },
    });
    const { ctx, monsters } = makeCtx();
    const offFloor = monsters.slice(0, 2);
    const offFloorHpBefore = offFloor.map((m) => m.hp);

    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.activeStatusEffects.push({ statusEffectId: "test-storm-empowered-scope", turnsRemaining: 3 });
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);

    queueAction(combat, { kind: "character", id: vanguard.id }, "vanguard-slash", [{ kind: "monster", id: rat.id }], ctx);
    resolveRound(combat, ctx);

    for (let i = 0; i < offFloor.length; i++) {
      expect(offFloor[i]!.hp).toBe(offFloorHpBefore[i]!);
    }
  });

  test("onHitAoeDamage: offenseMultiplierPercent scales the splash's magicPower contribution, same as a skill's own damage effect", () => {
    STATUS_EFFECTS.push({
      id: "test-storm-empowered-scaled",
      name: "Test Storm-Empowered Scaled",
      description: "",
      perTurnEffects: [],
      onHitAoeDamage: { amount: 6, isMagic: true, ignoreDefensePercent: 30, offenseMultiplierPercent: 50 },
    });
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.magicPower = 100;
    vanguard.activeStatusEffects.push({ statusEffectId: "test-storm-empowered-scaled", turnsRemaining: 3 });
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = 500;
    rat.hp = 500;
    const combat = startCombat("r1", [rat.id], ctx, false);

    const splashDmg = Math.max(1, Math.round(mitigatedOffense(vanguard.magicPower * 0.5, rat.defense * 0.7) + 6));
    queueAction(combat, { kind: "character", id: vanguard.id }, "vanguard-slash", [{ kind: "monster", id: rat.id }], ctx);
    resolveRound(combat, ctx);

    const basicAttackDmg = Math.max(1, Math.round(mitigatedOffense(vanguard.attack, rat.defense)));
    const dmgTaken = 500 - getActorByRef({ kind: "monster", id: rat.id }, ctx).hp;
    expect(dmgTaken).toBe(basicAttackDmg + splashDmg);
  });

  test("conditionalBonus: adds ignoreDefensePercent when the required status is active, and keeps it when consumesStatus is absent", () => {
    STATUS_EFFECTS.push({
      id: "test-conditional-buff",
      name: "Test Conditional Buff",
      description: "",
      perTurnEffects: [],
    });
    CLASSES[0]!.skills.push({
      id: "test-conditional-skill",
      name: "Test Conditional Skill",
      description: "",
      mpCost: 0,
      target: "singleEnemy",
      effects: [{ kind: "damage", amount: 10 }],
      slot: 1,
      unlockLevel: 1,
      conditionalBonus: { requiresStatusId: "test-conditional-buff", ignoreDefensePercentBonus: 30 },
    });

    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("test-conditional-skill");
    vanguard.activeStatusEffects.push({ statusEffectId: "test-conditional-buff", turnsRemaining: 3 });
    const tanky = spawnInto(ctx, "skeleton-guard");
    // Explicit high defense, independent of skeleton-guard's current base stats: the ignoreDefensePercent
    // bonus only becomes visible in rounded damage once defense is high enough to cross a rounding
    // boundary — a hand-set value keeps that margin regardless of how base archetype stats get retuned.
    tanky.defense = 30;
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    const hpBefore = getActorByRef(enemyRef, ctx).hp;
    const noBonusDamage = Math.max(1, Math.round(mitigatedOffense(vanguard.attack, getActorByRef(enemyRef, ctx).defense)) + 10);

    queueAction(combat, { kind: "character", id: vanguard.id }, "test-conditional-skill", [enemyRef], ctx);
    resolveRound(combat, ctx);
    const actualDamage = hpBefore - getActorByRef(enemyRef, ctx).hp;

    expect(actualDamage).toBeGreaterThan(noBonusDamage);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "test-conditional-buff")).toBe(true);
  });

  test("conditionalBonus: consumesStatus removes the status after casting", () => {
    CLASSES[0]!.skills.push({
      id: "test-consuming-skill",
      name: "Test Consuming Skill",
      description: "",
      mpCost: 0,
      target: "singleEnemy",
      effects: [{ kind: "damage", amount: 10 }],
      slot: 1,
      unlockLevel: 1,
      isUltimate: true,
      conditionalBonus: { requiresStatusId: "test-conditional-buff", ignoreDefensePercentBonus: 60, consumesStatus: true },
    });

    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("test-consuming-skill");
    vanguard.activeStatusEffects.push({ statusEffectId: "test-conditional-buff", turnsRemaining: 3 });
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    const hpBefore = getActorByRef(enemyRef, ctx).hp;

    queueAction(combat, { kind: "character", id: vanguard.id }, "test-consuming-skill", [enemyRef], ctx);
    resolveRound(combat, ctx);

    expect(getActorByRef(enemyRef, ctx).hp).toBeLessThan(hpBefore);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "test-conditional-buff")).toBe(false);
  });

  test("conditionalBonus: consumesStatus does NOT remove the status if the bonus effect never actually connects", () => {
    CLASSES[0]!.skills.push({
      id: "test-whiff-consuming-skill",
      name: "Test Whiff Consuming Skill",
      description: "",
      mpCost: 0,
      target: "singleEnemy",
      effects: [{ kind: "damage", amount: 10, chance: 0 }],
      slot: 1,
      unlockLevel: 1,
      conditionalBonus: { requiresStatusId: "test-conditional-buff", ignoreDefensePercentBonus: 60, consumesStatus: true },
    });

    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("test-whiff-consuming-skill");
    vanguard.activeStatusEffects.push({ statusEffectId: "test-conditional-buff", turnsRemaining: 3 });
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    const hpBefore = getActorByRef(enemyRef, ctx).hp;

    queueAction(combat, { kind: "character", id: vanguard.id }, "test-whiff-consuming-skill", [enemyRef], ctx);
    resolveRound(combat, ctx);

    expect(getActorByRef(enemyRef, ctx).hp).toBe(hpBefore);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "test-conditional-buff")).toBe(true);
  });

  test("lifestealPercent heals the source by the given % of dealt damage, capped at maxHp", () => {
    const { ctx } = makeCtx();
    const bat = spawnInto(ctx, "black-bat");
    const rat = spawnInto(ctx, "dungeon-rat");
    bat.hp = 1;
    const log: LogEntry[] = [];
    const dealt = resolveSkillEffect({ kind: "damage", amount: 2, lifestealPercent: 50 }, bat, rat, { log });
    expect(bat.hp).toBe(Math.min(bat.maxHp, 1 + Math.round(dealt * 0.5)));
    expect(log.some((l) => l.kind === "heal")).toBe(true);
  });

  test("lifestealPercent heal is capped at the source's maxHp", () => {
    const { ctx } = makeCtx();
    const bat = spawnInto(ctx, "black-bat");
    const rat = spawnInto(ctx, "dungeon-rat");
    bat.hp = bat.maxHp;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "damage", amount: 2, lifestealPercent: 50 }, bat, rat, { log });
    expect(bat.hp).toBe(bat.maxHp);
  });

  test("rollHits: a monster with no accuracyPenaltyPercent status always hits", () => {
    const { ctx } = makeCtx();
    const rat = spawnInto(ctx, "dungeon-rat");
    expect(rollHits(rat, () => 0)).toBe(true);
  });

  test("rollHits: a monster carrying an accuracyPenaltyPercent status misses below the threshold, hits at/above it", () => {
    STATUS_EFFECTS.push({
      id: "test-blinded",
      name: "Test Blinded",
      description: "",
      perTurnEffects: [],
      accuracyPenaltyPercent: 60,
    });
    const { ctx } = makeCtx();
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.activeStatusEffects.push({ statusEffectId: "test-blinded", turnsRemaining: 2 });
    expect(rollHits(rat, () => 0.5)).toBe(false);
    expect(rollHits(rat, () => 0.7)).toBe(true);
  });

  test("rollHits: a character's fear penalty and accuracyPenaltyPercent status combine, clamped at 100%", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.survival.fear = 50;
    vanguard.activeStatusEffects.push({ statusEffectId: "test-blinded", turnsRemaining: 2 });
    expect(getFearAccuracyPenalty(getFearTier(vanguard.survival.fear))).toBeCloseTo(0.1);
    expect(rollHits(vanguard, () => 0.65)).toBe(false);
    expect(rollHits(vanguard, () => 0.75)).toBe(true);

    vanguard.activeStatusEffects.push({ statusEffectId: "test-blinded", turnsRemaining: 2 });
    expect(rollHits(vanguard, () => 0.99)).toBe(false);
  });

  test("isHelpfulStatusEffect: a status with only accuracyPenaltyPercent set is a debuff, not a buff", () => {
    expect(isHelpfulStatusEffect(getStatusEffect("test-blinded"))).toBe(false);
  });

  test("a monster's basicAttack rolls rollHits: never misses without accuracyPenaltyPercent, can miss when Blinded", () => {
    let missWithoutBlinded = 0;
    let missWithBlinded = 0;
    for (let seed = 0; seed < 40; seed++) {
      const plain = makeCtx(seed).ctx;
      const zombiePlain = spawnInto(plain, "zombie");
      const combatPlain = startCombat("r1", [zombiePlain.id], plain, false);
      resolveRound(combatPlain, plain);
      if (combatPlain.log.some((l) => l.text.includes("misses its attack"))) missWithoutBlinded++;

      const blinded = makeCtx(seed).ctx;
      const zombieBlinded = spawnInto(blinded, "zombie");
      zombieBlinded.activeStatusEffects.push({ statusEffectId: "blinded", turnsRemaining: 2 });
      const combatBlinded = startCombat("r1", [zombieBlinded.id], blinded, false);
      resolveRound(combatBlinded, blinded);
      if (combatBlinded.log.some((l) => l.text.includes("misses its attack"))) missWithBlinded++;
    }
    expect(missWithoutBlinded).toBe(0);
    expect(missWithBlinded).toBeGreaterThan(0);
  });
});


describe("Vanguard skill ranks", () => {
  test("Shield Guard ranks resolve to guard-ii/guard-iii at lv7/lv15", () => {
    const skill = getSkill("vanguard-shield-guard");
    expect(getEffectiveSkill(skill, 1).mpCost).toBe(8);
    expect(getEffectiveSkill(skill, 1).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "guard", durationTurns: 1 },
      { kind: "applyStatusEffect", statusEffectId: "taunt", durationTurns: 1 },
    ]);
    expect(getEffectiveSkill(skill, 7).mpCost).toBe(9);
    expect(getEffectiveSkill(skill, 7).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "guard-ii", durationTurns: 1 },
      { kind: "applyStatusEffect", statusEffectId: "taunt", durationTurns: 1 },
    ]);
    expect(getEffectiveSkill(skill, 15).mpCost).toBe(10);
    expect(getEffectiveSkill(skill, 15).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "guard-iii", durationTurns: 1 },
      { kind: "applyStatusEffect", statusEffectId: "taunt", durationTurns: 1 },
    ]);
  });

  test("Sword Judgment ranks resolve to dmg 30/40/50 at lv35/70/100", () => {
    const skill = getSkill("vanguard-sword-judgment");
    expect(getEffectiveSkill(skill, 35).effects).toEqual([{ kind: "damage", amount: 30, offenseMultiplierPercent: 85 }]);
    expect(getEffectiveSkill(skill, 70).effects).toEqual([{ kind: "damage", amount: 40, offenseMultiplierPercent: 95 }]);
    expect(getEffectiveSkill(skill, 100).effects).toEqual([{ kind: "damage", amount: 50, offenseMultiplierPercent: 110 }]);
  });
});


describe("Mage skill ranks", () => {
  test("Fireball ranks resolve dmg/mp/burn-chance at lv1/7/15", () => {
    const skill = getSkill("mage-fireball");
    expect(getEffectiveSkill(skill, 1)).toMatchObject({
      mpCost: 5,
      effects: [
        { kind: "damage", amount: 10 },
        { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.3 },
      ],
    });
    expect(getEffectiveSkill(skill, 7)).toMatchObject({
      mpCost: 6,
      effects: [
        { kind: "damage", amount: 13 },
        { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.4 },
      ],
    });
    expect(getEffectiveSkill(skill, 15)).toMatchObject({
      mpCost: 7,
      effects: [
        { kind: "damage", amount: 16 },
        { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.5 },
      ],
    });
  });

  test("Ice Age ranks resolve dmg 20/25/35 at lv35/70/100", () => {
    const skill = getSkill("mage-ice-age");
    expect(getEffectiveSkill(skill, 35).effects).toEqual([{ kind: "damage", amount: 20, offenseMultiplierPercent: 110, damageType: "ice" }]);
    expect(getEffectiveSkill(skill, 70).effects).toEqual([{ kind: "damage", amount: 25, offenseMultiplierPercent: 120, damageType: "ice" }]);
    expect(getEffectiveSkill(skill, 100).effects).toEqual([{ kind: "damage", amount: 35, offenseMultiplierPercent: 130, damageType: "ice" }]);
  });
});


/** Every base stat must be a finite non-negative number and growthWeights must have exactly the 5 expected
 * keys, each a finite non-negative number. Reads whatever is currently in data/classes.json rather than
 * pinning exact tuned numbers — those are expected to change via the rebalance-editor tool, and a test that
 * hard-codes a rebalance's output just breaks on the next legitimate rebalance instead of catching real bugs. */
function expectValidCharacterBase(cls: ReturnType<typeof getClass>) {
  for (const key of ["baseAttack", "baseDefense", "baseMaxHp", "baseMaxMp", "baseMagicPower", "baseAggro", "baseSpeed"] as const) {
    expect(Number.isFinite(cls[key])).toBe(true);
    expect(cls[key]).toBeGreaterThanOrEqual(0);
  }
  const gw = GROWTH_WEIGHTS.classGrowthWeights[cls.id]!;
  expect(Object.keys(gw).sort()).toEqual(["attack", "defense", "magicPower", "maxHp", "maxMp"]);
  for (const value of Object.values(gw)) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
}

describe("Rogue rebalance + Plague Doctor class base", () => {
  test("Rogue has valid base stats and growth weights", () => {
    expectValidCharacterBase(getClass("rogue"));
  });

  test("Plague Doctor has valid base stats, growth weights, and 6 skills", () => {
    const doc = getClass("plague-doctor");
    expectValidCharacterBase(doc);
    expect(doc.skills.length).toBe(6);
  });

  test("blinded status has accuracyPenaltyPercent 60, no perTurnEffects", () => {
    const blinded = getStatusEffect("blinded");
    expect(blinded.accuracyPenaltyPercent).toBe(60);
    expect(blinded.perTurnEffects).toEqual([]);
    expect(isHelpfulStatusEffect(blinded)).toBe(false);
  });

  test("Fire Vial ranks resolve dmg/burn% at lv1/7/15", () => {
    const skill = getSkill("plaguedoc-fire-vial");
    expect(getEffectiveSkill(skill, 1).effects).toEqual([
      { kind: "damage", amount: 10, offenseMultiplierPercent: 90, damageType: "fire" },
      { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.6, durationTurns: 2 },
    ]);
    expect(getEffectiveSkill(skill, 7).effects).toEqual([
      { kind: "damage", amount: 12, offenseMultiplierPercent: 95, damageType: "fire" },
      { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.7, durationTurns: 2 },
    ]);
    expect(getEffectiveSkill(skill, 15).effects).toEqual([
      { kind: "damage", amount: 16, offenseMultiplierPercent: 105, damageType: "fire" },
      { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.8, durationTurns: 2 },
    ]);
  });

  test("Total Plague ranks resolve ally/enemy effects (via appliesToRelation) at lv35/100", () => {
    const skill = getSkill("plaguedoc-total-plague");
    expect(getEffectiveSkill(skill, 35).effects).toEqual([
      { kind: "heal", amount: 20, offenseMultiplierPercent: 60, appliesToRelation: "ally" },
      { kind: "removeStatusEffect", appliesToRelation: "ally" },
      { kind: "damage", amount: 10, offenseMultiplierPercent: 70, appliesToRelation: "enemy" },
      { kind: "applyStatusEffect", statusEffectId: "poisoned", chance: 0.8, durationTurns: 3, appliesToRelation: "enemy" },
      { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.8, durationTurns: 2, appliesToRelation: "enemy" },
    ]);
    expect(getEffectiveSkill(skill, 100).effects).toEqual([
      { kind: "heal", amount: 31, offenseMultiplierPercent: 70, appliesToRelation: "ally" },
      { kind: "removeStatusEffect", appliesToRelation: "ally" },
      { kind: "damage", amount: 16, offenseMultiplierPercent: 85, appliesToRelation: "enemy" },
      { kind: "applyStatusEffect", statusEffectId: "poisoned", chance: 0.9, durationTurns: 3, appliesToRelation: "enemy" },
      { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.9, durationTurns: 2, appliesToRelation: "enemy" },
    ]);
  });

  test("Blinding Vial, when its proc succeeds, applies blinded to the target and logs it as a debuff", () => {
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const doc = ctx.party.find((p) => p.classId === "plague-doctor")!;
      doc.unlockedSkillIds.push("plaguedoc-blinding-vial");
      doc.mp = 999;
      const tanky = spawnInto(ctx, "skeleton-guard");
      const combat = startCombat("r1", [tanky.id], ctx, false);
      const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
      queueAction(combat, { kind: "character", id: doc.id }, "plaguedoc-blinding-vial", [enemyRef], ctx);
      resolveRound(combat, ctx);
      const enemyActor = getActorByRef(enemyRef, ctx);
      if (!enemyActor.activeStatusEffects.some((s) => s.statusEffectId === "blinded")) continue;
      found = true;
      expect(combat.log.some((l) => l.text.includes("gains the Blinded effect") && l.kind === "debuff")).toBe(true);
    }
    expect(found).toBe(true);
  });

  test("blinded's accuracyPenaltyPercent makes the bearer miss more via rollHits", () => {
    const { ctx } = makeCtx();
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.activeStatusEffects.push({ statusEffectId: "blinded", turnsRemaining: 2 });
    expect(rollHits(rat, () => 0.5)).toBe(false);
    expect(rollHits(rat, () => 0.7)).toBe(true);
  });

  test("Total Plague heals+cures allies and damages+afflicts enemies in the same cast", () => {
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const doc = ctx.party.find((p) => p.classId === "plague-doctor")!;
      doc.unlockedSkillIds.push("plaguedoc-total-plague");
      doc.mp = 999;
      const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
      vanguard.activeStatusEffects.push({ statusEffectId: "weakened", turnsRemaining: 2 });
      vanguard.hp = 1;
      const tanky = spawnInto(ctx, "skeleton-guard");
      const combat = startCombat("r1", [tanky.id], ctx, false);
      const docRef: CombatantRef = { kind: "character", id: doc.id };
      const targets = autoResolveTargets("allAlliesAndEnemies", docRef, combat, ctx) ?? [];
      queueAction(combat, docRef, "plaguedoc-total-plague", targets, ctx);
      resolveRound(combat, ctx);

      expect(combat.log.some((l) => l.text.startsWith(vanguard.name) && l.text.includes("recovers"))).toBe(true);
      expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "weakened")).toBe(false);
      const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
      const enemyActor = getActorByRef(enemyRef, ctx);
      if (!enemyActor.activeStatusEffects.some((s) => s.statusEffectId === "poisoned" || s.statusEffectId === "burning")) continue;
      found = true;
    }
    expect(found).toBe(true);
  });
});


describe("Viking class", () => {
  test("Viking has valid base stats, growth weights, and 6 skills", () => {
    const viking = getClass("viking");
    expectValidCharacterBase(viking);
    expect(viking.skills.length).toBe(6);
  });

  test("Lightning Axe applies storm-empowered + storm-recoil at rank 1", () => {
    const skill = getSkill("viking-lightning-axe");
    expect(getEffectiveSkill(skill, 1).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "storm-empowered", durationTurns: 3 },
      { kind: "applyStatusEffect", statusEffectId: "storm-recoil", durationTurns: 1 },
    ]);
  });

  test("Lightning Axe ranks reference storm-empowered-ii/iii, storm-recoil unchanged", () => {
    const skill = getSkill("viking-lightning-axe");
    expect(getEffectiveSkill(skill, 7).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "storm-empowered-ii", durationTurns: 3 },
      { kind: "applyStatusEffect", statusEffectId: "storm-recoil", durationTurns: 1 },
    ]);
    expect(getEffectiveSkill(skill, 15).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "storm-empowered-iii", durationTurns: 3 },
      { kind: "applyStatusEffect", statusEffectId: "storm-recoil", durationTurns: 1 },
    ]);
  });

  test("Thunder God's Fury has consumesStatus conditionalBonus and ranks resolve dmg 30/40/50", () => {
    const skill = getSkill("viking-thunder-god-fury");
    expect(skill.conditionalBonus).toEqual({ requiresStatusId: "storm-empowered", ignoreDefensePercentBonus: 60, consumesStatus: true });
    expect(getEffectiveSkill(skill, 35).effects).toEqual([{ kind: "damage", amount: 30, offenseMultiplierPercent: 80, damageType: "lightning" }]);
    expect(getEffectiveSkill(skill, 70).effects).toEqual([{ kind: "damage", amount: 40, offenseMultiplierPercent: 100, damageType: "lightning" }]);
    expect(getEffectiveSkill(skill, 100).effects).toEqual([{ kind: "damage", amount: 50, offenseMultiplierPercent: 120, damageType: "lightning" }]);
  });

  test("Frenzied Slash/Throw Axe/Spinning Axe ranks resolve dmg+bleed%", () => {
    const slash = getSkill("viking-frenzied-slash");
    expect(getEffectiveSkill(slash, 7).effects).toEqual([
      { kind: "damage", amount: 12, offenseMultiplierPercent: 100 },
      { kind: "applyStatusEffect", statusEffectId: "bleeding", chance: 0.6, durationTurns: 3 },
    ]);
    expect(getEffectiveSkill(slash, 15).effects).toEqual([
      { kind: "damage", amount: 15, offenseMultiplierPercent: 105 },
      { kind: "applyStatusEffect", statusEffectId: "bleeding", chance: 0.7, durationTurns: 3 },
    ]);

    const throwAxe = getSkill("viking-throw-axe");
    expect(getEffectiveSkill(throwAxe, 25).effects).toEqual([{ kind: "damage", amount: 20, offenseMultiplierPercent: 107 }]);
    expect(getEffectiveSkill(throwAxe, 45).effects).toEqual([{ kind: "damage", amount: 25, offenseMultiplierPercent: 115 }]);

    const spinAxe = getSkill("viking-spin-axe");
    expect(getEffectiveSkill(spinAxe, 50).effects).toEqual([
      { kind: "damage", amount: 20, offenseMultiplierPercent: 77 },
      { kind: "applyStatusEffect", statusEffectId: "bleeding", chance: 0.4, durationTurns: 3 },
    ]);
    expect(getEffectiveSkill(spinAxe, 75).effects).toEqual([
      { kind: "damage", amount: 30, offenseMultiplierPercent: 85 },
      { kind: "applyStatusEffect", statusEffectId: "bleeding", chance: 0.5, durationTurns: 3 },
    ]);
  });

  test("storm-empowered-ii/iii and bleeding statuses exist with the documented fields", () => {
    expect(getStatusEffect("storm-empowered-ii").onHitAoeDamage).toEqual({ amount: 8, isMagic: true, offenseMultiplierPercent: 90, ignoreDefensePercent: 30, damageType: "lightning" });
    expect(getStatusEffect("storm-empowered-iii").onHitAoeDamage).toEqual({ amount: 10, isMagic: true, offenseMultiplierPercent: 100, ignoreDefensePercent: 30, damageType: "lightning" });
    expect(getStatusEffect("bleeding").perTurnEffects).toEqual([{ kind: "damage", amount: 6, maxHpPercent: 2, damageType: "bleed" }]);
    expect(getStatusEffect("bleeding").stackable).toBe(true);
    expect(getStatusEffect("bleeding").maxStacks).toBe(5);
    expect(getStatusEffect("bleeding").perStackBonusPercent).toBe(100);
  });

  test("full combat sequence: Lightning Axe -> Frenzied Slash -> Thunder God's Fury", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.mp = 999;
    viking.unlockedSkillIds.push("viking-thunder-god-fury");
    const rat1 = spawnInto(ctx, "dungeon-rat");
    const rat2 = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat1.id, rat2.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: viking.id };
    const rat1Ref: CombatantRef = { kind: "monster", id: rat1.id };

    queueAction(combat, self, "viking-lightning-axe", [self], ctx);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("gains the Storm-Empowered effect"))).toBe(true);
    expect(viking.activeStatusEffects.some((s) => s.statusEffectId === "storm-empowered")).toBe(true);

    const rat2HpBefore = getActorByRef({ kind: "monster", id: rat2.id }, ctx).hp;
    queueAction(combat, self, "viking-frenzied-slash", [rat1Ref], ctx);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("misses"))).toBe(false);
    const rat2HpAfter = getActorByRef({ kind: "monster", id: rat2.id }, ctx).hp;
    expect(rat2HpAfter).toBeLessThan(rat2HpBefore);
    expect(viking.activeStatusEffects.some((s) => s.statusEffectId === "storm-empowered")).toBe(true);

    const ultimateTargets = autoResolveTargets("allEnemies", self, combat, ctx) ?? [];
    queueAction(combat, self, "viking-thunder-god-fury", ultimateTargets, ctx);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("Thunder God's Fury"))).toBe(true);
    expect(viking.activeStatusEffects.some((s) => s.statusEffectId === "storm-empowered")).toBe(false);
  });

  test("rank-resolution picks up Viking's rank-2/3 numbers at the correct character level", () => {
    const skill = getSkill("viking-throw-axe");
    const character = createCharacter("vk-test", "Viking Test", getClass("viking"), 25);
    expect(getEffectiveSkill(skill, character.level).effects).toEqual([{ kind: "damage", amount: 20, offenseMultiplierPercent: 107 }]);
  });

  test("conditionalBonus still triggers on the rank-2 buff variant", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.level = 10;
    viking.mp = 999;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.defense = 15;
    rat.maxHp = 500;
    rat.hp = 500;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: viking.id };
    const enemyRef: CombatantRef = { kind: "monster", id: rat.id };

    queueAction(combat, self, "viking-lightning-axe", [self], ctx);
    resolveRound(combat, ctx);
    expect(viking.activeStatusEffects.some((s) => s.statusEffectId === "storm-empowered-ii")).toBe(true);

    // storm-empowered's own onHitAoeDamage splash also lands on the same single enemy every cast, independent of
    // whether Frenzied Slash's conditionalBonus applies — so the fix must be verified on the DIRECT hit's exact
    // damage (parsed from the log), not the round's total HP delta, which the splash would confound either way.
    const withBonusDamage = Math.max(1, Math.round(12 + mitigatedOffense(viking.attack, rat.defense * 0.7)));
    const noBonusDamage = Math.max(1, Math.round(12 + mitigatedOffense(viking.attack, rat.defense)));
    expect(withBonusDamage).toBeGreaterThan(noBonusDamage);

    const logBefore = combat.log.length;
    queueAction(combat, self, "viking-frenzied-slash", [enemyRef], ctx);
    resolveRound(combat, ctx);
    const directHitLine = combat.log.slice(logBefore).find((l) => /^Dungeon Rat takes \d+ damage from Viking's Frenzied Slash\.$/.test(l.text));
    const directDamage = Number(directHitLine!.text.match(/takes (\d+) damage/)![1]);

    expect(directDamage).toBe(withBonusDamage);
  });

  test("consumesStatus still removes the rank-3 buff variant", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.level = 40;
    viking.mp = 999;
    viking.unlockedSkillIds.push("viking-thunder-god-fury");
    const rat1 = spawnInto(ctx, "dungeon-rat");
    const rat2 = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat1.id, rat2.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: viking.id };

    queueAction(combat, self, "viking-lightning-axe", [self], ctx);
    resolveRound(combat, ctx);
    expect(viking.activeStatusEffects.some((s) => s.statusEffectId === "storm-empowered-iii")).toBe(true);

    const ultimateTargets = autoResolveTargets("allEnemies", self, combat, ctx) ?? [];
    queueAction(combat, self, "viking-thunder-god-fury", ultimateTargets, ctx);
    resolveRound(combat, ctx);

    expect(viking.activeStatusEffects.some((s) => s.statusEffectId.startsWith("storm-empowered"))).toBe(false);
  });
});


describe("Rogue skill ranks + poison exclusivity", () => {
  test("Poison Bomb ranks deal upfront damage and apply poisoned-ii/iii, exclusive to this skill", () => {
    const bomb = getSkill("rogue-poison-bomb");
    expect(getEffectiveSkill(bomb, 20).effects).toEqual([
      { kind: "damage", amount: 10, offenseMultiplierPercent: 50 },
      { kind: "applyStatusEffect", statusEffectId: "poisoned", durationTurns: 3 },
    ]);
    expect(getEffectiveSkill(bomb, 50).effects).toEqual([
      { kind: "damage", amount: 20, offenseMultiplierPercent: 55 },
      { kind: "applyStatusEffect", statusEffectId: "poisoned-ii", durationTurns: 3 },
    ]);
    expect(getEffectiveSkill(bomb, 75).effects).toEqual([
      { kind: "damage", amount: 30, offenseMultiplierPercent: 60 },
      { kind: "applyStatusEffect", statusEffectId: "poisoned-iii", durationTurns: 3 },
    ]);
  });

  test("Poison Coat's on-hit rider always applies plain poisoned, even at rank 2/3", () => {
    const coat = getSkill("rogue-poison-coat");
    // Ranks 2/3 apply the same base "poison-coat" rider status alongside a separate attack-buff
    // status (venom-edge/-ii) — the on-hit rider itself never changes rank.
    expect(getStatusEffect("poison-coat").onHitStatusEffectId).toBe("poisoned");

    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.unlockedSkillIds.push(coat.id);
    rogue.level = 15;
    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: rogue.id };
    queueAction(combat, self, "rogue-poison-coat", [self], ctx);
    resolveRound(combat, ctx);
    expect(rogue.activeStatusEffects.some((s) => s.statusEffectId === "poison-coat")).toBe(true);
    expect(rogue.activeStatusEffects.some((s) => s.statusEffectId === "venom-edge-ii")).toBe(true);

    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    queueAction(combat, self, "rogue-knife-throw", [enemyRef], ctx);
    resolveRound(combat, ctx);
    const enemyActor = getActorByRef(enemyRef, ctx);
    expect(enemyActor.activeStatusEffects.some((s) => s.statusEffectId === "poisoned")).toBe(true);
    expect(enemyActor.activeStatusEffects.some((s) => s.statusEffectId === "poisoned-ii" || s.statusEffectId === "poisoned-iii")).toBe(false);
  });
});


describe("Acolyte skill ranks incl. appliesToRelation", () => {
  test("Heal ranks resolve heal 16/22/30 at lv1/7/15", () => {
    const skill = getSkill("acolyte-heal");
    expect(getEffectiveSkill(skill, 1).effects).toEqual([{ kind: "heal", amount: 16, offenseMultiplierPercent: 90 }]);
    expect(getEffectiveSkill(skill, 7).effects).toEqual([{ kind: "heal", amount: 22, offenseMultiplierPercent: 100 }]);
    expect(getEffectiveSkill(skill, 15).effects).toEqual([{ kind: "heal", amount: 30, offenseMultiplierPercent: 110 }]);
  });

  test("Divine Descent ranks resolve ally (heal+fear) / enemy (dmg) effects at lv35/70/100", () => {
    const skill = getSkill("acolyte-divine-descent");
    expect(getEffectiveSkill(skill, 35).effects).toEqual([
      { kind: "heal", amount: 25, offenseMultiplierPercent: 70, appliesToRelation: "ally" },
      { kind: "modifyStat", stat: "fear", amount: -15, appliesToRelation: "ally" },
      { kind: "damage", amount: 20, offenseMultiplierPercent: 80, appliesToRelation: "enemy", damageType: "holy" },
    ]);
    expect(getEffectiveSkill(skill, 70).effects).toEqual([
      { kind: "heal", amount: 30, offenseMultiplierPercent: 75, appliesToRelation: "ally" },
      { kind: "modifyStat", stat: "fear", amount: -20, appliesToRelation: "ally" },
      { kind: "damage", amount: 25, offenseMultiplierPercent: 85, appliesToRelation: "enemy", damageType: "holy" },
    ]);
    expect(getEffectiveSkill(skill, 100).effects).toEqual([
      { kind: "heal", amount: 40, offenseMultiplierPercent: 80, appliesToRelation: "ally" },
      { kind: "modifyStat", stat: "fear", amount: -25, appliesToRelation: "ally" },
      { kind: "damage", amount: 30, offenseMultiplierPercent: 90, appliesToRelation: "enemy", damageType: "holy" },
    ]);
  });

  test("Purify ranks resolve the enemy-side damage only, ally side always removeStatusEffect", () => {
    const skill = getSkill("acolyte-purify");
    expect(getEffectiveSkill(skill, 10).effects).toEqual([
      { kind: "removeStatusEffect", appliesToRelation: "ally" },
      { kind: "damage", amount: 15, offenseMultiplierPercent: 100, appliesToRelation: "enemy", damageType: "holy" },
    ]);
    expect(getEffectiveSkill(skill, 45).effects).toEqual([
      { kind: "removeStatusEffect", appliesToRelation: "ally" },
      { kind: "damage", amount: 27, offenseMultiplierPercent: 120, appliesToRelation: "enemy", damageType: "holy" },
    ]);
  });
});

describe("Archer class", () => {
  test("Archer has valid base stats and growth weights", () => {
    expectValidCharacterBase(getClass("archer"));
  });

  test("Archer has 6 skills, slot 0 is a free flat-amount basic attack", () => {
    const archer = getClass("archer");
    expect(archer.skills.length).toBe(6);
    const basic = archer.skills.find((s) => s.slot === 0)!;
    expect(basic.id).toBe("archer-quick-shot");
    expect(basic.mpCost).toBe(0);
    expect(basic.effects).toEqual([{ kind: "damage", amount: 0 }]);
  });

  test("Aimed Shot ranks resolve dmg/critChance at lv1/7/15", () => {
    const skill = getSkill("archer-aimed-shot");
    expect(getEffectiveSkill(skill, 1).effects).toEqual([{ kind: "damage", amount: 16, offenseMultiplierPercent: 90, critChance: 0.3 }]);
    expect(getEffectiveSkill(skill, 7).effects).toEqual([{ kind: "damage", amount: 21, offenseMultiplierPercent: 95, critChance: 0.35 }]);
    expect(getEffectiveSkill(skill, 15).effects).toEqual([{ kind: "damage", amount: 26, offenseMultiplierPercent: 105, critChance: 0.4 }]);
  });

  test("Volley Shot's offense multiplier rises with rank", () => {
    const skill = getSkill("archer-volley-shot");
    for (const [level, amount, offenseMultiplierPercent] of [[10, 10, 60], [25, 14, 66], [45, 19, 75]] as const) {
      expect(getEffectiveSkill(skill, level).effects).toEqual([{ kind: "damage", amount, offenseMultiplierPercent }]);
    }
  });

  test("Deadeye Shot is an ultimate with guaranteed crit (critChance 1) at every rank", () => {
    const skill = getSkill("archer-deadeye-shot");
    expect(skill.isUltimate).toBe(true);
    expect(getEffectiveSkill(skill, 35).effects).toEqual([{ kind: "damage", amount: 20, offenseMultiplierPercent: 90, critChance: 1 }]);
    expect(getEffectiveSkill(skill, 100).effects).toEqual([{ kind: "damage", amount: 34, offenseMultiplierPercent: 110, critChance: 1 }]);
  });

  test("overwatched/-ii/-iii trigger Overwatch, with a rank-scaled attack bonus for the interrupt shot", () => {
    for (const [id, amount, minPercent] of [
      ["overwatched", 4, 5],
      ["overwatched-ii", 10, 12],
      ["overwatched-iii", 16, 18],
    ] as const) {
      const status = getStatusEffect(id);
      expect(status.triggersOverwatch).toBe(true);
      expect(status.perTurnEffects).toEqual([{ kind: "modifyCombatStat", combatStat: "attack", amount, minPercent }]);
    }
  });

  test("Archer is selectable and fights: Aimed Shot deals damage via a full combat round", () => {
    const { ctx } = makeCtx();
    const archer = ctx.party.find((p) => p.classId === "archer")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const enemy = livingMonsterRefs(combat, ctx)[0]!;
    const self: CombatantRef = { kind: "character", id: archer.id };
    const hpBefore = rat.hp;
    queueAction(combat, self, "archer-aimed-shot", [enemy], ctx);
    resolveRound(combat, ctx);
    expect(rat.hp).toBeLessThan(hpBefore);
  });
});

describe("Ninja class", () => {
  test("Ninja has valid base stats and growth weights", () => {
    expectValidCharacterBase(getClass("ninja"));
  });

  test("Ninja has 6 skills, slot 0 is a free flat-amount basic attack", () => {
    const ninja = getClass("ninja");
    expect(ninja.skills.length).toBe(6);
    const basic = ninja.skills.find((s) => s.slot === 0)!;
    expect(basic.id).toBe("ninja-kunai-strike");
    expect(basic.mpCost).toBe(0);
    expect(basic.effects).toEqual([{ kind: "damage", amount: 0 }]);
  });

  test("Throwing Knives ranks resolve dmg/offense%/extraHitChance/bleed% at lv10/25/45", () => {
    const skill = getSkill("ninja-throwing-knives");
    expect(getEffectiveSkill(skill, 10).effects).toEqual([
      { kind: "damage", amount: 10, offenseMultiplierPercent: 80, extraHitChance: 0.4 },
      { kind: "applyStatusEffect", statusEffectId: "bleeding", chance: 0.6, durationTurns: 3 },
    ]);
    expect(getEffectiveSkill(skill, 45).effects).toEqual([
      { kind: "damage", amount: 18, offenseMultiplierPercent: 90, extraHitChance: 0.5 },
      { kind: "applyStatusEffect", statusEffectId: "bleeding", chance: 0.8, durationTurns: 3 },
    ]);
    // No executeBonus on this skill (by design) — Death Mark carries the ninja's execute mechanic instead.
    expect(skill.executeBonus).toBeUndefined();
  });

  test("Shuriken Storm's hitCountRange widens by rank: 1-2 / 1-3 / 2-3", () => {
    const skill = getSkill("ninja-shuriken-storm");
    expect(getEffectiveSkill(skill, 20).effects?.[0]?.hitCountRange).toEqual({ min: 1, max: 2 });
    expect(getEffectiveSkill(skill, 50).effects?.[0]?.hitCountRange).toEqual({ min: 1, max: 3 });
    expect(getEffectiveSkill(skill, 75).effects?.[0]?.hitCountRange).toEqual({ min: 2, max: 3 });
  });

  test("Death Mark is an ultimate that scales with bleeding stacks and has a bigger executeBonus", () => {
    const skill = getSkill("ninja-death-mark");
    expect(skill.isUltimate).toBe(true);
    expect(skill.executeBonus).toEqual({ hpPercentThreshold: 30, bonusDamageFlat: 30 });
    expect(getEffectiveSkill(skill, 35).effects).toEqual([
      { kind: "damage", amount: 14, offenseMultiplierPercent: 100, scalesWithStatusStacks: { statusEffectId: "bleeding", percentPerStack: 5 } },
      { kind: "applyStatusEffect", statusEffectId: "bleeding", durationTurns: 3 },
    ]);
  });

  test("stealthed status is untargetable with a break bonus, no ordinary perTurnEffects", () => {
    const status = getStatusEffect("stealthed");
    expect(status.untargetable).toBe(true);
    expect(status.breakBonus).toEqual({ basicAttackGuaranteedCrit: true, skillDamageBonusPercent: 10 });
    expect(status.perTurnEffects).toEqual([]);
  });

  test("ninja-clone summon archetype exists with a basic-attack-only action weight table", () => {
    const archetype = getSummonArchetype("ninja-clone");
    expect(archetype.actionWeights).toEqual({ basicAttack: 1 });
  });

  test("Ninja is selectable and fights: Kunai Strike deals damage via a full combat round", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const enemy = livingMonsterRefs(combat, ctx)[0]!;
    const self: CombatantRef = { kind: "character", id: ninja.id };
    const hpBefore = rat.hp;
    queueAction(combat, self, "ninja-kunai-strike", [enemy], ctx);
    resolveRound(combat, ctx);
    expect(rat.hp).toBeLessThan(hpBefore);
  });
});

describe("Summoner class", () => {
  test("Summoner has valid base stats and growth weights", () => {
    expectValidCharacterBase(getClass("summoner"));
  });

  test("Summoner has 6 skills, slot 0 is a free flat-amount basic attack", () => {
    const summoner = getClass("summoner");
    expect(summoner.skills.length).toBe(6);
    const basic = summoner.skills.find((s) => s.slot === 0)!;
    expect(basic.id).toBe("summoner-totem-strike");
    expect(basic.mpCost).toBe(0);
    expect(basic.effects).toEqual([{ kind: "damage", amount: 0 }]);
  });

  test("Summon Goblin's cast profile carries the minion's attack% as a rising 3-rank tuple, sourced from the Summoner's magicPower", () => {
    const skill = getSkill("summoner-summon-goblin");
    const castId = getEffectiveSkill(skill, 1).effects?.[0]?.summonCastId;
    expect(castId).toBe("summoner-summon-goblin");
    // The same cast profile is referenced at every rank — the per-rank growth lives inside it as a tuple.
    expect(getEffectiveSkill(skill, 7).effects?.[0]?.summonCastId).toBe(castId);
    expect(getEffectiveSkill(skill, 15).effects?.[0]?.summonCastId).toBe(castId);
    const attackFormula = getSummonCast(castId!).stat.attack;
    expect(attackFormula.sourceStat).toBe("magicPower");
    expect(attackFormula.percent).toHaveLength(3);
    const [r1, r2, r3] = attackFormula.percent as [number, number, number];
    expect(r1).toBeLessThan(r2);
    expect(r2).toBeLessThan(r3);
  });

  test("Summon Hellfire Imp is an ultimate that both spawns a minion and hits allEnemies", () => {
    const skill = getSkill("summoner-summon-imp");
    expect(skill.isUltimate).toBe(true);
    expect(skill.target).toBe("allEnemies");
    const effects = getEffectiveSkill(skill, 35).effects ?? [];
    const summonEffect = effects.find((e) => e.kind === "summon");
    expect(summonEffect).toBeDefined();
    expect(getSummonCast(summonEffect!.summonCastId!).archetypeId).toBe("hellfire-imp");
    expect(effects.some((e) => e.kind === "damage")).toBe(true);
  });

  test("summoner-mastery no longer exists as a castable skill", () => {
    expect(() => getSkill("summoner-mastery")).toThrow();
  });

  test("summoner-totem-recall exists in slot 4 and grants an attack buff to allies except summons", () => {
    const cls = getClass("summoner");
    const skill = cls.skills.find((s) => s.id === "summoner-totem-recall")!;
    expect(skill).toBeDefined();
    expect(skill.slot).toBe(4);
    const buffEffect = getEffectiveSkill(skill, 75).effects!.find((e) => e.kind === "applyStatusEffect")!;
    expect(buffEffect.statusEffectId).toBe("totem-recall-buff");
    expect(buffEffect.target).toBe("allAllies");
    expect(buffEffect.excludesSummonTargets).toBe(true);
    expect(buffEffect.linksToCasterSummon).toBe(true);
  });

  test("every Summoner minion archetype and its signature skill(s) resolve", () => {
    for (const id of ["goblin-thrower", "stone-golem", "hellfire-imp", "healer-spirit"]) {
      const archetype = getSummonArchetype(id);
      for (const skillId of archetype.signatureSkillIds ?? []) getSummonSkill(skillId);
    }
  });

  // Reads the actual cast profile rather than hardcoding balance numbers, so a rebalance pass
  // (retuning base/percent in data/summons.json) doesn't need a matching edit here too.
  // Every Summoner's minions get the passive's maxHp/attack bonus baked in from spawn (§11 of the
  // design spec) — 0/20/10 (maxHp%/attack%) at rank 0/1, 25/13 at rank 2, 30/17 at rank 3.
  function summonerPassiveBonusPercent(owner: Character, statName: "maxHp" | "attack"): number {
    const rank = getUnlockedPassiveRank(getClass("summoner").passiveSkill, owner.level);
    const byRank = { 0: { maxHp: 0, attack: 0 }, 1: { maxHp: 20, attack: 10 }, 2: { maxHp: 25, attack: 13 }, 3: { maxHp: 30, attack: 17 } } as const;
    return statName === "maxHp" ? byRank[rank].maxHp : byRank[rank].attack;
  }

  function expectedStat(castId: string, statName: "maxHp" | "attack" | "defense" | "magicPower", owner: Character, rank: number): number {
    const formula = getSummonCast(castId).stat[statName];
    const percent = Array.isArray(formula.percent) ? formula.percent[rank - 1]! : formula.percent;
    const bonusPercent = statName === "maxHp" || statName === "attack" ? summonerPassiveBonusPercent(owner, statName) : 0;
    return Math.round(formula.base + (percent / 100) * owner[formula.sourceStat] * (1 + bonusPercent / 100));
  }

  test("Summon Goblin spawns a goblin-thrower with maxHp from the Summoner's maxHp and attack from the Summoner's magicPower", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };
    queueAction(combat, self, "summoner-summon-goblin", [self], ctx);
    resolveRound(combat, ctx);
    const goblin = ctx.summons.find((s) => s.archetypeId === "goblin-thrower");
    expect(goblin).toBeDefined();
    expect(goblin!.maxHp).toBe(expectedStat("summoner-summon-goblin", "maxHp", summoner, 1));
    // Physical-attacking minion, but funded by the magic-leaning Summoner's magicPower, not its own weak attack.
    expect(getSummonCast("summoner-summon-goblin").stat.attack.sourceStat).toBe("magicPower");
    expect(goblin!.attack).toBe(expectedStat("summoner-summon-goblin", "attack", summoner, 1));
  });

  test("Summon Goblin at rank 2 uses rank 2's attack%, not rank 1's — resolved from the shared cast profile via the caster's level", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    summoner.level = 7; // summoner-summon-goblin's rank 2 unlockLevel
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };
    queueAction(combat, self, "summoner-summon-goblin", [self], ctx);
    resolveRound(combat, ctx);
    const goblin = ctx.summons.find((s) => s.archetypeId === "goblin-thrower");
    expect(goblin).toBeDefined();
    expect(goblin!.attack).toBe(expectedStat("summoner-summon-goblin", "attack", summoner, 2));
    expect(goblin!.attack).not.toBe(expectedStat("summoner-summon-goblin", "attack", summoner, 1));
  });

  test("Summon Golem spawns a stone-golem with attack from the Summoner's magicPower too", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    summoner.level = 10;
    summoner.unlockedSkillIds.push("summoner-summon-golem");
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };
    queueAction(combat, self, "summoner-summon-golem", [self], ctx);
    resolveRound(combat, ctx);
    const golem = ctx.summons.find((s) => s.archetypeId === "stone-golem");
    expect(golem).toBeDefined();
    expect(golem!.maxHp).toBe(expectedStat("summoner-summon-golem", "maxHp", summoner, 1));
    expect(getSummonCast("summoner-summon-golem").stat.attack.sourceStat).toBe("magicPower");
    expect(golem!.attack).toBe(expectedStat("summoner-summon-golem", "attack", summoner, 1));
  });

  test("Summon Spirit spawns a healer-spirit with magicPower from the Summoner's own magicPower, not attack", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };
    queueAction(combat, self, "summoner-summon-spirit", [self], ctx);
    resolveRound(combat, ctx);
    const spirit = ctx.summons.find((s) => s.archetypeId === "healer-spirit");
    expect(spirit).toBeDefined();
    expect(spirit!.magicPower).toBe(expectedStat("summoner-summon-spirit", "magicPower", summoner, 1));
  });

  test("Summoner is selectable and fights: Totem Strike deals damage via a full combat round", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const enemy = livingMonsterRefs(combat, ctx)[0]!;
    const self: CombatantRef = { kind: "character", id: summoner.id };
    const hpBefore = rat.hp;
    queueAction(combat, self, "summoner-totem-strike", [enemy], ctx);
    resolveRound(combat, ctx);
    expect(rat.hp).toBeLessThan(hpBefore);
  });
});

describe("damageType tagging", () => {
  function damageEffectsOf(classId: string, skillId: string): Array<{ damageType?: string }> {
    const cls = getClass(classId);
    const skill = cls.skills.find((s) => s.id === skillId)!;
    const flat = skill.effects ?? [];
    const ranked = (skill.ranks ?? []).flatMap((r) => r.effects ?? []);
    return [...flat, ...ranked].filter((e) => e.kind === "damage");
  }

  test("Mage elemental skills carry the right damageType", () => {
    expect(damageEffectsOf("mage", "mage-fireball").every((e) => e.damageType === "fire")).toBe(true);
    expect(damageEffectsOf("mage", "mage-fire-pillar").every((e) => e.damageType === "fire")).toBe(true);
    expect(damageEffectsOf("mage", "mage-lightning-bolt").every((e) => e.damageType === "lightning")).toBe(true);
    expect(damageEffectsOf("mage", "mage-lightning-storm").every((e) => e.damageType === "lightning")).toBe(true);
    expect(damageEffectsOf("mage", "mage-ice-age").every((e) => e.damageType === "ice")).toBe(true);
  });

  test("mage-bludgeon is renamed to Arcane Bolt, isMagic true, damageType magic", () => {
    const cls = getClass("mage");
    const skill = cls.skills.find((s) => s.id === "mage-bludgeon")!;
    expect(skill.name).toBe("Arcane Bolt");
    expect(skill.description).toBe("A weak bolt of raw arcane force — basic damage.");
    expect(skill.isMagic).toBe(true);
    expect((skill.effects ?? [])[0]?.damageType).toBe("magic");
  });

  test("Viking's Thunder God's Fury is lightning, other Viking damage skills are untagged (physical)", () => {
    expect(damageEffectsOf("viking", "viking-thunder-god-fury").every((e) => e.damageType === "lightning")).toBe(true);
    for (const id of ["viking-axe-slash", "viking-frenzied-slash", "viking-throw-axe", "viking-spin-axe"]) {
      expect(damageEffectsOf("viking", id).every((e) => e.damageType === undefined)).toBe(true);
    }
  });

  test("Plague Doctor's Fire Vial is fire, Spreading Toxic Fog is poison", () => {
    expect(damageEffectsOf("plague-doctor", "plaguedoc-fire-vial").every((e) => e.damageType === "fire")).toBe(true);
    expect(damageEffectsOf("plague-doctor", "plaguedoc-toxic-fog").every((e) => e.damageType === "poison")).toBe(true);
  });

  test("Acolyte's Purify/Divine Descent enemy-facing damage effect is holy", () => {
    for (const skillId of ["acolyte-purify", "acolyte-divine-descent"]) {
      const cls = getClass("acolyte");
      const skill = cls.skills.find((s) => s.id === skillId)!;
      const damageEffects = (skill.ranks ?? []).flatMap((r) => (r.effects ?? []).filter((e) => e.kind === "damage"));
      expect(damageEffects.length).toBeGreaterThan(0);
      expect(damageEffects.every((e) => e.damageType === "holy" && e.appliesToRelation === "enemy")).toBe(true);
    }
  });

  test("status-effect DoT ticks carry the right damageType", () => {
    expect(getStatusEffect("poisoned").perTurnEffects[0]?.damageType).toBe("poison");
    expect(getStatusEffect("poisoned-ii").perTurnEffects[0]?.damageType).toBe("poison");
    expect(getStatusEffect("poisoned-iii").perTurnEffects[0]?.damageType).toBe("poison");
    expect(getStatusEffect("bleeding").perTurnEffects[0]?.damageType).toBe("bleed");
    expect(getStatusEffect("burning").perTurnEffects[0]?.damageType).toBe("fire");
    expect(getStatusEffect("acid-burn").perTurnEffects[0]?.damageType).toBe("poison");
  });

  test("storm-empowered's onHitAoeDamage carries damageType lightning", () => {
    expect(getStatusEffect("storm-empowered").onHitAoeDamage?.damageType).toBe("lightning");
    expect(getStatusEffect("storm-empowered-ii").onHitAoeDamage?.damageType).toBe("lightning");
    expect(getStatusEffect("storm-empowered-iii").onHitAoeDamage?.damageType).toBe("lightning");
  });
});

