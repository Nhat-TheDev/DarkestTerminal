import { describe, test, expect } from "bun:test";
import { resolveSkillEffect, getFearTier, rollLosesControl, tickDotEffects, tickStatModEffects, mitigatedOffense, statusCategory, isHelpfulStatusEffect } from "../src/engine/resolver";
import type { LogEntry, CombatantRef, StatusEffectDefinition, SkillDefinition, SkillEffect } from "../src/types";
import { makeCtx, pinCombatBalance, spawnInto } from "./helpers";
import { Game } from "../src/engine/game";
import { applySkillEffects, resolveRound, startCombat, acolyteDebuffResistPercent } from "../src/engine/combat";
import { getRoom } from "../src/engine/dungeon";
import { spawnMonster } from "../src/data/monsters";
import { STATUS_EFFECTS, getStatusEffect } from "../src/data/statusEffects";
import { BALANCE } from "../src/data/balanceConfig";

describe("resolver", () => {
  test("damage formula: max(1, round(amount + mitigatedOffense(attack, defense)))", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    const before = target.hp;
    resolveSkillEffect({ kind: "damage", amount: 10 }, attacker, target, { log: [] });
    expect(before - target.hp).toBe(Math.max(1, Math.round(10 + mitigatedOffense(attacker.attack, target.defense))));
  });

  test("isCrit multiplies damage by BALANCE.combat.defaultCritMultiplierPercent", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    const before = target.hp;
    resolveSkillEffect({ kind: "damage", amount: 10 }, attacker, target, { log: [], isCrit: true });
    const expected = Math.max(
      1,
      Math.round((10 + mitigatedOffense(attacker.attack, target.defense)) * (BALANCE.combat.defaultCritMultiplierPercent / 100))
    );
    expect(before - target.hp).toBe(expected);
  });

  test("a skill's own critMultiplierPercent overrides the BALANCE default", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    const before = target.hp;
    resolveSkillEffect({ kind: "damage", amount: 10, critMultiplierPercent: 200 }, attacker, target, { log: [], isCrit: true });
    const expected = Math.max(1, Math.round((10 + mitigatedOffense(attacker.attack, target.defense)) * 2));
    expect(before - target.hp).toBe(expected);
  });

  test("isCrit has no effect on a self-tick (DoT) damage effect", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    const before = target.hp;
    resolveSkillEffect({ kind: "damage", amount: 7 }, target, target, { log: [], isCrit: true });
    expect(before - target.hp).toBe(7);
  });

  test("executeBonus adds bonusDamageFlat and applies bonusDamagePercent only when the target is below hpPercentThreshold", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    const executeBonus = { hpPercentThreshold: 30, bonusDamagePercent: 50, bonusDamageFlat: 10 };

    target.hp = target.maxHp;
    const beforeAbove = target.hp;
    resolveSkillEffect({ kind: "damage", amount: 5 }, attacker, target, { log: [], executeBonus });
    const plainHit = beforeAbove - target.hp;
    expect(plainHit).toBe(Math.max(1, Math.round(5 + mitigatedOffense(attacker.attack, target.defense))));

    // maxHp bumped so the hit can't be capped by remaining HP.
    target.maxHp = 500;
    target.hp = Math.round(target.maxHp * 0.2);
    const beforeBelow = target.hp;
    resolveSkillEffect({ kind: "damage", amount: 5 }, attacker, target, { log: [], executeBonus });
    const executeHit = beforeBelow - target.hp;
    const expectedExecuteHit = Math.max(1, Math.round((5 + 10 + mitigatedOffense(attacker.attack, target.defense)) * 1.5));
    expect(executeHit).toBe(expectedExecuteHit);
  });

  test("scalesWithStatusStacks scales the offense portion by the target's current stack count", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    STATUS_EFFECTS.push({ id: "test-stacked", name: "Test Stacked", description: "x", perTurnEffects: [] } as StatusEffectDefinition);
    target.activeStatusEffects.push({ statusEffectId: "test-stacked", turnsRemaining: 3, stacks: 4 });
    const before = target.hp;
    const scalesWithStatusStacks = { statusEffectId: "test-stacked", percentPerStack: 5 };
    resolveSkillEffect({ kind: "damage", amount: 0, scalesWithStatusStacks }, attacker, target, { log: [] });
    STATUS_EFFECTS.splice(STATUS_EFFECTS.findIndex((s) => s.id === "test-stacked"), 1);
    const dealt = before - target.hp;
    // 4 stacks * 5%/stack = +20% on top of the normal 100% offense multiplier.
    const expected = Math.max(1, Math.round(mitigatedOffense(attacker.attack * 1.2, target.defense)));
    expect(dealt).toBe(expected);
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

  test("a magic heal rounds to a whole number instead of leaving a fractional HP amount in the log", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.magicPower = 71; // 71 * 50% = 35.5 -> must round, not land as a fractional heal
    target.hp = Math.max(1, target.maxHp - 100);
    const before = target.hp;
    const log: LogEntry[] = [];
    const healed = resolveSkillEffect({ kind: "heal", amount: 0, offenseMultiplierPercent: 50 }, target, target, { log, isMagic: true });
    expect(Number.isInteger(healed)).toBe(true);
    expect(target.hp - before).toBe(healed);
    expect(log.some((l) => /recovers \d+ HP\./.test(l.text))).toBe(true);
  });

  test("heal with maxHpPercent uses whichever is larger against the flat amount", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.hp = 1;
    // 20% of maxHp (e.g. 200) beats a flat 15
    resolveSkillEffect({ kind: "heal", amount: 15, maxHpPercent: 20 }, target, target, { log: [] });
    expect(target.hp).toBe(Math.min(target.maxHp, 1 + Math.round(target.maxHp * 0.2)));
  });

  test("heal with maxHpPercent falls back to the flat amount when it's larger", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.hp = 1;
    // 1% of a normal party member's maxHp is well under a flat 999
    resolveSkillEffect({ kind: "heal", amount: 999, maxHpPercent: 1 }, target, target, { log: [] });
    expect(target.hp).toBe(target.maxHp);
  });

  test("heal with no maxHpPercent behaves exactly as before", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.hp = 1;
    resolveSkillEffect({ kind: "heal", amount: 15 }, target, target, { log: [] });
    expect(target.hp).toBe(16);
  });

  test("modifyStat clamps fear/hunger/thirst to [0, 100]", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.survival.fear = 95;
    resolveSkillEffect({ kind: "modifyStat", stat: "fear", amount: 50 }, target, target, { log: [] });
    expect(target.survival.fear).toBe(100);
  });

  test("modifyStat fear: a rise is reduced by fearResist and logged with its decimal, a drop is not resisted", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.equippedArtifactIds.push("pendant-of-calm");
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "modifyStat", stat: "fear", amount: 5 }, target, target, { log });
    expect(target.survival.fear).toBe(4.5);
    expect(log.at(-1)!.text).toContain("4.5");
    resolveSkillEffect({ kind: "modifyStat", stat: "fear", amount: -2 }, target, target, { log });
    expect(target.survival.fear).toBe(2.5);
  });

  test("modifyCombatStat buff installs immediately and undoes on expiry", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const baseDef = vanguard.defense;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "guard" }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(baseDef + 6);

    tickStatModEffects(vanguard, { log });
    expect(vanguard.defense).toBe(baseDef);
    expect(vanguard.activeStatusEffects).toHaveLength(0);
  });

  test("modifyCombatStat debuff ticks down immediately, with no free round", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const baseDef = vanguard.defense;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "weakened", durationTurns: 2 }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(baseDef - 6);

    // Stat-mod ticks (unlike DoT/HoT and "special" statuses) decrement the very round they're cast in.
    tickStatModEffects(vanguard, { log });
    expect(vanguard.defense).toBe(baseDef - 6);
    expect(vanguard.activeStatusEffects[0]?.turnsRemaining).toBe(1);

    tickStatModEffects(vanguard, { log });
    expect(vanguard.defense).toBe(baseDef);
    expect(vanguard.activeStatusEffects).toHaveLength(0);
  });

  test("minPercent floors a buff's delta once the actor's stat has grown past where the flat amount matters", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    vanguard.defense = 200; // guard: amount 6, minPercent 10 -> floor = round(200*0.1) = 20, beats the flat 6
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "guard" }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(220);

    tickStatModEffects(vanguard, { log });
    expect(vanguard.defense).toBe(200); // undoes the applied 20, not the flat 6
    expect(vanguard.activeStatusEffects).toHaveLength(0);
  });

  test("refreshing a minPercent-floored status recomputes appliedAmounts instead of losing them, so expiry undoes the right amount", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    vanguard.defense = 200; // guard: amount 6, minPercent 10 -> floor = round(200*0.1) = 20
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "guard" }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(220);

    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "guard" }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(220);
    expect(vanguard.activeStatusEffects).toHaveLength(1);

    tickStatModEffects(vanguard, { log });
    // Must undo the full +20 minPercent-floored delta, not the flat +6 `amount`.
    expect(vanguard.defense).toBe(200);
    expect(vanguard.activeStatusEffects).toHaveLength(0);
  });

  test("reapplying a stackable status that actually gains a stack logs statusStack, not statusRefresh", () => {
    const { ctx } = makeCtx();
    const victim = ctx.monsters[0]!;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "bleeding", durationTurns: 3 }, victim, victim, { log });
    expect(victim.activeStatusEffects[0]!.stacks).toBe(1);
    expect(log.some((l) => /stacks to \d+/.test(l.text))).toBe(false);

    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "bleeding", durationTurns: 3 }, victim, victim, { log });
    expect(victim.activeStatusEffects[0]!.stacks).toBe(2);
    expect(log.at(-1)!.text).toMatch(/stacks to 2/);

    // At maxStacks a reapply falls back to a plain refresh.
    victim.activeStatusEffects[0]!.stacks = 5;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "bleeding", durationTurns: 3 }, victim, victim, { log });
    expect(victim.activeStatusEffects[0]!.stacks).toBe(5);
    expect(log.at(-1)!.text).toMatch(/refreshes/);
  });

  test("reapplying a non-stackable status always logs a plain refresh, never statusStack", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "guard" }, vanguard, vanguard, { log });
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "guard" }, vanguard, vanguard, { log });
    expect(log.at(-1)!.text).toMatch(/refreshes/);
    expect(vanguard.activeStatusEffects[0]!.stacks).toBeUndefined();
  });

  test("minPercent leaves a debuff's delta alone below the floor, and floors it once the target's stat is high enough", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const log: LogEntry[] = [];

    vanguard.defense = 50; // weakened: amount -6, minPercent -10 -> floor = round(50*-0.1) = -5, smaller magnitude than -6
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "weakened", durationTurns: 2 }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(44);
    tickStatModEffects(vanguard, { log });
    tickStatModEffects(vanguard, { log });
    expect(vanguard.defense).toBe(50);

    vanguard.defense = 300; // floor = round(300*-0.1) = -30, beats the flat -6
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "weakened", durationTurns: 2 }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(270);
    tickStatModEffects(vanguard, { log });
    tickStatModEffects(vanguard, { log });
    expect(vanguard.defense).toBe(300); // undoes the applied -30, not the flat -6
  });

  test("expiry undoes the exact stored delta even if the actor's stat moved in the meantime", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    vanguard.defense = 200; // guard applies floor(20) here, stored on the ActiveStatusEffect entry
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "guard" }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(220);

    vanguard.defense += 500; // an unrelated change to the same stat; re-deriving the floor now would disagree with what was applied

    tickStatModEffects(vanguard, { log });
    expect(vanguard.defense).toBe(700); // minus the stored 20, not a floor re-derived off 720
    expect(vanguard.activeStatusEffects).toHaveLength(0);
  });

  test("a status effect's own damage tick (DoT) is flat (amount + maxHpPercent), not attack-minus-defense", () => {
    // goblin has no physical resist/weak, so race doesn't perturb the untyped DoT tick.
    const victim = spawnMonster("goblin", 1);
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poisoned" }, victim, victim, { log });
    const before = victim.hp;
    tickDotEffects(victim, { log });
    const expectedTick = Math.max(1, Math.round(4 + victim.maxHp * 0.025));
    expect(before - victim.hp).toBe(expectedTick);
  });

  test("statusCategory classifies a restoreMp per-turn effect as dot (MP-over-time), same schedule as damage/heal", () => {
    const def: StatusEffectDefinition = { id: "test-mp-regen", name: "x", description: "", perTurnEffects: [{ kind: "restoreMp", amount: 5 }] };
    expect(statusCategory(def)).toBe("dot");
  });

  test("statusCategory's tickCategory field overrides shape inference", () => {
    const def: StatusEffectDefinition = {
      id: "test-forced-special",
      name: "x",
      description: "",
      perTurnEffects: [{ kind: "modifyCombatStat", combatStat: "attack", amount: 4 }],
      tickCategory: "special",
    };
    expect(statusCategory(def)).toBe("special");
  });

  test("re-applying an active status effect refreshes duration instead of stacking", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "burning", durationTurns: 2 }, vanguard, vanguard, { log });
    tickDotEffects(vanguard, { log });
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "burning", durationTurns: 2 }, vanguard, vanguard, { log });
    expect(vanguard.activeStatusEffects).toHaveLength(1);
    expect(vanguard.activeStatusEffects[0]!.turnsRemaining).toBe(2);
  });

  test("fear tiers", () => {
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

describe("room-clear status effect cleanup", () => {
  function setUpOneHpFight(seed: number) {
    const game = new Game(seed, ["vanguard", "rogue", "viking"]);
    const rat = spawnMonster("dungeon-rat", 1);
    rat.hp = 1;
    game.ctx.monsters.push(rat);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.monsterIds = [rat.id];
    room.cleared = false;
    game.state.combat = startCombat(room.id, [rat.id], game.ctx, false);
    const [vanguard, rogue, viking] = game.state.party;
    return { game, vanguard: vanguard!, rogue: rogue!, viking: viking!, rat };
  }

  test("multi-turn self-buffs are force-expired the instant the room is won", () => {
    const { game, vanguard, rogue, viking, rat } = setUpOneHpFight(10);
    const rogueRef: CombatantRef = { kind: "character", id: rogue.id };
    const vikingRef: CombatantRef = { kind: "character", id: viking.id };
    const vanguardRef: CombatantRef = { kind: "character", id: vanguard.id };
    const enemyRef: CombatantRef = { kind: "monster", id: rat.id };

    expect(game.queue(rogueRef, "poison-coat", [rogueRef])).toBeNull();
    expect(game.queue(vikingRef, "lightning-axe", [vikingRef])).toBeNull();
    expect(game.queue(vanguardRef, "slash", [enemyRef])).toBeNull();
    game.resolve();

    expect(game.state.combat!.outcome).toBe("victory");
    expect(rogue.activeStatusEffects.some((a) => a.statusEffectId === "poison-coated")).toBe(false);
    expect(viking.activeStatusEffects.some((a) => a.statusEffectId.startsWith("storm-empowered"))).toBe(false);
  });

  test("a debuff survives a room win, keeping its duration and penalty", () => {
    const { game, vanguard, rat } = setUpOneHpFight(11);
    const baseDef = vanguard.defense;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "weakened", durationTurns: 2 }, vanguard, vanguard, { log: game.state.combat!.log });
    expect(vanguard.defense).toBe(baseDef - 6);

    const vanguardRef: CombatantRef = { kind: "character", id: vanguard.id };
    const enemyRef: CombatantRef = { kind: "monster", id: rat.id };
    expect(game.queue(vanguardRef, "slash", [enemyRef])).toBeNull();
    game.resolve();

    expect(game.state.combat!.outcome).toBe("victory");
    const weakened = vanguard.activeStatusEffects.find((a) => a.statusEffectId === "weakened");
    expect(weakened).toBeDefined();
    expect(weakened!.turnsRemaining).toBe(2);
    expect(vanguard.defense).toBe(baseDef - 6);
  });
});

