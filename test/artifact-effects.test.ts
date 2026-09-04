import { describe, test, expect } from "bun:test";
import { getClass, getSkill } from "../src/data/classes";
import { Rng } from "../src/engine/rng";
import { startCombat, queueAction, resolveRound, livingMonsterRefs, livingCharacterRefs } from "../src/engine/combat";
import { getRoom } from "../src/engine/dungeon";
import { spawnMonster } from "../src/data/monsters";
import { rollArtifactRarity } from "../src/data/artifacts";
import { applyPartyExp, statsForLevel, recomputeCharacterStats, MAX_EQUIPPED_ARTIFACTS } from "../src/engine/party";
import {
  rollDodge,
  artifactStatBoostSum,
  totalReflectDamagePercent,
  totalLifestealPercent,
  totalHealOnKill,
  autoDamageAmounts,
  totalExpBoostPercent,
  fearResistMultiplier,
  totalCooldownReduction,
} from "../src/engine/artifacts";
import { fearGainForRound, applyRoundFear, applyVictoryFearRelief, drainSatiety, SATIETY_DRAIN_COMBAT, SATIETY_DRAIN_EVENT, isPartyExhausted, isPartyDying } from "../src/engine/survival";
import { Game } from "../src/engine/game";
import type { CombatantRef } from "../src/types";
import { makeCtx, spawnInto, pickAnyAction } from "./helpers";

