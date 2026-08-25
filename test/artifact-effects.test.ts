import { describe, test, expect } from "bun:test";
import { getClass, getSkill } from "../src/data/classes";
import { Rng } from "../src/engine/rng";
import { startCombat, queueAction, resolveRound, livingMonsterRefs, livingCharacterRefs } from "../src/engine/combat";
import { getRoom } from "../src/engine/dungeon";
import { spawnMonster } from "../src/data/monsters";
import { rollArtifactRarity } from "../src/data/artifacts";
import { applyPartyExp, statsForLevel, MAX_EQUIPPED_ARTIFACTS } from "../src/engine/party";
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
  survivalDrainMultiplier,
} from "../src/engine/artifacts";
import { fearGainForRound, applyRoundFear, applyVictoryFearRelief, tickSurvivalOnAction } from "../src/engine/survival";
import { Game } from "../src/engine/game";
import type { CombatantRef } from "../src/types";
import { makeCtx, spawnInto, pickAnyAction } from "./helpers";

describe("artifacts (docs/gameplay-decisions/07-items-artifacts.md §7.2)", () => {
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

  test("equipArtifact/unequipArtifact move ids between the shared pool and a character, capped at MAX_EQUIPPED_ARTIFACTS", () => {
    const game = new Game(1);
    const c = game.state.party[0]!;
    game.state.unequippedArtifactIds.push("iron-gauntlet", "sharp-claw", "ancient-sword", "heart-of-stone");
    expect(game.equipArtifact(c.id, "iron-gauntlet")).toBeNull();
    expect(game.equipArtifact(c.id, "sharp-claw")).toBeNull();
    expect(game.equipArtifact(c.id, "ancient-sword")).toBeNull();
    expect(c.equippedArtifactIds).toHaveLength(MAX_EQUIPPED_ARTIFACTS);
    expect(game.equipArtifact(c.id, "heart-of-stone")).not.toBeNull();
    expect(game.state.unequippedArtifactIds).toEqual(["heart-of-stone"]);

    expect(game.unequipArtifact(c.id, "sharp-claw")).toBeNull();
    expect(c.equippedArtifactIds).toHaveLength(2);
    expect(game.state.unequippedArtifactIds).toContain("sharp-claw");
  });

  test("statBoost recomputes attack from scratch and survives a level-up", () => {
    const game = new Game(2);
    const c = game.state.party[0]!;
    const baseAttack = c.attack;
    game.state.unequippedArtifactIds.push("iron-gauntlet");
    expect(game.equipArtifact(c.id, "iron-gauntlet")).toBeNull();
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

  test("totalExpBoostPercent is party-wide; fearResist/cooldownReduction/survivalDrainReduction are per-character", () => {
    const { ctx } = makeCtx();
    ctx.party[0]!.equippedArtifactIds.push("scholars-insight");
    ctx.party[1]!.equippedArtifactIds.push("eternal-scholars-tome");
    expect(totalExpBoostPercent(ctx.party)).toBe(40);
    expect(totalCooldownReduction(ctx.party[1]!)).toBe(1);
    expect(totalCooldownReduction(ctx.party[0]!)).toBe(0);

    ctx.party[0]!.equippedArtifactIds.push("pendant-of-calm");
    expect(fearResistMultiplier(ctx.party[0]!)).toBeCloseTo(0.9);
    ctx.party[0]!.equippedArtifactIds.push("travelers-ration");
    expect(survivalDrainMultiplier(ctx.party[0]!)).toBeCloseTo(0.85);
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

  test("applyVictoryFearRelief: normal victory -10, boss victory -15 (not stacked)", () => {
    const { ctx } = makeCtx();
    for (const c of ctx.party) c.survival.fear = 50;
    applyVictoryFearRelief(ctx.party, false);
    expect(ctx.party.every((c) => c.survival.fear === 40)).toBe(true);

    for (const c of ctx.party) c.survival.fear = 50;
    applyVictoryFearRelief(ctx.party, true);
    expect(ctx.party.every((c) => c.survival.fear === 35)).toBe(true);
  });

  test("beating an Elite gets the bigger -15 fear relief too, even outside the boss room (combat.ts integration)", () => {
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
    expect(ctx.party.every((c) => c.survival.fear === 35)).toBe(true);
  });

  test("survivalDrainReduction reduces hunger/thirst drain per action (survival.ts integration)", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedArtifactIds.push("travelers-ration");
    tickSurvivalOnAction(c, []);
    expect(c.survival.hunger).toBeCloseTo(99.1, 5);
    expect(c.survival.thirst).toBeCloseTo(98.7, 5);
  });

  test("reflectDamage: a monster's attack on the bearer reflects a percent back (combat.ts integration)", () => {
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

  test("lifesteal and healOnKill heal the equipped character on their own damage (combat.ts integration)", () => {
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

  test("autoDamage fires at the start of the round, independent of turn order (combat.ts integration)", () => {
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

  test("cooldownReduction shortens a skill's cooldown at queue time (combat.ts integration)", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.equippedArtifactIds.push("quickcharge-rune");
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: rogue.id };
    expect(queueAction(combat, self, "rogue-poison-coat", [self], ctx)).toBeNull();
    expect(rogue.cooldownsRemaining["rogue-poison-coat"]).toBe(3);
  });

  test("expBoost artifacts increase EXP gained on victory (Game integration)", () => {
    const game = new Game(3);
    const vanguard = game.state.party[0]!;
    game.state.unequippedArtifactIds.push("scholars-insight");
    expect(game.equipArtifact(vanguard.id, "scholars-insight")).toBeNull();

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