describe("SkillEffect.damageType", () => {
  test("a damage effect with no damageType compiles and resolves exactly as before", () => {
    const effect: SkillEffect = { kind: "damage", amount: 10 };
    expect(effect.damageType).toBeUndefined();
  });

  test("a damage effect can declare an explicit damageType", () => {
    const effect: SkillEffect = { kind: "damage", amount: 10, damageType: "fire" };
    expect(effect.damageType).toBe("fire");
  });
});

describe("race resist/weak in resolveSkillEffect", () => {
  test("100% resist yields exactly 0 damage, not the usual floor-of-1", () => {
    const { ctx } = makeCtx();
    const source = ctx.party[0]!;
    source.attack = 50;
    const target = spawnMonster("swamp-slime", 1); // Toxic Ooze subRace: resistPercent.poison = 100
    const effect: SkillEffect = { kind: "damage", amount: 10, damageType: "poison" };
    const dealt = resolveSkillEffect(effect, source, target, { log: [] });
    expect(dealt).toBe(0);
    expect(target.hp).toBe(target.maxHp);
  });

  test("combined 100% resist and 100% weak still yields exactly 0 (resist dominates)", () => {
    const { ctx } = makeCtx();
    const source = ctx.party[0]!;
    source.attack = 50;
    const target = spawnMonster("fire-elemental", 1); // resistPercent.fire = 100
    const effect: SkillEffect = { kind: "damage", amount: 10, damageType: "fire" };
    const dealt = resolveSkillEffect(effect, source, target, { log: [] });
    expect(dealt).toBe(0);
  });

  test("partial resist reduces damage but never to 0 (floor-of-1 still applies when resist < 100)", () => {
    const { ctx } = makeCtx();
    const source = ctx.party[0]!;
    source.attack = 50;
    const target = spawnMonster("slime", 1); // Ooze: resistPercent.poison = 50 (race-level)
    const effect: SkillEffect = { kind: "damage", amount: 10, damageType: "poison" };
    const dealt = resolveSkillEffect(effect, source, target, { log: [] });
    expect(dealt).toBeGreaterThan(0);

    const targetB = spawnMonster("slime", 1);
    const physicalEffect: SkillEffect = { kind: "damage", amount: 10 };
    const physicalDealt = resolveSkillEffect(physicalEffect, source, targetB, { log: [] });
    expect(dealt).toBeLessThan(physicalDealt);
  });

  test("a damage-over-time status whose every tick the target fully resists never lands", () => {
    const { ctx } = makeCtx();
    const target = spawnMonster("skeleton", 1); // Skeletal subRace: resistPercent.bleed = 100
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "bleeding", durationTurns: 3 }, ctx.party[0]!, target, { log });
    expect(target.activeStatusEffects).toHaveLength(0);
    expect(log.map((l) => l.text)).toEqual([`${target.name} is immune to Bleeding.`]);
  });

  test("a status that also does something besides fully resisted damage still lands", () => {
    const { ctx } = makeCtx();
    const target = spawnMonster("fire-elemental", 1); // resistPercent.fire = 100; Agony also cuts a stat
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "agony", durationTurns: 3 }, ctx.party[0]!, target, { log: [] });
    expect(target.activeStatusEffects.map((s) => s.statusEffectId)).toEqual(["agony"]);
  });

  test("a fully resisted damage-over-time status that also stuns still lands", () => {
    const { ctx } = makeCtx();
    const target = spawnMonster("skeleton", 1);
    const def = getStatusEffect("bleeding");
    const stunningBleed: StatusEffectDefinition = { ...def, id: "t-stunning-bleed", stuns: true };
    STATUS_EFFECTS.push(stunningBleed);
    try {
      resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: stunningBleed.id, durationTurns: 2 }, ctx.party[0]!, target, { log: [] });
      expect(target.activeStatusEffects.map((s) => s.statusEffectId)).toEqual([stunningBleed.id]);
    } finally {
      STATUS_EFFECTS.splice(STATUS_EFFECTS.indexOf(stunningBleed), 1);
    }
  });

  test("a damage-over-time status lands on a Character whatever the source's race", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[1]!;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "bleeding", durationTurns: 3 }, spawnMonster("skeleton", 1), target, { log: [] });
    expect(target.activeStatusEffects.map((s) => s.statusEffectId)).toEqual(["bleeding"]);
  });

  test("a Character target is never affected by race resist/weak lookups", () => {
    const { ctx } = makeCtx();
    const source = spawnMonster("skeleton", 1);
    const target = ctx.party[1]!;
    const before = target.hp;
    const effect: SkillEffect = { kind: "damage", amount: 10, damageType: "bleed" };
    const dealt = resolveSkillEffect(effect, source, target, { log: [] });
    expect(dealt).toBeGreaterThan(0);
    expect(target.hp).toBeLessThan(before);
  });
});

