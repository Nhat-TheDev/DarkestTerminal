import { describe, test, expect } from "bun:test";
import { getClass, getSkill } from "../src/data/classes";
import { Rng } from "../src/engine/rng";
import { startCombat, queueAction, resolveRound, livingMonsterRefs, livingCharacterRefs, applySkillEffects } from "../src/engine/combat";
import { getRoom } from "../src/engine/dungeon";
import { spawnMonster } from "../src/data/monsters";
import { rollArtifactRarity, artifactRarityWeights, ARTIFACTS, formatArtifactEffect } from "../src/data/artifacts";
import { BALANCE } from "../src/data/balanceConfig";
import { t } from "../src/data/strings";
import { applyPartyExp, statsForLevel, recomputeCharacterStats, MAX_EQUIPPED_ARTIFACTS } from "../src/engine/party";
import {
  rollDodge,
  artifactStatBoostSum,
  totalReflectDamagePercent,
  totalLifestealPercent,
  totalHealOnKill,
  autoDamageEntries,
  totalExpBoostPercent,
  fearResistMultiplier,
  totalCooldownReduction,
  alwaysHitChance,
  debuffResistPercent,
} from "../src/engine/artifacts";
import { fearGainForRound, applyRoundFear, applyVictoryFearRelief, drainSatiety, SATIETY_DRAIN_COMBAT, SATIETY_DRAIN_EVENT, isPartyExhausted, isPartyDying } from "../src/engine/survival";
import { Game } from "../src/engine/game";
import type { CombatantRef, SkillDefinition } from "../src/types";
import { makeCtx, spawnInto, pickAnyAction } from "./helpers";

