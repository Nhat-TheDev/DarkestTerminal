import { describe, test, expect } from "bun:test";
import { resolveSkillEffect, getFearTier, rollLosesControl, tickStatusEffects, mitigatedOffense } from "../src/engine/resolver";
import type { LogEntry, CombatantRef } from "../src/types";
import { makeCtx } from "./helpers";
import { Game } from "../src/engine/game";
import { startCombat } from "../src/engine/combat";
import { getRoom } from "../src/engine/dungeon";
import { spawnMonster } from "../src/data/monsters";

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

  test("modifyCombatStat buff installs immediately and undoes on expiry — buffs count down starting the round they're cast in (guard is a 1-turn buff)", () => {
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

  test("modifyCombatStat debuff delays its duration countdown by 1 round — the round it's cast in is free (weakened is a 2-turn debuff)", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const baseDef = vanguard.defense;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "weakened" }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(baseDef - 6);

    // The tick at the end of the round it was applied in is a no-op for duration purposes.
    tickStatusEffects(vanguard, { log });
    expect(vanguard.defense).toBe(baseDef - 6);
    expect(vanguard.activeStatusEffects[0]?.turnsRemaining).toBe(2);

    tickStatusEffects(vanguard, { log });
    expect(vanguard.defense).toBe(baseDef - 6);
    expect(vanguard.activeStatusEffects[0]?.turnsRemaining).toBe(1);

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

describe("room-clear status effect cleanup (Game integration)", () => {
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

  test("Rogue's Poison Coat and Viking's Storm-Empowered (self-buffs with a multi-turn duration) are force-expired the instant the room is won", () => {
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

  test("a debuff (Weakened) survives that same room win instead of being wiped, keeping its remaining duration and its stat penalty", () => {
    const { game, vanguard, rat } = setUpOneHpFight(11);
    const baseDef = vanguard.defense;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "weakened" }, vanguard, vanguard, { log: game.state.combat!.log });
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