describe("stackable modifyCombatStat re-application (Mage's shred)", () => {
  test("re-applying a stackable modifyCombatStat status a 2nd time adds a fresh delta, not just a refreshed duration", () => {
    const { ctx } = makeCtx();
    const source = ctx.party[0]!;
    const target = ctx.party[1]!;
    target.defense = 40;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "shredded" }, source, target, { log: [] });
    // max(5, round(40 * 5 / 100)) = max(5, 2) = 5
    expect(target.defense).toBe(35);
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "shredded" }, source, target, { log: [] });
    // 2nd stack computed against the now-current defense (35): max(5, round(35 * 5 / 100)) = max(5, 2) = 5
    expect(target.defense).toBe(30);
  });

  test("stacking caps at maxStacks — a 4th application on a maxStacks:3 status adds no further delta", () => {
    const { ctx } = makeCtx();
    const source = ctx.party[0]!;
    const target = ctx.party[1]!;
    target.defense = 40;
    for (let i = 0; i < 3; i++) resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "shredded" }, source, target, { log: [] });
    const afterThree = target.defense;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "shredded" }, source, target, { log: [] });
    expect(target.defense).toBe(afterThree);
    expect(target.activeStatusEffects.find((s) => s.statusEffectId === "shredded")!.stacks).toBe(3);
  });

  test("expireStatusEffect undoes the full accumulated delta across all stacks, not just the last one applied", () => {
    const { ctx } = makeCtx();
    const source = ctx.party[0]!;
    const target = ctx.party[1]!;
    target.defense = 40;
    const before = target.defense;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "shredded" }, source, target, { log: [] });
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "shredded" }, source, target, { log: [] });
    resolveSkillEffect({ kind: "removeStatusEffect", statusEffectId: "shredded" }, source, target, { log: [] });
    expect(target.defense).toBe(before);
    expect(target.activeStatusEffects.find((s) => s.statusEffectId === "shredded")).toBeUndefined();
  });
});

