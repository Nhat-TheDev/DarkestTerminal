import { describe, test, expect } from "bun:test";
import { resolveSkillEffect, getFearTier, rollLosesControl, tickDotEffects, tickStatModEffects, mitigatedOffense, statusCategory } from "../src/engine/resolver";
import type { LogEntry, CombatantRef, StatusEffectDefinition } from "../src/types";
import { makeCtx } from "./helpers";
import { Game } from "../src/engine/game";
import { startCombat } from "../src/engine/combat";
import { getRoom } from "../src/engine/dungeon";
import { spawnMonster } from "../src/data/monsters";
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

    // Above the threshold: no bonus at all.
    target.hp = target.maxHp;
    const beforeAbove = target.hp;
    resolveSkillEffect({ kind: "damage", amount: 5 }, attacker, target, { log: [], executeBonus });
    const plainHit = beforeAbove - target.hp;
    expect(plainHit).toBe(Math.max(1, Math.round(5 + mitigatedOffense(attacker.attack, target.defense))));

    // Below the threshold: both the flat add and the % multiplier apply. maxHp is bumped so the
    // hit doesn't exceed remaining HP and get capped at 0 before the full delta can be observed.
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
    target.activeStatusEffects.push({ statusEffectId: "test-stacked", turnsRemaining: 3, stacks: 4 });
    const before = target.hp;
    const scalesWithStatusStacks = { statusEffectId: "test-stacked", percentPerStack: 5 };
    resolveSkillEffect({ kind: "damage", amount: 0, scalesWithStatusStacks }, attacker, target, { log: [] });
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

  test("modifyStat clamps fear/hunger/thirst to [0, 100]", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.survival.fear = 95;
    resolveSkillEffect({ kind: "modifyStat", stat: "fear", amount: 50 }, target, target, { log: [] });
    expect(target.survival.fear).toBe(100);
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

    // Recast while still active — refreshes the same entry rather than stacking a 2nd instance.
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "guard" }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(220);
    expect(vanguard.activeStatusEffects).toHaveLength(1);

    tickStatModEffects(vanguard, { log });
    // Must undo the full +20 minPercent-floored delta, not the flat +6 `amount`.
    expect(vanguard.defense).toBe(200);
    expect(vanguard.activeStatusEffects).toHaveLength(0);
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

    vanguard.defense += 500; // an unrelated change to the same stat, e.g. a 2nd buff/item — recomputing the floor now would disagree with what was actually applied

    tickStatModEffects(vanguard, { log });
    expect(vanguard.defense).toBe(700); // 220 + 500, minus the stored 20 - not a re-derived floor off the new 720 (which would undo 72)
    expect(vanguard.activeStatusEffects).toHaveLength(0);
  });

  test("a status effect's own damage tick (DoT) is flat (amount + maxHpPercent), not attack-minus-defense", () => {
    const { ctx } = makeCtx();
    const victim = ctx.monsters[0]!;
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

    expect(game.queue(rogueRef, "rogue-poison-coat", [rogueRef])).toBeNull();
    expect(game.queue(vikingRef, "viking-lightning-axe", [vikingRef])).toBeNull();
    expect(game.queue(vanguardRef, "vanguard-slash", [enemyRef])).toBeNull();
    game.resolve();

    expect(game.state.combat!.outcome).toBe("victory");
    expect(rogue.activeStatusEffects.some((a) => a.statusEffectId === "poison-coat")).toBe(false);
    expect(viking.activeStatusEffects.some((a) => a.statusEffectId.startsWith("storm-empowered"))).toBe(false);
  });

  test("a debuff survives a room win, keeping its duration and penalty", () => {
    const { game, vanguard, rat } = setUpOneHpFight(11);
    const baseDef = vanguard.defense;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "weakened", durationTurns: 2 }, vanguard, vanguard, { log: game.state.combat!.log });
    expect(vanguard.defense).toBe(baseDef - 6);

    const vanguardRef: CombatantRef = { kind: "character", id: vanguard.id };
    const enemyRef: CombatantRef = { kind: "monster", id: rat.id };
    expect(game.queue(vanguardRef, "vanguard-slash", [enemyRef])).toBeNull();
    game.resolve();

    expect(game.state.combat!.outcome).toBe("victory");
    const weakened = vanguard.activeStatusEffects.find((a) => a.statusEffectId === "weakened");
    expect(weakened).toBeDefined();
    expect(weakened!.turnsRemaining).toBe(2);
    expect(vanguard.defense).toBe(baseDef - 6);
  });
});