describe("artifacts", () => {
  test("artifactRarityWeights: the anchor step returns the configured anchor, every step sums to 100", () => {
    const { anchorFirstFloor, anchorWeights } = BALANCE.artifacts;
    for (const source of ["elite", "boss", "treasureOrEvent"] as const) {
      const anchor = anchorWeights[source];
      const total = Object.values(anchor).reduce((sum, w) => sum + w, 0);
      const atAnchor = artifactRarityWeights(source, anchorFirstFloor);
      for (const rarity of ["common", "rare", "unique", "epic"] as const) expect(atAnchor[rarity]).toBeCloseTo((100 * anchor[rarity]) / total, 6);
      for (const depth of [1, 10, 11, 25, 35, 60, 200]) {
        const sum = Object.values(artifactRarityWeights(source, depth)).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(100, 6);
      }
    }
  });

  test("artifactRarityWeights: deeper floors shift weight up the rarities, one 10-floor step at a time", () => {
    for (const source of ["elite", "boss", "treasureOrEvent"] as const) {
      const at = (depth: number) => artifactRarityWeights(source, depth);
      // floors within the same step share odds; crossing a multiple of 10 changes them
      expect(at(1)).toEqual(at(10));
      expect(at(10)).not.toEqual(at(11));
      let previous = at(1);
      for (const depth of [11, 21, 31, 41, 51, 61]) {
        const current = at(depth);
        expect(current.common).toBeLessThan(previous.common);
        if (source !== "elite") expect(current.epic).toBeGreaterThan(previous.epic);
        expect(current.unique / (current.common + current.rare)).toBeGreaterThan(previous.unique / (previous.common + previous.rare));
        previous = current;
      }
    }
  });

  test("Elite never rolls Epic at any depth; floors 1-10 almost never roll Unique or Epic", () => {
    for (const depth of [1, 10, 35, 80, 300]) expect(artifactRarityWeights("elite", depth).epic).toBe(0);
    for (const source of ["elite", "boss", "treasureOrEvent"] as const) {
      const early = artifactRarityWeights(source, 5);
      expect(early.unique + early.epic).toBeLessThan(5);
    }
  });

  test("rollArtifactRarity draws from the depth's odds: early floors never show Epic, deep Boss floors mostly do", () => {
    const rng = new Rng(5);
    const counts = (source: "elite" | "boss" | "treasureOrEvent", depth: number) => {
      const seen = { common: 0, rare: 0, unique: 0, epic: 0 };
      for (let i = 0; i < 4000; i++) seen[rollArtifactRarity(source, rng, depth)]++;
      return seen;
    };
    expect(counts("elite", 400).epic).toBe(0);
    expect(counts("treasureOrEvent", 5).epic).toBe(0);
    expect(counts("boss", 55).epic / 4000).toBeGreaterThan(0.5);
    expect(counts("boss", 5).common / 4000).toBeGreaterThan(0.6);
  });

  test("artifactRarityWeights: odds freeze beyond maxStepsFromAnchor and stay finite at absurd depths", () => {
    for (const source of ["elite", "boss", "treasureOrEvent"] as const) {
      const frozen = artifactRarityWeights(source, 140);
      expect(artifactRarityWeights(source, 1_000_000)).toEqual(frozen);
      expect(Object.values(frozen).every(Number.isFinite)).toBe(true);
    }
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

  test("rollDodge sums the Ninja passive's dodge% alongside equipped artifact dodgeChance sources", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    ninja.level = 35; // rank 3: +15% dodge
    const rng = new Rng(9);
    let dodges = 0;
    const total = 6000;
    for (let i = 0; i < total; i++) if (rollDodge(ninja, rng)) dodges++;
    expect(dodges / total).toBeGreaterThan(0.1);
    expect(dodges / total).toBeLessThan(0.2);
  });

  test("aggregation helpers sum correctly across multi-effect and stacked artifacts", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedArtifactIds.push("immortal-heart");
    expect(totalReflectDamagePercent(c)).toBe(15);
    const base = { attack: c.attack, defense: c.defense, maxHp: c.maxHp, maxMp: c.maxMp, magicPower: c.magicPower, speed: c.speed };
    expect(artifactStatBoostSum(c, base).defense).toBe(10);
    expect(artifactStatBoostSum(c, base).maxHp).toBe(60);

    c.equippedArtifactIds.push("reapers-covenant");
    expect(totalHealOnKill(c, c.maxHp)).toBe(25);
    expect(totalLifestealPercent(c)).toBe(8);

    c.equippedArtifactIds.push("thunder-totem", "thunder-totem");
    expect(autoDamageEntries(c).map((e) => e.effect.amount)).toEqual([6, 6]);
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

  test("lifesteal heals off the full damage of a multi-hit skill, not just its last hit", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.equippedArtifactIds.push("reapers-covenant"); // 8% lifesteal
    vanguard.hp = Math.max(1, vanguard.maxHp - 100);
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.hp = 99999;
    rat.defense = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    // offenseMultiplierPercent: 0 keeps each hit's damage a deterministic flat 20, regardless of the
    // Vanguard's own attack stat, so the expected total (3 x 20 = 60) is exact, not just "greater than".
    const multiHitSkill: SkillDefinition = {
      id: "test-multi-hit",
      name: "Test Multi Hit",
      description: "",
      mpCost: 0,
      target: "singleEnemy",
      effects: [{ kind: "damage", amount: 20, offenseMultiplierPercent: 0, hitCountRange: { min: 3, max: 3 } }],
      slot: 0,
      unlockLevel: 1,
    };
    const hpBefore = vanguard.hp;
    applySkillEffects(multiHitSkill, vanguard, [rat], combat, ctx, combat.log);
    // Lifesteal must scale off all 3 hits (60 total), not just the last one: round(60*0.08)=5.
    expect(vanguard.hp - hpBefore).toBe(5);
  });

  test("autoDamage fires at the start of the round, independent of turn order", () => {
    const { ctx } = makeCtx();
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    mage.equippedArtifactIds.push("thunder-totem");
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: mage.id };
    queueAction(combat, self, "mage-bludgeon", [{ kind: "monster", id: rat.id }], ctx);
    resolveRound(combat, ctx);
    const firstAutoHit = combat.log.findIndex((l) => l.text.includes("Thunder Totem"));
    const firstAction = combat.log.findIndex((l) => l.text.includes("Bludgeon"));
    expect(firstAutoHit).toBeGreaterThanOrEqual(0);
    expect(firstAutoHit).toBeLessThan(firstAction === -1 ? Infinity : firstAction);
  });

  test("autoDamage artifacts hit one target and scale off base magicPower or base attack", () => {
    const taken = (artifactId: string, classId: string, liveStat: number | null) => {
      const { ctx } = makeCtx();
      const c = ctx.party.find((p) => p.classId === classId)!;
      c.level = 60;
      c.equippedArtifactIds.push(artifactId);
      const rats = [spawnInto(ctx, "dungeon-rat"), spawnInto(ctx, "dungeon-rat")];
      for (const r of rats) r.maxHp = r.hp = 50000;
      const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
      if (liveStat !== null) c.attack = c.magicPower = liveStat;
      resolveRound(combat, ctx);
      const hits = rats.map((r) => 50000 - r.hp).filter((d) => d > 0);
      expect(hits).toHaveLength(1);
      return hits[0]!;
    };
    expect(taken("thunder-totem", "mage", null)).toBeGreaterThan(taken("thunder-totem", "rogue", null));
    expect(taken("crown-of-destruction", "rogue", null)).toBeGreaterThan(taken("crown-of-destruction", "mage", null));
    // live stats (buffs, equipment) never feed the tick
    expect(taken("thunder-totem", "mage", 9999)).toBe(taken("thunder-totem", "mage", null));
    expect(taken("crown-of-destruction", "rogue", 1)).toBe(taken("crown-of-destruction", "rogue", null));
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

  test("magicPower and speed statBoosts apply to the bearer and survive Exhausted", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    const cls = getClass(c.classId);
    const baseMagic = statsForLevel(cls, c.level).magicPower;
    c.equippedArtifactIds.push("resonant-tuning-fork", "runners-ankle-cord"); // +8 magicPower, +2 speed
    recomputeCharacterStats(c, 100);
    expect(c.magicPower).toBe(baseMagic + 8);
    expect(c.speed).toBe(cls.baseSpeed + 2);

    recomputeCharacterStats(c, 30);
    expect(c.magicPower).toBe(Math.round(baseMagic * (2 / 3)) + 8);
    expect(c.speed).toBe(Math.round(cls.baseSpeed * (2 / 3)) + 2);
  });

  test("alwaysHit and debuffResist combine as independent chances across artifacts and the Ability", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    expect(alwaysHitChance(c)).toBe(0);
    expect(debuffResistPercent(c)).toBe(0);

    c.equippedArtifactIds.push("hunters-tally-stick", "bitter-root-charm"); // alwaysHit 8, debuffResist 10
    expect(alwaysHitChance(c)).toBe(8);
    expect(debuffResistPercent(c)).toBe(10);

    c.equippedArtifactIds.push("threshold-salt-pouch"); // debuffResist 15
    expect(debuffResistPercent(c)).toBeCloseTo(100 * (1 - 0.9 * 0.85), 6);

    c.equippedAbilityId = "unerring-will"; // alwaysHit 20
    expect(alwaysHitChance(c)).toBeCloseTo(100 * (1 - 0.92 * 0.8), 6);
  });

  test("every artifact effect kind has a formatter line", () => {
    for (const artifact of ARTIFACTS) {
      expect(formatArtifactEffect(artifact)).not.toContain(t("effect.default"));
    }
  });
});