describe("Acolyte passive: own-healing-output boost", () => {
  test("healing cast by an Acolyte via their own skill is boosted", () => {
    const { ctx } = makeCtx();
    const acolyte = ctx.party.find((p) => p.classId === "acolyte")!;
    acolyte.level = 35; // rank 3: +25%
    const target = ctx.party[1]!;
    target.hp = 1;
    const healed = resolveSkillEffect({ kind: "heal", amount: 20 }, acolyte, target, { log: [], castByOwnClassSkill: true });
    expect(healed).toBe(Math.round(20 * 1.25));
  });

  test("healing from an item the Acolyte uses (not their own class skill) is unaffected", () => {
    const { ctx } = makeCtx();
    const acolyte = ctx.party.find((p) => p.classId === "acolyte")!;
    acolyte.level = 35;
    const target = ctx.party[1]!;
    target.hp = 1;
    const healed = resolveSkillEffect({ kind: "heal", amount: 20 }, acolyte, target, { log: [] });
    expect(healed).toBe(20);
  });

  test("healing from a non-Acolyte source is unaffected even when castByOwnClassSkill is set", () => {
    const { ctx } = makeCtx();
    const nonAcolyte = ctx.party.find((p) => p.classId !== "acolyte")!;
    const target = ctx.party[1]!;
    target.hp = 1;
    const healed = resolveSkillEffect({ kind: "heal", amount: 20 }, nonAcolyte, target, { log: [], castByOwnClassSkill: true });
    expect(healed).toBe(20);
  });

  test("below level 5 (rank 0), no boost applies even via the Acolyte's own skill", () => {
    const { ctx } = makeCtx();
    const acolyte = ctx.party.find((p) => p.classId === "acolyte")!;
    acolyte.level = 1;
    const target = ctx.party[1]!;
    target.hp = 1;
    const healed = resolveSkillEffect({ kind: "heal", amount: 20 }, acolyte, target, { log: [], castByOwnClassSkill: true });
    expect(healed).toBe(20);
  });
});

describe("Acolyte passive: acolyteDebuffResistPercent", () => {
  test("scales with the unlocked passive rank: 0/30/40/50 at rank 0/1/2/3", () => {
    const { ctx } = makeCtx();
    const acolyte = ctx.party.find((p) => p.classId === "acolyte")!;
    for (const [level, expected] of [
      [1, 0],
      [5, 30],
      [20, 40],
      [35, 50],
    ] as const) {
      acolyte.level = level;
      expect(acolyteDebuffResistPercent(acolyte)).toBe(expected);
    }
  });

  test("is 0 for a non-Acolyte character", () => {
    const { ctx } = makeCtx();
    const nonAcolyte = ctx.party.find((p) => p.classId !== "acolyte")!;
    nonAcolyte.level = 35;
    expect(acolyteDebuffResistPercent(nonAcolyte)).toBe(0);
  });
});