describe("artifacts", () => {
  test("rollArtifactRarity: Elite never Epic, Boss never Common/Rare, Treasure/Event spans all 4", () => {
    const rng = new Rng(5);
    const seen = { elite: new Set<string>(), boss: new Set<string>(), treasureOrEvent: new Set<string>() };
    for (let i = 0; i < 4000; i++) {
      seen.elite.add(rollArtifactRarity("elite", rng));
      seen.boss.add(rollArtifactRarity("boss", rng));
      seen.treasureOrEvent.add(rollArtifactRarity("treasureOrEvent", rng));
    }
    expect([...seen.elite].sort()).toEqual(["common", "rare", "unique"]);
    expect([...seen.boss].sort()).toEqual(["epic", "unique"]);
    expect([...seen.treasureOrEvent].sort()).toEqual(["common", "epic", "rare", "unique"]);
  });

  test("equip fills slots up to MAX_EQUIPPED_ARTIFACTS, then requires a replacement", () => {
    const game = new Game(1);
    const c = game.state.party[0]!;
    for (const artifactId of ["iron-gauntlet", "sharp-claw", "ancient-sword"]) {
      game.state.pendingArtifactDecision = { artifactId, forceEquip: false };
      expect(game.resolveArtifactEquip(c.id)).toBeNull();
    }
    expect(c.equippedArtifactIds).toHaveLength(MAX_EQUIPPED_ARTIFACTS);
    expect(game.state.pendingArtifactDecision).toBeNull();

    game.state.pendingArtifactDecision = { artifactId: "heart-of-stone", forceEquip: false };
    expect(game.resolveArtifactEquip(c.id)).not.toBeNull(); // full — needs a replaceArtifactId
    expect(game.resolveArtifactEquip(c.id, "sharp-claw")).toBeNull();
    expect(c.equippedArtifactIds).toEqual(["iron-gauntlet", "ancient-sword", "heart-of-stone"]);
  });

  test("discarding a pending ordinary artifact leaves no trace; a forceEquip one can't be discarded", () => {
    const game = new Game(1);
    game.state.pendingArtifactDecision = { artifactId: "iron-gauntlet", forceEquip: false };
    expect(game.discardPendingArtifact()).toBeNull();
    expect(game.state.pendingArtifactDecision).toBeNull();
    expect(game.state.party.some((c) => c.equippedArtifactIds.includes("iron-gauntlet"))).toBe(false);

    game.state.pendingArtifactDecision = { artifactId: "shackle-of-hunger", forceEquip: true };
    expect(game.discardPendingArtifact()).not.toBeNull();
  });

  test("statBoost recomputes attack from scratch and survives a level-up", () => {
    const game = new Game(2);
    const c = game.state.party[0]!;
    const baseAttack = c.attack;
    game.state.pendingArtifactDecision = { artifactId: "iron-gauntlet", forceEquip: false };
    expect(game.resolveArtifactEquip(c.id)).toBeNull();
    expect(c.attack).toBe(baseAttack + 3);

    applyPartyExp(game.state, 999999);
    expect(c.level).toBeGreaterThan(1);
    expect(c.attack).toBe(statsForLevel(getClass(c.classId), c.level).attack + 3);
  });

  test("rollDodge fires close to the equipped artifact's chance", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedArtifactIds.push("featherweight-boots");
    const rng = new Rng(9);
    let dodges = 0;
    const total = 6000;
    for (let i = 0; i < total; i++) if (rollDodge(c, rng)) dodges++;
    expect(dodges / total).toBeGreaterThan(0.04);
    expect(dodges / total).toBeLessThan(0.08);
  });

  test("aggregation helpers sum correctly across multi-effect and stacked artifacts", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedArtifactIds.push("immortal-heart");
    expect(totalReflectDamagePercent(c)).toBe(15);
    expect(artifactStatBoostSum(c).defense).toBe(10);
    expect(artifactStatBoostSum(c).maxHp).toBe(60);

    c.equippedArtifactIds.push("reapers-covenant");
    expect(totalHealOnKill(c)).toBe(25);
    expect(totalLifestealPercent(c)).toBe(8);

    c.equippedArtifactIds.push("thunder-totem", "thunder-totem");
    expect(autoDamageAmounts(c)).toEqual([6, 6]);
  });

  test("totalExpBoostPercent is party-wide; fearResist/cooldownReduction are per-character", () => {
    const { ctx } = makeCtx();
    ctx.party[0]!.equippedArtifactIds.push("scholars-insight");
    ctx.party[1]!.equippedArtifactIds.push("eternal-scholars-tome");
    expect(totalExpBoostPercent(ctx.party)).toBe(40);
    expect(totalCooldownReduction(ctx.party[1]!)).toBe(1);
    expect(totalCooldownReduction(ctx.party[0]!)).toBe(0);

    ctx.party[0]!.equippedArtifactIds.push("pendant-of-calm");
    expect(fearResistMultiplier(ctx.party[0]!)).toBeCloseTo(0.9);
  });

  test("fearGainForRound: base amount at depth 1, no fearResist", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    expect(fearGainForRound(c, 1)).toBe(1);
  });

  test("fearGainForRound: low-HP amount replaces (not adds to) the base amount", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.hp = Math.floor(c.maxHp * 0.59);
    expect(fearGainForRound(c, 1)).toBe(3);
  });

  test("fearGainForRound: scales +5%/floor depth, capped separately for base vs low-HP", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    expect(fearGainForRound(c, 40)).toBe(3);
    expect(fearGainForRound(c, 100)).toBe(3);
    c.hp = Math.floor(c.maxHp * 0.59);
    expect(fearGainForRound(c, 100)).toBe(6);
  });

  test("fearGainForRound: reduced by fearResist artifacts", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.hp = Math.floor(c.maxHp * 0.59);
    c.equippedArtifactIds.push("pendant-of-calm");
    expect(fearGainForRound(c, 1)).toBe(3);
  });

  test("applyRoundFear adds the gain and skips dead characters", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.survival.fear = 10;
    applyRoundFear(c, 1);
    expect(c.survival.fear).toBe(11);

    c.isAlive = false;
    applyRoundFear(c, 1);
    expect(c.survival.fear).toBe(11);
  });

  test("applyVictoryFearRelief: regular vs elite/boss, quick-win vs normal, never stacked", () => {
    const { ctx } = makeCtx();
    for (const c of ctx.party) c.survival.fear = 50;
    applyVictoryFearRelief(ctx.party, false, 5); // not a quick win
    expect(ctx.party.every((c) => c.survival.fear === 45)).toBe(true);

    for (const c of ctx.party) c.survival.fear = 50;
    applyVictoryFearRelief(ctx.party, false, 2); // quick win (round < 3)
    expect(ctx.party.every((c) => c.survival.fear === 40)).toBe(true);

    for (const c of ctx.party) c.survival.fear = 50;
    applyVictoryFearRelief(ctx.party, true, 5); // not a quick win
    expect(ctx.party.every((c) => c.survival.fear === 42)).toBe(true);

    for (const c of ctx.party) c.survival.fear = 50;
    applyVictoryFearRelief(ctx.party, true, 4); // quick win (round < 5)
    expect(ctx.party.every((c) => c.survival.fear === 38)).toBe(true);
  });

  test("beating an Elite in round 1 gets the quick elite/boss relief", () => {
    const { ctx } = makeCtx();
    const elite = spawnMonster("skeleton-guard", 1, { tier: "elite" });
    elite.hp = 1;
    ctx.monsters.push(elite);

    const combat = startCombat("r1", [elite.id], ctx, false);
    for (const c of ctx.party) c.survival.fear = 50;
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx, 1);
    expect(combat.outcome).toBe("victory");
    expect(ctx.party.every((c) => c.survival.fear === 38)).toBe(true);
  });

  test("satiety: drain by room type, Exhausted and Dying thresholds", () => {
    const state = { satiety: 100 } as unknown as import("../src/types").GameState;
    drainSatiety(state, SATIETY_DRAIN_COMBAT, []);
    expect(state.satiety).toBe(90);
    drainSatiety(state, SATIETY_DRAIN_EVENT, []);
    expect(state.satiety).toBe(85);
    drainSatiety(state, 0, []); // Rest room
    expect(state.satiety).toBe(85);
    expect(isPartyExhausted(state.satiety)).toBe(false);
    expect(isPartyDying(state.satiety)).toBe(false);

    state.satiety = 30;
    expect(isPartyExhausted(state.satiety)).toBe(true);
    expect(isPartyDying(state.satiety)).toBe(false);

    state.satiety = 10;
    expect(isPartyExhausted(state.satiety)).toBe(true);
    expect(isPartyDying(state.satiety)).toBe(true);
  });

  test("Exhausted multiplies a character's own base stats by 2/3 but leaves artifact statBoost untouched", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedArtifactIds.push("iron-gauntlet"); // +3 attack
    const baseAttack = statsForLevel(getClass(c.classId), c.level).attack;

    recomputeCharacterStats(c, 100);
    expect(c.attack).toBe(baseAttack + 3);

    recomputeCharacterStats(c, 30); // Exhausted threshold
    expect(c.attack).toBe(Math.round(baseAttack * (2 / 3)) + 3);
    expect(c.maxHp).toBe(statsForLevel(getClass(c.classId), c.level).maxHp); // never reduced
  });

  test("reflectDamage: a monster's attack on the bearer reflects a percent back", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.equippedArtifactIds.push("thorned-armor");

    for (const c of ctx.party) {
      if (c.id !== vanguard.id) c.isAlive = false;
    }
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 200;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    const ratHpBefore = rat.hp;
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("reflected from"))).toBe(true);
    expect(rat.hp).toBeLessThan(ratHpBefore);
  });

  test("lifesteal and healOnKill heal the equipped character on their own damage", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.equippedArtifactIds.push("reapers-covenant");
    vanguard.hp = Math.max(1, vanguard.maxHp - 100);
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.hp = 1;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const attackSkill = vanguard.unlockedSkillIds.map(getSkill).find((s) => s.target === "singleEnemy")!;
    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    queueAction(combat, { kind: "character", id: vanguard.id }, attackSkill.id, [enemyRef], ctx);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("upon defeating an enemy"))).toBe(true);
    expect(combat.log.some((l) => l.text.includes("recovers") && l.text.includes("thanks to an artifact") && !l.text.includes("upon defeating"))).toBe(true);
  });

  test("autoDamage fires at the start of the round, independent of turn order", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.equippedArtifactIds.push("thunder-totem");
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes(`${vanguard.name}'s artifact deals 6 damage`))).toBe(true);
  });

  test("cooldownReduction shortens a skill's cooldown at resolution", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.equippedArtifactIds.push("quickcharge-rune");
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: rogue.id };
    expect(queueAction(combat, self, "rogue-poison-coat", [self], ctx)).toBeNull();
    resolveRound(combat, ctx);
    // cooldownTurns 4 - cooldownReduction 1 = 3, set when the skill executes mid-round, then ticked
    // down by 1 more at this same round's end-of-round cooldown tick.
    expect(rogue.cooldownsRemaining["rogue-poison-coat"]).toBe(2);
  });

  test("expBoost artifacts increase EXP gained on victory", () => {
    const game = new Game(3);
    const vanguard = game.state.party[0]!;
    game.state.pendingArtifactDecision = { artifactId: "scholars-insight", forceEquip: false };
    expect(game.resolveArtifactEquip(vanguard.id)).toBeNull();

    const rat = spawnMonster("dungeon-rat", 1);
    rat.hp = 1;
    game.ctx.monsters.push(rat);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.monsterIds = [rat.id];
    room.cleared = false;
    game.state.combat = startCombat(room.id, [rat.id], game.ctx, false);

    const attackSkill = vanguard.unlockedSkillIds.map(getSkill).find((s) => s.target === "singleEnemy")!;
    const enemyRef: CombatantRef = { kind: "monster", id: rat.id };
    expect(game.queue({ kind: "character", id: vanguard.id }, attackSkill.id, [enemyRef])).toBeNull();
    game.resolve();

    const expectedExp = Math.round(rat.expReward * 1.15);
    expect(game.state.combat!.log.some((l) => l.text.includes(`gains ${expectedExp} EXP`))).toBe(true);
  });
});