describe("damage variance (combat.damageVariancePercent)", () => {
  pinCombatBalance({ baseCritChancePercent: 0 });
  function setup() {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    target.maxHp = target.hp = 1_000_000;
    const base = 100 + mitigatedOffense(attacker.attack, target.defense);
    const hit = (rollDamage?: () => number, source = attacker, victim = target) => {
      victim.hp = victim.maxHp;
      resolveSkillEffect({ kind: "damage", amount: 100 }, source, victim, { log: [], rollDamage });
      return victim.maxHp - victim.hp;
    };
    return { ctx, attacker, target, base, hit };
  }

  test("every hit lands within ±damageVariancePercent of the unvaried damage, and the average stays on it", () => {
    const { ctx, base, hit } = setup();
    const p = BALANCE.combat.damageVariancePercent / 100;
    const trials = 4000;
    let sum = 0;
    let below = false;
    let above = false;
    for (let i = 0; i < trials; i++) {
      const dealt = hit(() => ctx.rng.next());
      expect(dealt).toBeGreaterThanOrEqual(Math.floor(base * (1 - p)));
      expect(dealt).toBeLessThanOrEqual(Math.ceil(base * (1 + p)));
      if (dealt < Math.round(base)) below = true;
      if (dealt > Math.round(base)) above = true;
      sum += dealt;
    }
    expect(below && above).toBe(true);
    expect(Math.abs(sum / trials - base)).toBeLessThan(base * 0.002);
  });

  test("a hit draws twice: the factor first, then the rounding", () => {
    const { base, hit } = setup();
    const p = BALANCE.combat.damageVariancePercent / 100;
    const draws = [0, 0];
    expect(hit(() => draws.shift()!)).toBe(Math.floor(base * (1 - p)));
    expect(draws.length).toBe(0);
    const high = [1 - 1e-9, 1 - 1e-9];
    expect(hit(() => high.shift()!)).toBe(Math.floor(base * (1 + p) + (1 - 1e-9)));
  });

  test("rounding is stochastic: a hit near 10 moves to 9 or 11 instead of always reading 10", () => {
    const { ctx, attacker, target } = setup();
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      target.hp = target.maxHp;
      const effect: SkillEffect = { kind: "damage", amount: 10 - mitigatedOffense(attacker.attack, target.defense) };
      resolveSkillEffect(effect, attacker, target, { log: [], rollDamage: () => ctx.rng.next() });
      seen.add(target.maxHp - target.hp);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([9, 10, 11]);
  });

  test("a damage-over-time tick is never varied and spends no draw", () => {
    const { ctx } = makeCtx();
    const bearer = ctx.party[0]!;
    let draws = 0;
    const before = bearer.hp;
    resolveSkillEffect({ kind: "damage", amount: 7 }, bearer, bearer, { log: [], rollDamage: () => (draws++, 0.99) });
    expect(before - bearer.hp).toBe(7);
    expect(draws).toBe(0);
  });

  test("no rollDamage, or a variance of 0, leaves the hit exact and spends no draw", () => {
    const { base, hit } = setup();
    expect(hit()).toBe(Math.round(base));
    const saved = BALANCE.combat.damageVariancePercent;
    BALANCE.combat.damageVariancePercent = 0;
    try {
      let draws = 0;
      expect(hit(() => (draws++, 0.99))).toBe(Math.round(base));
      expect(draws).toBe(0);
    } finally {
      BALANCE.combat.damageVariancePercent = saved;
    }
  });
});

describe("LogEntry.hit on a damage line", () => {
  function dealt(effect: SkillEffect, target: ReturnType<typeof makeCtx>["ctx"]["party"][number], source = target) {
    const log: LogEntry[] = [];
    resolveSkillEffect(effect, source, target, { log });
    return log.find((e) => e.kind === "attack")!;
  }

  test("a direct hit names the actor it landed on and the HP it took", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    target.hp = target.maxHp;
    const before = target.hp;
    const entry = dealt({ kind: "damage", amount: 10 }, target, attacker);
    expect(entry.hit).toEqual({ targetId: target.id, amount: before - target.hp });
  });

  test("a killing blow keeps its full damage and names the overkill the target had no HP to take", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    target.hp = 3;
    const entry = dealt({ kind: "damage", amount: 500 }, target, attacker);
    const full = entry.hit!.amount;
    expect(full).toBeGreaterThanOrEqual(500);
    expect(entry.hit).toEqual({ targetId: target.id, amount: full, overkill: full - 3 });
    expect(entry.text).toContain(`takes ${full} damage`);
    expect(target.hp).toBe(0);
  });

  test("a damage-over-time tick and a hit that did no damage carry none", () => {
    const { ctx } = makeCtx();
    const bearer = ctx.party[0]!;
    expect(dealt({ kind: "damage", amount: 7 }, bearer).hit).toBeUndefined();
    const attacker = ctx.party[1]!;
    const target = ctx.party[2]!;
    target.hp = 0;
    expect(dealt({ kind: "damage", amount: 10 }, target, attacker).hit).toBeUndefined();
  });
});

describe("base crit (combat.baseCritChancePercent)", () => {
  pinCombatBalance({ damageVariancePercent: 0, baseCritChancePercent: 1 });

  function setup() {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    target.maxHp = target.hp = 1_000_000;
    const base = 100 + mitigatedOffense(attacker.attack, target.defense);
    const hit = (caller: { isCrit?: boolean; rollDamage?: () => number }, effect: SkillEffect = { kind: "damage", amount: 100 }) => {
      target.hp = target.maxHp;
      const log: LogEntry[] = [];
      resolveSkillEffect(effect, attacker, target, { log, ...caller });
      return { dealt: target.maxHp - target.hp, text: log[0]!.text };
    };
    return { ctx, attacker, target, base, hit };
  }

  test("a hit crits when the draw falls under the base chance, at the default crit multiplier", () => {
    const { base, hit } = setup();
    const crit = hit({ rollDamage: () => 0.0099 });
    expect(crit.dealt).toBe(Math.round(base * (BALANCE.combat.defaultCritMultiplierPercent / 100)));
    expect(crit.text.startsWith("Critical Hit!")).toBe(true);
    const plain = hit({ rollDamage: () => 0.0101 });
    expect(plain.dealt).toBe(Math.round(base));
    expect(plain.text.startsWith("Critical Hit!")).toBe(false);
  });

  test("an effect's own critMultiplierPercent replaces the default on a base crit", () => {
    const { base, hit } = setup();
    expect(hit({ rollDamage: () => 0 }, { kind: "damage", amount: 100, critMultiplierPercent: 200 }).dealt).toBe(Math.round(base * 2));
  });

  test("a caller that already rolled is not rolled for again, and no callback means no crit", () => {
    const { base, hit } = setup();
    let draws = 0;
    const counted = () => (draws++, 0);
    expect(hit({ isCrit: false, rollDamage: counted }).dealt).toBe(Math.round(base));
    expect(hit({ isCrit: true, rollDamage: counted }).dealt).toBe(Math.round(base * 1.5));
    expect(draws).toBe(0);
    expect(hit({}).dealt).toBe(Math.round(base));
  });

  test("a base chance of 0 spends no draw", () => {
    const { base, hit } = setup();
    const saved = BALANCE.combat.baseCritChancePercent;
    BALANCE.combat.baseCritChancePercent = 0;
    try {
      let draws = 0;
      expect(hit({ rollDamage: () => (draws++, 0) }).dealt).toBe(Math.round(base));
      expect(draws).toBe(0);
    } finally {
      BALANCE.combat.baseCritChancePercent = saved;
    }
  });

  test("a damage-over-time tick never crits, even with a callback that would", () => {
    const { ctx } = makeCtx();
    const bearer = ctx.party[0]!;
    const before = bearer.hp;
    let draws = 0;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "damage", amount: 7 }, bearer, bearer, { log, rollDamage: () => (draws++, 0) });
    expect(before - bearer.hp).toBe(7);
    expect(draws).toBe(0);
    expect(log[0]!.text.startsWith("Critical")).toBe(false);
  });

  test("a direct heal crits at the same chance and multiplier, with its own log line, and has no variance", () => {
    const { ctx } = makeCtx();
    const healer = ctx.party[0]!;
    const patient = ctx.party[1]!;
    const heal = (roll: number) => {
      patient.maxHp = 1000;
      patient.hp = 100;
      const log: LogEntry[] = [];
      resolveSkillEffect({ kind: "heal", amount: 20 }, healer, patient, { log, rollDamage: () => roll });
      return { healed: patient.hp - 100, text: log[0]!.text };
    };
    const crit = heal(0);
    expect(crit.healed).toBe(Math.round(20 * (BALANCE.combat.defaultCritMultiplierPercent / 100)));
    expect(crit.text).toBe(`Critical Heal! ${patient.name} recovers ${crit.healed} HP.`);
    expect(heal(0.5)).toEqual({ healed: 20, text: `${patient.name} recovers 20 HP.` });
  });

  test("a heal-over-time tick never crits, but a healer healing itself with a skill can", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.maxHp = 1000;
    c.hp = 100;
    resolveSkillEffect({ kind: "heal", amount: 20 }, c, c, { log: [] });
    expect(c.hp).toBe(120);
    c.hp = 100;
    resolveSkillEffect({ kind: "heal", amount: 20 }, c, c, { log: [], rollDamage: () => 0 });
    expect(c.hp).toBe(130);
  });
});

describe("crit and variance inside a cast", () => {
  const strike = (extra: Partial<SkillDefinition> = {}, effect: Partial<SkillEffect> = {}): SkillDefinition => ({
    id: "test-strike",
    name: "Test Strike",
    description: "",
    mpCost: 0,
    target: "singleEnemy",
    effects: [{ kind: "damage", amount: 20, offenseMultiplierPercent: 0, ...effect }],
    slot: 1,
    unlockLevel: 1,
    ...extra,
  });

  function cast(skill: SkillDefinition, rng: () => number, who: (ctx: ReturnType<typeof makeCtx>["ctx"]) => ReturnType<typeof makeCtx>["ctx"]["party"][number] = (ctx) => ctx.party.find((p) => p.classId === "vanguard")!) {
    const { ctx } = makeCtx();
    const source = who(ctx);
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.hp = rat.maxHp = 1_000_000;
    rat.defense = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    ctx.rng.next = rng;
    const log: LogEntry[] = [];
    applySkillEffects(skill, source, [rat], combat, ctx, log);
    return log.filter((l) => l.kind === "attack").map((l) => l.text);
  }
  const crits = (lines: string[]) => lines.filter((l) => l.startsWith("Critical Hit!")).length;

  describe("with the base chance in play", () => {
    pinCombatBalance({ damageVariancePercent: 0, baseCritChancePercent: 1 });

    test("the base chance adds to a skill's own critChance", () => {
      expect(crits(cast(strike({}, { critChance: 0.3 }), () => 0.305))).toBe(1);
      expect(crits(cast(strike({}, { critChance: 0.3 }), () => 0.315))).toBe(0);
    });

    test("an item's damage never crits, whatever its chance or the draw", () => {
      expect(crits(cast(strike({}, { critChance: 1 }), () => 0))).toBe(1);
      expect(crits(cast(strike({ fromItem: true }, { critChance: 1 }), () => 0))).toBe(0);
    });

    test("the Archer's passive lifts a damage crit but not a heal", () => {
      const archer = (ctx: ReturnType<typeof makeCtx>["ctx"]) => {
        const a = ctx.party.find((p) => p.classId === "archer")!;
        a.level = 35;
        return a;
      };
      expect(crits(cast(strike(), () => 0.05, archer))).toBe(1);
      const { ctx } = makeCtx();
      const a = archer(ctx);
      a.maxHp = 1000;
      a.hp = 100;
      const rat = spawnInto(ctx, "dungeon-rat");
      const combat = startCombat("r1", [rat.id], ctx, false);
      ctx.rng.next = () => 0.05;
      const log: LogEntry[] = [];
      applySkillEffects({ ...strike(), target: "self", effects: [{ kind: "heal", amount: 20 }] }, a, [a], combat, ctx, log);
      expect(a.hp).toBe(120);
      expect(log.some((l) => l.text.startsWith("Critical"))).toBe(false);
    });
  });

  describe("with both rolls wide open", () => {
    pinCombatBalance({ damageVariancePercent: 3, baseCritChancePercent: 50 });

    test("each hit of a multi-hit skill and each target rolls its own crit and variance", () => {
      const { ctx } = makeCtx(11);
      const source = ctx.party.find((p) => p.classId === "vanguard")!;
      const rats = [spawnInto(ctx, "dungeon-rat"), spawnInto(ctx, "dungeon-rat"), spawnInto(ctx, "dungeon-rat")];
      for (const r of rats) {
        r.hp = r.maxHp = 1_000_000;
        r.defense = 0;
      }
      const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
      const log: LogEntry[] = [];
      const skill = strike({ target: "allEnemies" }, { amount: 100, hitCountRange: { min: 3, max: 3 } });
      applySkillEffects(skill, source, rats, combat, ctx, log);
      const lines = log.filter((l) => l.kind === "attack");
      expect(lines).toHaveLength(9);
      const crit = lines.filter((l) => l.text.startsWith("Critical Hit!"));
      expect(crit.length).toBeGreaterThan(0);
      expect(crit.length).toBeLessThan(lines.length);
      for (const rat of rats) {
        const hits = log.filter((l) => l.hit?.targetId === rat.id);
        expect(hits).toHaveLength(3);
      }
      const plain = lines.filter((l) => !l.text.startsWith("Critical Hit!")).map((l) => l.hit!.amount);
      expect(new Set(plain).size).toBeGreaterThan(1);
      for (const amount of plain) expect(amount).toBeGreaterThanOrEqual(97 - 1);
      for (const amount of plain) expect(amount).toBeLessThanOrEqual(103 + 1);
    });
  });
});

describe("LogEntry crit marks", () => {
  pinCombatBalance({ damageVariancePercent: 0, baseCritChancePercent: 1 });

  test("a critical hit's line carries crit in hit, and a plain hit's does not", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    target.maxHp = target.hp = 1_000_000;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "damage", amount: 100 }, attacker, target, { log, rollDamage: () => 0 });
    resolveSkillEffect({ kind: "damage", amount: 100 }, attacker, target, { log, rollDamage: () => 0.5 });
    expect(log[0]!.hit).toEqual({ targetId: target.id, amount: log[0]!.hit!.amount, crit: true });
    expect(log[1]!.hit).toEqual({ targetId: target.id, amount: log[1]!.hit!.amount });
  });

  test("a critical heal's line names the unit it landed on; a plain heal and a heal-over-time tick carry nothing", () => {
    const { ctx } = makeCtx();
    const healer = ctx.party[0]!;
    const patient = ctx.party[1]!;
    patient.maxHp = 1000;
    patient.hp = 100;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "heal", amount: 20 }, healer, patient, { log, rollDamage: () => 0 });
    resolveSkillEffect({ kind: "heal", amount: 20 }, healer, patient, { log, rollDamage: () => 0.5 });
    resolveSkillEffect({ kind: "heal", amount: 20 }, patient, patient, { log });
    expect(log.map((e) => e.healCritOf)).toEqual([patient.id, undefined, undefined]);
  });
});

describe("a hit shown after the target fell (ResolveContext.unapplied)", () => {
  pinCombatBalance({ damageVariancePercent: 3, baseCritChancePercent: 1 });

  test("rolls crit and variance like a real hit, deals and heals nothing, and is logged as overkill", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    target.hp = 0;
    attacker.maxHp = 1000;
    attacker.hp = 500;
    const base = 100 + mitigatedOffense(attacker.attack, target.defense);
    const draws = [0, 0.5, 0.5];
    const log: LogEntry[] = [];
    const dealtNow = resolveSkillEffect({ kind: "damage", amount: 100, lifestealPercent: 50 }, attacker, target, { log, rollDamage: () => draws.shift()!, unapplied: true });
    expect(dealtNow).toBe(0);
    expect(draws).toHaveLength(0);
    expect(target.hp).toBe(0);
    expect(attacker.hp).toBe(500);
    expect(log).toHaveLength(1);
    const entry = log[0]!;
    expect(entry.hidden).toBeUndefined();
    const amount = Math.floor(base * 1.5 + 0.5);
    expect(entry.text).toBe(`Critical Hit! Overkill on ${target.name}: ${amount} from ${attacker.name}.`);
    expect(entry.hit).toEqual({ targetId: target.id, amount, overkill: amount, crit: true });
  });

  test("reads as overkill in each of its four forms, never as damage taken", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    target.hp = 0;
    const line = (skillName: string | undefined, roll: number) => {
      const log: LogEntry[] = [];
      resolveSkillEffect({ kind: "damage", amount: 100 }, attacker, target, { log, skillName, rollDamage: () => roll, unapplied: true });
      return { text: log[0]!.text, amount: log[0]!.hit!.amount };
    };
    const plain = line(undefined, 0.5);
    expect(plain.text).toBe(`Overkill on ${target.name}: ${plain.amount} from ${attacker.name}.`);
    const withSkill = line("Frenzied Slash", 0.5);
    expect(withSkill.text).toBe(`Overkill on ${target.name}: ${withSkill.amount} from ${attacker.name}'s Frenzied Slash.`);
    const crit = line(undefined, 0);
    expect(crit.text).toBe(`Critical Hit! Overkill on ${target.name}: ${crit.amount} from ${attacker.name}.`);
    const critSkill = line("Frenzied Slash", 0);
    expect(critSkill.text).toBe(`Critical Hit! Overkill on ${target.name}: ${critSkill.amount} from ${attacker.name}'s Frenzied Slash.`);
    for (const { text } of [plain, withSkill, crit, critSkill]) expect(text).not.toContain("takes");
  });

  test("a damage-over-time tick is never shown that way", () => {
    const { ctx } = makeCtx();
    const bearer = ctx.party[0]!;
    const before = bearer.hp;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "damage", amount: 7 }, bearer, bearer, { log, unapplied: true });
    expect(before - bearer.hp).toBe(7);
    expect(log[0]!.hidden).toBeUndefined();
  });
});

describe("executeHpFraction", () => {
  pinCombatBalance({ damageVariancePercent: 0, baseCritChancePercent: 0 });

  test("replaces the target's current HP when testing the execute bonus", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!;
    const target = ctx.party[1]!;
    target.maxHp = 100;
    const executeBonus = { hpPercentThreshold: 30, bonusDamageFlat: 20 };
    const hit = (executeHpFraction?: number) => {
      target.hp = 0;
      const log: LogEntry[] = [];
      resolveSkillEffect({ kind: "damage", amount: 60, offenseMultiplierPercent: 0 }, attacker, target, { log, executeBonus, executeHpFraction, unapplied: true });
      return log[0]!.hit!.amount;
    };
    const base = hit(0.5);
    expect(hit()).toBe(base + 20);
    expect(hit(0.1)).toBe(base + 20);
    expect(hit(0.5)).toBe(base);
  });
});

describe("over-time ticks through a real round", () => {
  pinCombatBalance({ damageVariancePercent: 3, baseCritChancePercent: 100 });

  test("a poison tick never crits or varies even when every direct hit would", () => {
    const { ctx } = makeCtx();
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    rat.hp = rat.maxHp = 500;
    rat.activeStatusEffects.push({ statusEffectId: "poisoned", turnsRemaining: 5 });
    const combat = startCombat("r1", [rat.id], ctx, false);
    const first = combat.log.length;
    resolveRound(combat, ctx);
    resolveRound(combat, ctx);
    const ticks = combat.log.slice(first).filter((l) => l.kind === "attack" && l.text.includes("Poisoned"));
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const tick of ticks) expect(tick.text.startsWith("Critical")).toBe(false);
    expect(new Set(ticks.map((t) => t.text)).size).toBe(1);
    expect(ticks.every((l) => l.hit === undefined)).toBe(true);
  });

  test("a heal-over-time tick never crits even when every direct heal would", () => {
    const { ctx } = makeCtx();
    const patient = ctx.party[0]!;
    patient.maxHp = 1000;
    patient.hp = 100;
    patient.activeStatusEffects.push({ statusEffectId: "mending", turnsRemaining: 5 });
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    rat.hp = rat.maxHp = 500;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const first = combat.log.length;
    resolveRound(combat, ctx);
    const heals = combat.log.slice(first).filter((l) => l.kind === "heal");
    expect(heals.length).toBeGreaterThan(0);
    for (const heal of heals) {
      expect(heal.text.startsWith("Critical")).toBe(false);
      expect(heal.healCritOf).toBeUndefined();
    }
  });
});

describe("harmful tags and reflect", () => {
  function withStatus(def: object, body: () => void) {
    STATUS_EFFECTS.push({ name: "x", description: "x", perTurnEffects: [], ...def } as unknown as StatusEffectDefinition);
    try {
      body();
    } finally {
      STATUS_EFFECTS.splice(STATUS_EFFECTS.findIndex((s) => s.id === (def as { id: string }).id), 1);
    }
  }
  const status = (id: string) => ({ statusEffectId: id, turnsRemaining: 3 });

  test("a status tagged harmful is not helpful, so a no-id cleanse removes it and keeps the buff", () => {
    withStatus({ id: "fixture-mark", harmful: true }, () => {
      expect(isHelpfulStatusEffect(getStatusEffect("fixture-mark"))).toBe(false);
      const { ctx } = makeCtx();
      const bearer = ctx.party[0]!;
      bearer.activeStatusEffects.push(status("guard"), status("fixture-mark"));
      resolveSkillEffect({ kind: "removeStatusEffect" }, ctx.party[1]!, bearer, { log: [] });
      expect(bearer.activeStatusEffects.map((s) => s.statusEffectId)).toEqual(["guard"]);
    });
  });

  test("a tag with no harmful flag still reads as helpful", () => {
    withStatus({ id: "fixture-plain" }, () => {
      expect(isHelpfulStatusEffect(getStatusEffect("fixture-plain"))).toBe(true);
    });
  });

  test("a hit on a reflect bearer turns that share back on the attacker, once", () => {
    withStatus({ id: "fixture-riposte", reflectDamagePercent: 50 }, () => {
      const { ctx } = makeCtx();
      const attacker = ctx.party[0]!;
      const bearer = spawnMonster("dungeon-rat", 1);
      bearer.defense = 0;
      bearer.hp = bearer.maxHp = 9999;
      bearer.activeStatusEffects.push(status("fixture-riposte"));
      const log: LogEntry[] = [];
      const attackerBefore = attacker.hp;
      resolveSkillEffect({ kind: "damage", amount: 40, offenseMultiplierPercent: 0 }, attacker, bearer, { log });
      const dealt = 9999 - bearer.hp;
      expect(dealt).toBeGreaterThan(0);
      expect(attackerBefore - attacker.hp).toBe(Math.round(dealt / 2));
      expect(log.filter((l) => l.text.includes("turned back by")).length).toBe(1);
    });
  });

  test("a damage-over-time tick on a reflect bearer reflects nothing", () => {
    withStatus({ id: "fixture-riposte", reflectDamagePercent: 50 }, () => {
      const { ctx } = makeCtx();
      const bearer = ctx.party[0]!;
      bearer.activeStatusEffects.push(status("fixture-riposte"));
      const log: LogEntry[] = [];
      const before = bearer.hp;
      resolveSkillEffect({ kind: "damage", amount: 10 }, bearer, bearer, { log });
      expect(before - bearer.hp).toBe(10);
      expect(log.some((l) => l.text.includes("turned back by"))).toBe(false);
    });
  });

  test("a reflect that kills the attacker marks it dead and logs the defeat", () => {
    withStatus({ id: "fixture-riposte", reflectDamagePercent: 100 }, () => {
      const { ctx } = makeCtx();
      const attacker = ctx.party[0]!;
      attacker.hp = 1;
      const bearer = spawnMonster("dungeon-rat", 1);
      bearer.defense = 0;
      bearer.hp = bearer.maxHp = 9999;
      bearer.activeStatusEffects.push(status("fixture-riposte"));
      const log: LogEntry[] = [];
      resolveSkillEffect({ kind: "damage", amount: 40, offenseMultiplierPercent: 0 }, attacker, bearer, { log });
      expect(attacker.hp).toBe(0);
      expect(attacker.isAlive).toBe(false);
      expect(log.some((l) => l.kind === "death" && l.text.includes(attacker.name))).toBe(true);
    });
  });

  test("two reflect bearers hitting each other reflect once per hit, never in a chain", () => {
    withStatus({ id: "fixture-riposte", reflectDamagePercent: 50 }, () => {
      const { ctx } = makeCtx();
      const a = ctx.party[0]!;
      const b = ctx.party[1]!;
      a.defense = 0;
      b.defense = 0;
      a.activeStatusEffects.push(status("fixture-riposte"));
      b.activeStatusEffects.push(status("fixture-riposte"));
      const log: LogEntry[] = [];
      resolveSkillEffect({ kind: "damage", amount: 40, offenseMultiplierPercent: 0 }, a, b, { log });
      expect(log.filter((l) => l.text.includes("turned back by")).length).toBe(1);
    });
  });
});
