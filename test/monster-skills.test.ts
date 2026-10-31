import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, resolveRound, livingCharacterRefs, type EngineContext } from "../src/engine/combat";
import { spawnMonster, getMonsterSkill, getArchetype, assertMonsterDataConsistent, assertMonsterKitConsistent, MONSTER_ARCHETYPES, MONSTER_SKILLS } from "../src/data/monsters";
import { assertSummonDataConsistent, SUMMON_ARCHETYPES, SUMMON_CASTS } from "../src/data/summons";
import { runMonsterTurn, targetingWeight } from "../src/engine/monsterAI";
import { applyStatusEffectToActor, resolveSkillEffect, tickDotEffects } from "../src/engine/resolver";
import { getStatusEffect } from "../src/data/statusEffects";
import type { AttackRange, Character, MonsterArchetype, Summon } from "../src/types";
import { BALANCE, targetingConfigError, type TargetingConfig } from "../src/data/balanceConfig";
import { createFloor } from "../src/data/floor";
import { Rng } from "../src/engine/rng";
import { makeCtx, spawnInto, pickAnyAction, sk, withFixture } from "./helpers";
import { getClass } from "../src/data/classes";

describe("elite/boss skill kit", () => {
  function queueTrivialActions(ctx: EngineContext, combat: ReturnType<typeof startCombat>) {
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
  }

  test("elite/boss pick from a weighted action pool; skill kit and basic attack are both reachable", () => {
    const kitNames = getArchetype("skeleton-guard").skillIds.map((id) => getMonsterSkill(id).name);
    let sawNamedKit = false;
    let sawBasicAttack = false;
    for (let seed = 0; seed < 30 && !(sawNamedKit && sawBasicAttack); seed++) {
      for (const tier of ["elite", "boss"] as const) {
        const { ctx } = makeCtx(seed);
        const monster = spawnMonster("skeleton-guard", 1, { tier });
        ctx.monsters.push(monster);
        const combat = startCombat("r1", [monster.id], ctx, false);
        queueTrivialActions(ctx, combat);
        resolveRound(combat, ctx);
        const monsterLines = combat.log.filter((l) => l.text.startsWith(monster.name));
        if (monsterLines.some((l) => kitNames.some((name) => l.text.includes(name)))) sawNamedKit = true;
        if (monsterLines.some((l) => l.text.includes("attacks"))) sawBasicAttack = true;
      }
    }
    expect(sawNamedKit).toBe(true);
    expect(sawBasicAttack).toBe(true);
  });

  test("normal-tier skeleton-guard still uses a flat attack", () => {
    const { ctx } = makeCtx(1);
    const monster = spawnMonster("skeleton-guard", 1);
    monster.maxHp = 500;
    monster.hp = 500;
    ctx.monsters.push(monster);
    const combat = startCombat("r1", [monster.id], ctx, false);
    queueTrivialActions(ctx, combat);
    resolveRound(combat, ctx);
    const monsterLines = combat.log.filter((l) => l.text.startsWith(monster.name));
    expect(monsterLines.some((l) => l.text.includes("attacks"))).toBe(true);
    const kitNames = getArchetype("skeleton-guard").skillIds.map((id) => getMonsterSkill(id).name);
    expect(monsterLines.some((l) => kitNames.some((name) => l.text.includes(name)))).toBe(false);
  });

  test("an elite's area skill damages every living character when it fires", () => {
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const elite = spawnMonster("dragon", 1, { tier: "elite" });
      elite.maxHp = elite.hp = 5000;
      ctx.monsters.push(elite);
      const combat = startCombat("r1", [elite.id], ctx, false);
      queueTrivialActions(ctx, combat);
      const hpBefore = new Map(ctx.party.filter((c) => c.isAlive).map((c) => [c.id, c.hp]));
      resolveRound(combat, ctx);
      if (!combat.log.some((l) => l.text.includes("uses Fire Breath"))) continue;
      found = true;
      const hitCount = [...hpBefore.entries()].filter(([id, hp]) => ctx.party.find((p) => p.id === id)!.hp < hp).length;
      expect(hitCount).toBe(hpBefore.size);
    }
    expect(found).toBe(true);
  });

  test("a boss skill's status lands on the target it names", () => {
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const boss = spawnMonster("zombie-knight", 1, { tier: "boss" });
      boss.maxHp = boss.hp = 5000;
      ctx.monsters.push(boss);
      const combat = startCombat("r1", [boss.id], ctx, false);
      queueTrivialActions(ctx, combat);
      resolveRound(combat, ctx);
      if (!combat.log.some((l) => l.text.includes("gains the Enfeebled effect"))) continue;
      found = true;
      expect(ctx.party.some((c) => c.activeStatusEffects.some((s) => s.statusEffectId === "enfeebled"))).toBe(true);
    }
    expect(found).toBe(true);
  });

  test("every monster skill log line derives from the skill's own target, not from which weight key rolled it", () => {
    // Single-target skills all name their target now, whatever tier or weight key produced them.
    const lines: string[] = [];
    for (let seed = 0; seed < 40; seed++) {
      for (const [id, tier] of [["dungeon-rat", "normal"], ["dragon", "boss"]] as const) {
        const { ctx } = makeCtx(seed);
        const monster = spawnMonster(id, 1, tier === "normal" ? undefined : { tier });
        // The telegraph is held off so every boss turn goes through the plain roll.
        monster.skillCooldowns = { inferno: 99 };
        // High HP so the party's opening damage doesn't kill it before it uses its skill.
        monster.hp = monster.maxHp = 9999;
        ctx.monsters.push(monster);
        const combat = startCombat("r1", [monster.id], ctx, false);
        queueTrivialActions(ctx, combat);
        resolveRound(combat, ctx);
        lines.push(...combat.log.map((l) => l.text));
      }
    }
    const bite = lines.find((l) => l.includes("uses Bite"));
    const rake = lines.find((l) => l.includes("uses Claw Rake"));
    const breath = lines.find((l) => l.includes("uses Fire Breath"));
    expect(bite).toMatch(/^Dungeon Rat uses Bite on .+\.$/);
    expect(rake).toMatch(/^Dragon \(Boss\) uses Claw Rake on .+\.$/);
    expect(breath).toBe("Dragon (Boss) uses Fire Breath, sweeping the whole party!");
  });

  test("the-founder carries its own kit and three HP bars, weighted for boss tier only", () => {
    const founder = getArchetype("the-founder");
    expect(founder.skillIds).toEqual(["paid-in-full", "the-same-price", "whats-left-listening", "everything-you-asked-for", "ask-properly", "the-answer", "hung-lower", "the-last-of-it"]);
    expect(getMonsterSkill("everything-you-asked-for").telegraph).toBe(true);
    expect(founder.bossTelegraph!.skillId).toBe("everything-you-asked-for");
    expect(getMonsterSkill("paid-in-full").targetCount).toEqual({ min: 2, max: 3 });
    expect(getMonsterSkill("the-same-price").target).toBe("allEnemies");
    expect(Object.keys(founder.actionWeights!.boss!).sort()).toEqual(["basicAttack", "paid-in-full", "whats-left-listening"]);
    expect(founder.phases).toBeUndefined();
    expect(founder.bars!.map((b) => b.onEnterSkillId)).toEqual([undefined, "hung-lower", "the-last-of-it"]);
    expect(founder.bars!.map((b) => b.bossTelegraph?.skillId)).toEqual([undefined, "ask-properly", "the-answer"]);
    expect(getMonsterSkill("ask-properly").targetCount).toEqual({ min: 2, max: 3 });
    expect(getMonsterSkill("the-answer").target).toBe("allEnemies");
    // Never spawned at elite tier.
    expect(founder.actionWeights?.elite).toBeUndefined();
  });

  test("the-founder actually reaches its multi-target strike and its area skill in combat", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 80 && seen.size < 2; seed++) {
      const { ctx } = makeCtx(seed);
      const monster = spawnMonster("the-founder", 1, { tier: "boss" });
      ctx.monsters.push(monster);
      const combat = startCombat("r1", [monster.id], ctx, false);
      for (let round = 0; round < 6 && seen.size < 2; round++) {
        // Execute runs on its own cycle outside the weighted pool; hold it off.
        monster.skillCooldowns = { "everything-you-asked-for": 99 };
        queueTrivialActions(ctx, combat);
        resolveRound(combat, ctx);
        if (combat.log.some((l) => l.text.includes("Paid In Full"))) seen.add("strike");
        if (combat.log.some((l) => l.text.includes("The Same Price"))) seen.add("cleave");
      }
    }
    expect(seen).toEqual(new Set(["strike", "cleave"]));
  });

  test("the-founder is the final boss — it never appears in a rolled boss room", () => {
    expect(getArchetype("the-founder").finalBoss).toBe(true);
    expect(getArchetype("the-founder").roles).toEqual(["boss"]);
    for (let seed = 0; seed < 200; seed++) {
      // Depth 10 is a boss-tier floor; depth 5 rolls the same pool at elite tier.
      for (const depth of [5, 10]) {
        const { monsters } = createFloor(new Rng(seed), depth);
        expect(monsters.some((m) => m.archetypeId === "the-founder")).toBe(false);
      }
    }
  });
});


describe("regular monster skills", () => {
  test("Black Bat's Blood Drain has lifestealPercent 50", () => {
    expect(getMonsterSkill("blood-drain").effects).toEqual([{ kind: "damage", amount: 12, lifestealPercent: 50 }]);
  });

  test("Zombie's Regeneration is a self-heal that floors at 20% of its own maxHp", () => {
    const skill = getMonsterSkill("regeneration");
    expect(skill.target).toBe("self");
    expect(skill.effects).toEqual([{ kind: "heal", amount: 15, maxHpPercent: 20 }]);
  });

  test("Slime's Acid Spit procs acid-burn and corroded together, Spider's Web Spit procs webbed", () => {
    expect(getMonsterSkill("acid-spit").effects).toEqual([
      { kind: "damage", amount: 10 },
      { kind: "applyStatusEffect", statusEffectId: "acid-burn", alsoApplyStatusEffectIds: ["corroded"], chance: 0.5, durationTurns: 2 },
    ]);
    expect(getMonsterSkill("web-spit").effects).toEqual([
      { kind: "damage", amount: 13 },
      { kind: "applyStatusEffect", statusEffectId: "webbed", chance: 0.5, durationTurns: 2 },
    ]);
  });

  test("Skeleton Warrior's Guard Stance applies the shared guard status", () => {
    const skill = getMonsterSkill("guard-stance");
    expect(skill.target).toBe("self");
    expect(skill.effects).toEqual([{ kind: "applyStatusEffect", statusEffectId: "guard", durationTurns: 2 }]);
  });

  test("actionWeights.normal is 70/30 for random archetypes, 100/0 for Zombie/Skeleton Warrior", () => {
    for (const id of ["dungeon-rat", "black-bat", "slime", "skeleton", "snake", "lizard", "spider", "skeleton-archer"]) {
      const a = getArchetype(id);
      expect(a.skillIds.length).toBe(1);
      expect(a.actionWeights?.normal).toEqual({ basicAttack: 70, [a.skillIds[0]!]: 30 });
    }
    // Weight 0: the skill fires only from the low-HP branch. The key stays because the rebalance editor's PATCH only accepts existing keys.
    for (const id of ["zombie", "skeleton-warrior"]) {
      const a = getArchetype(id);
      expect(a.skillIds.length).toBe(1);
      expect(a.actionWeights?.normal).toEqual({ basicAttack: 100, [a.skillIds[0]!]: 0 });
    }
  });

  test("Skeleton Guard does nothing but a basic attack at normal tier, and has its full kit above it", () => {
    const guard = getArchetype("skeleton-guard");
    expect(guard.actionWeights?.normal).toEqual({ basicAttack: 100 });
    expect(guard.skillIds).toEqual(["hold-the-line", "shield-bash", "riposte-stance", "overhead-cut"]);
    expect(getMonsterSkill("overhead-cut").telegraph).toBe(true);
  });

  test("every action-weight key names a skill the archetype declares, and a stray key throws on load", () => {
    assertMonsterDataConsistent(MONSTER_ARCHETYPES); // the shipped catalog

    const typo = { id: "typo-test", style: { abbr: "TYP", color: "#000000" }, aiPattern: "aggressive", attackRange: "melee", roles: ["normal"], powerTier: "weak", minFloor: 0, skillIds: ["bite"], actionWeights: { normal: { basicAttack: 70, bight: 30 } } } as unknown as MonsterArchetype;
    expect(() => assertMonsterDataConsistent([typo])).toThrow(/actionWeights\.normal key "bight" is not in its skillIds/);

    const ghost = { id: "ghost-test", style: { abbr: "GHT", color: "#000000" }, aiPattern: "aggressive", attackRange: "melee", roles: ["normal"], powerTier: "weak", minFloor: 0, skillIds: ["no-such-skill"], actionWeights: { normal: { basicAttack: 100 } } } as unknown as MonsterArchetype;
    expect(() => assertMonsterDataConsistent([ghost])).toThrow(/Unknown monster skill: no-such-skill/);
  });

  // The JSON loads through an unchecked cast, so a missing description would ship silently; descriptions are flavor and carry no numbers.
  test("every archetype carries a player-facing description, and no description states a number", () => {
    for (const archetype of MONSTER_ARCHETYPES) {
      expect(archetype.description?.trim() ?? "").not.toBe("");
      expect(archetype.description).not.toMatch(/[0-9]/);
    }
  });
});


describe("aiPattern: \"defensive\" HP<40% self-skill bias", () => {
  test("a Zombie below 40% HP is biased toward self-casting Regeneration, not deterministic", () => {
    let castCount = 0;
    let notCastCount = 0;
    for (let seed = 0; seed < 60; seed++) {
      const { ctx } = makeCtx(seed);
      const zombie = spawnInto(ctx, "zombie");
      zombie.hp = Math.floor(zombie.maxHp * 0.3);
      const combat = startCombat("r1", [zombie.id], ctx, false);
      resolveRound(combat, ctx);
      if (combat.log.some((l) => l.text.includes("Regeneration"))) castCount++;
      else notCastCount++;
    }
    expect(castCount).toBeGreaterThan(notCastCount);
    expect(notCastCount).toBeGreaterThan(0);
  });

  test("a Zombie at/above 40% HP never self-casts", () => {
    const { ctx } = makeCtx();
    const zombie = spawnInto(ctx, "zombie");
    zombie.hp = Math.ceil(zombie.maxHp * 0.4);
    const combat = startCombat("r1", [zombie.id], ctx, false);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("Regeneration"))).toBe(false);
  });

  test("a Skeleton Warrior below 40% HP is biased toward Guard Stance but can still attack", () => {
    let guardCount = 0;
    let attackCount = 0;
    for (let seed = 0; seed < 60; seed++) {
      const { ctx } = makeCtx(seed);
      const warrior = spawnInto(ctx, "skeleton-warrior");
      warrior.hp = Math.floor(warrior.maxHp * 0.3);
      const combat = startCombat("r1", [warrior.id], ctx, false);
      resolveRound(combat, ctx);
      if (combat.log.some((l) => l.text.includes("uses Guard Stance"))) guardCount++;
      if (combat.log.some((l) => l.text.includes(`${warrior.name} attacks`))) attackCount++;
    }
    expect(guardCount).toBeGreaterThan(attackCount);
    expect(attackCount).toBeGreaterThan(0);
  });

  test("a defensive archetype never reaches for a kit its normal weights do not name, below 40% HP", () => {
    // Skeleton Guard's skillIds hold its guard-room kit; the low-HP branch only takes a self skill the tier's weights name.
    const guard = getArchetype("skeleton-guard");
    expect(guard.skillIds.some((id) => getMonsterSkill(id).target === "self")).toBe(true);
    expect(Object.keys(guard.actionWeights!.normal!)).toEqual(["basicAttack"]);

    for (let seed = 0; seed < 30; seed++) {
      const { ctx } = makeCtx(seed);
      const monster = spawnInto(ctx, "skeleton-guard");
      monster.hp = Math.floor(monster.maxHp * 0.1);
      const combat = startCombat("r1", [monster.id], ctx, false);
      const hpBefore = monster.hp;
      resolveRound(combat, ctx);
      expect(monster.hp).toBe(hpBefore);
      const kitNames = guard.skillIds.map((id) => getMonsterSkill(id).name);
      expect(combat.log.some((l) => kitNames.some((name) => l.text.includes(name)))).toBe(false);
    }
  });

  test("a self-targeted monster skill rolled from the weighted pool heals the monster, never the party", () => {
    // Regeneration is at weight 0, but the rebalance editor can raise any existing key.
    const zombieArchetype = getArchetype("zombie");
    const originalWeights = { ...zombieArchetype.actionWeights!.normal };
    zombieArchetype.actionWeights!.normal = { basicAttack: 0, regeneration: 100 };
    try {
      const { ctx } = makeCtx();
      const zombie = spawnInto(ctx, "zombie");
      zombie.hp = Math.floor(zombie.maxHp * 0.5);
      for (const c of ctx.party) c.hp = Math.max(1, c.maxHp - 40);
      const partyHpBefore = ctx.party.map((c) => c.hp);
      const monsterHpBefore = zombie.hp;

      const combat = startCombat("r1", [zombie.id], ctx, false);
      resolveRound(combat, ctx);

      expect(combat.log.some((l) => l.text.includes("Regeneration"))).toBe(true);
      expect(zombie.hp).toBeGreaterThan(monsterHpBefore);
      expect(ctx.party.map((c) => c.hp)).toEqual(partyHpBefore);
    } finally {
      zombieArchetype.actionWeights!.normal = originalWeights;
    }
  });

  test("the low-HP self-skill branch only applies at normal tier", () => {
    const { ctx } = makeCtx();
    // Zombie never spawns as boss; flip the tier to prove the branch reads actor.tier.
    const zombieAsBoss = spawnMonster("zombie", 1);
    zombieAsBoss.tier = "boss";
    zombieAsBoss.hp = Math.floor(zombieAsBoss.maxHp * 0.1);
    ctx.monsters.push(zombieAsBoss);
    const combat = startCombat("r1", [zombieAsBoss.id], ctx, false);
    const hpBefore = zombieAsBoss.hp;
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("Regeneration"))).toBe(false);
    expect(zombieAsBoss.hp).toBe(hpBefore);
  });
});


describe("regular monster skills end-to-end", () => {
  function queueTrivialPartyActions(ctx: EngineContext, combat: ReturnType<typeof startCombat>) {
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
  }

  test("Slime's Acid Spit applies acid-burn and corroded together when it procs, never just one", () => {
    let found = false;
    for (let seed = 0; seed < 100; seed++) {
      const { ctx } = makeCtx(seed);
      const slime = spawnMonster("slime", 1);
      slime.maxHp = 500;
      slime.hp = 500;
      ctx.monsters.push(slime);
      const combat = startCombat("r1", [slime.id], ctx, false);
      queueTrivialPartyActions(ctx, combat);
      resolveRound(combat, ctx);
      if (!combat.log.some((l) => l.text.includes("Acid Spit"))) continue;
      for (const p of ctx.party) {
        const hasAcidBurn = p.activeStatusEffects.some((s) => s.statusEffectId === "acid-burn");
        const hasCorroded = p.activeStatusEffects.some((s) => s.statusEffectId === "corroded");
        expect(hasAcidBurn).toBe(hasCorroded);
        if (hasAcidBurn) found = true;
      }
    }
    expect(found).toBe(true);
  });

  test("Spider's Web Spit applies webbed when it procs", () => {
    let found = false;
    for (let seed = 0; seed < 100 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const spider = spawnMonster("spider", 1);
      spider.maxHp = 500;
      spider.hp = 500;
      ctx.monsters.push(spider);
      const combat = startCombat("r1", [spider.id], ctx, false);
      queueTrivialPartyActions(ctx, combat);
      resolveRound(combat, ctx);
      if (!combat.log.some((l) => l.text.includes("Web Spit"))) continue;
      const target = ctx.party.find((p) => p.activeStatusEffects.some((s) => s.statusEffectId === "webbed"));
      if (!target) continue;
      found = true;
    }
    expect(found).toBe(true);
  });

  test("Black Bat's Blood Drain damages the target and heals via lifesteal", () => {
    let found = false;
    for (let seed = 0; seed < 100 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const bat = spawnMonster("black-bat", 1);
      bat.maxHp = 500;
      bat.hp = 100;
      ctx.monsters.push(bat);
      const combat = startCombat("r1", [bat.id], ctx, false);
      queueTrivialPartyActions(ctx, combat);
      resolveRound(combat, ctx);
      const batLines = combat.log.filter((l) => l.text.startsWith(bat.name));
      if (!batLines.some((l) => l.text.includes("Blood Drain"))) continue;
      found = true;
      expect(batLines.some((l) => l.text.includes("recovers") && l.text.includes("HP"))).toBe(true);
    }
    expect(found).toBe(true);
  });
});



/** Each candidate's share of the `range` factor against an attack of `attackRange`. */
function rangeShares(attackRange: AttackRange, pool: (Character | Summon)[], rangeOf: (c: Character | Summon) => AttackRange = (c) => getClass((c as Character).classId).attackRange) {
  const { sameRange, otherRange } = BALANCE.targeting.rangeScores;
  const score = (c: Character | Summon) => (rangeOf(c) === attackRange ? sameRange : otherRange);
  const total = pool.reduce((sum, c) => sum + score(c), 0);
  return (c: Character | Summon) => score(c) / total;
}

describe("aiPattern targeting: each pattern mixes its factors by its profile weights", () => {
  const { lowHpRankScores, fearRankScores, profiles } = BALANCE.targeting;

  /** Counts which party member a monster's basic attack lands on, across many seeds. */
  function countTargets(archetypeId: string, setup: (ctx: EngineContext) => void = () => {}, seeds = 300): Map<string, number> {
    const hits = new Map<string, number>();
    for (let seed = 0; seed < seeds; seed++) {
      const { ctx } = makeCtx(seed);
      const monster = spawnInto(ctx, archetypeId);
      setup(ctx);
      const combat = startCombat("r1", [monster.id], ctx, false);
      resolveRound(combat, ctx);
      for (const c of ctx.party) {
        if (combat.log.some((l) => l.text.includes(`attacks ${c.name}`))) hits.set(c.classId, (hits.get(c.classId) ?? 0) + 1);
      }
    }
    return hits;
  }

  function chances(archetypeId: string, setup: (party: Character[]) => void = () => {}) {
    const { ctx } = makeCtx();
    const monster = spawnInto(ctx, archetypeId);
    setup(ctx.party);
    const weight = targetingWeight(monster, ctx.party);
    return { party: ctx.party, chance: (c: Character) => weight(c) };
  }

  test("every profile in the data sums to 1, so the chances over a pool sum to 1", () => {
    for (const pattern of Object.keys(profiles)) {
      const archetype = MONSTER_ARCHETYPES.find((m) => m.aiPattern === pattern);
      if (!archetype) continue;
      const { party, chance } = chances(archetype.id, (p) => {
        p[0]!.hp = 1;
        p[1]!.survival.fear = 50;
      });
      expect(party.reduce((sum, c) => sum + chance(c), 0)).toBeCloseTo(1, 9);
    }
  });

  test("at full HP and no fear, only aggro and range separate the party; the other factors spread evenly", () => {
    const archetype = getArchetype("skeleton");
    const weights = profiles[archetype.aiPattern]!;
    const { party, chance } = chances("skeleton");
    const totalAggro = party.reduce((sum, c) => sum + Math.max(1, c.aggro), 0);
    const range = rangeShares(archetype.attackRange, party);
    for (const c of party) {
      expect(chance(c)).toBeCloseTo(weights.aggro * (Math.max(1, c.aggro) / totalAggro) + weights.range * range(c) + (1 - weights.aggro - weights.range) / party.length, 9);
    }
  });

  test("lowHp ranks by HP share, lowest first; ties share a rank and the next rank follows without a gap", () => {
    const { party, chance } = chances("dungeon-rat", (p) => {
      for (const c of p) c.hp = c.maxHp;
      p[0]!.hp = Math.round(p[0]!.maxHp * 0.2);
      p[1]!.hp = Math.round(p[1]!.maxHp * 0.2);
      p[2]!.hp = Math.round(p[2]!.maxHp * 0.5);
    });
    const at = (rank: number) => lowHpRankScores[Math.min(rank, lowHpRankScores.length - 1)]!;
    const scores = party.map((_, i) => (i < 2 ? at(0) : i === 2 ? at(1) : at(2)));
    const total = scores.reduce((a, b) => a + b, 0);
    const w = profiles.opportunistic!;
    const range = rangeShares(getArchetype("dungeon-rat").attackRange, party);
    party.forEach((c, i) => expect(chance(c)).toBeCloseTo(w.lowHp * (scores[i]! / total) + w.range * range(c) + (1 - w.lowHp - w.range) / party.length, 9));
  });

  test("fear ranks highest first, and a summon counts as fearless", () => {
    const { ctx } = makeCtx();
    const ghost = spawnInto(ctx, "ghost");
    expect(ghost.aiPattern).toBe("dread");
    const [scared, uneasy] = [ctx.party[0]!, ctx.party[1]!];
    for (const c of [scared, uneasy]) c.hp = c.maxHp;
    scared.survival.fear = 60;
    uneasy.survival.fear = 30;
    const summon = { id: "summon-test", ownerId: uneasy.id, archetypeId: "goblin-thrower", name: "Summon", hp: 50, maxHp: 50, aggro: 10, activeStatusEffects: [] } as unknown as Summon;
    const pool = [scared, uneasy, summon];
    const weight = targetingWeight(ghost, pool);

    const w = profiles.dread!;
    const totalAggro = pool.reduce((sum, c) => sum + Math.max(1, c.aggro), 0);
    const fearScores = new Map<Character | Summon, number>([[scared, fearRankScores[0]!], [uneasy, fearRankScores[1]!], [summon, fearRankScores[2]!]]);
    const totalFear = [...fearScores.values()].reduce((a, b) => a + b, 0);
    const range = rangeShares(getArchetype(ghost.archetypeId).attackRange, pool, (c) => (c === summon ? "ranged" : getClass((c as Character).classId).attackRange));
    for (const c of pool) {
      const expected = w.aggro * (Math.max(1, c.aggro) / totalAggro) + (w.lowHp + w.damage) / pool.length + w.range * range(c) + w.fear * (fearScores.get(c)! / totalFear);
      expect(weight(c)).toBeCloseTo(expected, 9);
    }
  });

  test("an aggressive archetype hits the highest-aggro character more than the lowest", () => {
    expect(getArchetype("skeleton").aiPattern).toBe("aggressive");
    const hits = countTargets("skeleton");
    expect(hits.get("knight") ?? 0).toBeGreaterThan(hits.get("mage") ?? 0);
  });

  test("an opportunistic archetype ignores aggro: raising it changes nothing it does", () => {
    expect(getArchetype("dungeon-rat").aiPattern).toBe("opportunistic");
    const taunt = (ctx: EngineContext) => (ctx.party.find((c) => c.classId === "knight")!.aggro += 40);
    expect(countTargets("dungeon-rat", taunt)).toEqual(countTargets("dungeon-rat"));
    expect(countTargets("skeleton", taunt).get("knight")).toBeGreaterThan(countTargets("skeleton").get("knight")!);
  });

  test("an opportunistic archetype goes for the wounded, a dread archetype for the frightened", () => {
    const wounded = countTargets("dungeon-rat", (ctx) => (ctx.party.find((c) => c.classId === "knight")!.hp = 1));
    const baseline = countTargets("dungeon-rat");
    expect(wounded.get("knight")!).toBeGreaterThan(baseline.get("knight") ?? 0);

    const frightened = countTargets("ghost", (ctx) => (ctx.party.find((c) => c.classId === "mage")!.survival.fear = 50));
    expect(frightened.get("mage")!).toBeGreaterThan(countTargets("ghost").get("mage") ?? 0);
  });

  test("a single surviving character is still a valid target for every pattern", () => {
    for (const pattern of Object.keys(profiles)) {
      const archetype = MONSTER_ARCHETYPES.find((m) => m.aiPattern === pattern && m.roles.includes("normal"));
      if (!archetype) continue;
      const { ctx } = makeCtx();
      const monster = spawnInto(ctx, archetype.id);
      for (const c of ctx.party.slice(1)) c.isAlive = false;
      const survivor = ctx.party[0]!;
      expect(targetingWeight(monster, [survivor])(survivor)).toBeCloseTo(1, 9);
    }
  });

  /** The bearer's chance under a pull status, against the same party with no status on anyone. */
  function pulledChance(archetypeId: string, statusId: string) {
    const base = chances(archetypeId);
    const knightIndex = base.party.findIndex((c) => c.classId === "knight");
    const before = base.chance(base.party[knightIndex]!);
    const pulled = chances(archetypeId, (p) => p[knightIndex]!.activeStatusEffects.push({ statusEffectId: statusId, turnsRemaining: 2 }));
    return { before, after: pulled.chance(pulled.party[knightIndex]!), total: pulled.party.reduce((sum, c) => sum + pulled.chance(c), 0) };
  }

  test("a targetPull status hands its bearer that share of the pick before the profile splits the rest", () => {
    const pull = getStatusEffect("taunt").targetPull!;
    expect(pull).toBeGreaterThan(0);
    for (const archetypeId of ["skeleton", "dungeon-rat", "ghost"]) {
      const { before, after, total } = pulledChance(archetypeId, "taunt");
      expect(after).toBeCloseTo(pull + (1 - pull) * before, 9);
      expect(total).toBeCloseTo(1, 9);
    }
  });

  test("challenge pulls harder than taunt, an opportunistic archetype included", () => {
    expect(getArchetype("dungeon-rat").aiPattern).toBe("opportunistic");
    for (const archetypeId of ["skeleton", "dungeon-rat"]) {
      const taunt = pulledChance(archetypeId, "taunt");
      const challenge = pulledChance(archetypeId, "challenge");
      expect(taunt.after).toBeGreaterThan(taunt.before);
      expect(challenge.after).toBeGreaterThan(taunt.after);
    }
  });

  test("pulls summing past 1 are scaled down to share the whole pick in proportion", () => {
    const { party, chance } = chances("skeleton", (p) => {
      for (let i = 0; i < 3; i++) p[0]!.activeStatusEffects.push({ statusEffectId: "challenge", turnsRemaining: 2 });
      for (let i = 0; i < 2; i++) p[1]!.activeStatusEffects.push({ statusEffectId: "challenge", turnsRemaining: 2 });
    });
    expect(party.reduce((sum, c) => sum + chance(c), 0)).toBeCloseTo(1, 9);
    expect(chance(party[0]!)).toBeCloseTo(3 / 5, 9);
    expect(chance(party[1]!)).toBeCloseTo(2 / 5, 9);
    expect(chance(party[2]!)).toBe(0);
  });
});

describe("the range factor: a monster prefers targets that fight the way its attack does", () => {
  const { rangeScores, profiles } = BALANCE.targeting;

  test("a tactical monster scores a target sameRange when it fights like the attack and otherRange when not", () => {
    const { ctx } = makeCtx();
    const archer = spawnInto(ctx, "skeleton-archer");
    expect(archer.aiPattern).toBe("tactical");
    expect(getArchetype("skeleton-archer").attackRange).toBe("ranged");
    const pool = ctx.party;
    const weight = targetingWeight(archer, pool);
    const w = profiles.tactical!;
    const totalAggro = pool.reduce((sum, c) => sum + Math.max(1, c.aggro), 0);
    const totalRange = pool.reduce((sum, c) => sum + (getClass(c.classId).attackRange === "ranged" ? rangeScores.sameRange : rangeScores.otherRange), 0);
    for (const c of pool) {
      const score = getClass(c.classId).attackRange === "ranged" ? rangeScores.sameRange : rangeScores.otherRange;
      const expected = w.aggro * (Math.max(1, c.aggro) / totalAggro) + (w.lowHp + w.damage + w.fear) / pool.length + w.range * (score / totalRange);
      expect(weight(c)).toBeCloseTo(expected, 9);
    }
  });

  test("a melee attack favours melee targets and a ranged one ranged targets", () => {
    const { ctx } = makeCtx();
    const archer = spawnInto(ctx, "skeleton-archer");
    const knight = ctx.party.find((c) => c.classId === "knight")!;
    const mage = ctx.party.find((c) => c.classId === "mage")!;
    const ranged = targetingWeight(archer, [knight, mage], "ranged");
    const melee = targetingWeight(archer, [knight, mage], "melee");
    expect(ranged(mage)).toBeGreaterThan(ranged(knight));
    expect(melee(knight)).toBeGreaterThan(melee(mage));
  });

  test("a summon is scored by its own archetype's attackRange", () => {
    const { ctx } = makeCtx();
    const archer = spawnInto(ctx, "skeleton-archer");
    const summon = (archetypeId: string) => ({ id: archetypeId, ownerId: ctx.party[0]!.id, archetypeId, name: archetypeId, hp: 50, maxHp: 50, aggro: 10, activeStatusEffects: [] }) as unknown as Summon;
    const thrower = summon("goblin-thrower");
    const golem = summon("stone-golem");
    const weight = targetingWeight(archer, [thrower, golem]);
    expect(weight(thrower)).toBeGreaterThan(weight(golem));
  });

  test("a skill's own attackRange replaces the monster's; a skill without one follows the monster", () => {
    /** Share of the fixture skill's casts that land on a ranged class, across many seeds. */
    function rangedShare(skillOver: object): number {
      let ranged = 0;
      let total = 0;
      withFixture([sk("fx-reach", skillOver)], { aiPattern: "tactical", attackRange: "melee", actionWeights: { boss: { "fx-reach": 100 } } }, () => {
        for (let seed = 0; seed < 300; seed++) {
          const { ctx } = makeCtx(seed);
          const boss = spawnMonster("fixture-boss", 1, { tier: "boss" });
          ctx.monsters.push(boss);
          const combat = startCombat("r1", [boss.id], ctx, true);
          runMonsterTurn({ kind: "monster", id: boss.id }, combat, ctx);
          const line = combat.log.find((l) => l.text.includes("uses fx-reach on "));
          const target = line && ctx.party.find((c) => line.text.includes(`on ${c.name}`));
          if (!target) continue;
          total++;
          if (getClass(target.classId).attackRange === "ranged") ranged++;
        }
      });
      return ranged / total;
    }
    const followsMonster = rangedShare({});
    expect(rangedShare({ attackRange: "melee" })).toBeCloseTo(followsMonster, 1);
    expect(rangedShare({ attackRange: "ranged" })).toBeGreaterThan(followsMonster + 0.15);
  });

  test("an attackRange that is not melee or ranged is rejected on load", () => {
    const archetype = { ...getArchetype("skeleton"), id: "far-test", attackRange: "far" } as unknown as MonsterArchetype;
    expect(() => assertMonsterDataConsistent([archetype])).toThrow(/"far-test" needs an "attackRange"/);
    const skill = { ...getMonsterSkill("bone-throw"), attackRange: "far" } as unknown as (typeof MONSTER_SKILLS)[number];
    expect(() => assertMonsterKitConsistent(MONSTER_ARCHETYPES, MONSTER_SKILLS.map((s) => (s.id === skill.id ? skill : s)))).toThrow(/"bone-throw": attackRange must be/);
    const summon = { ...SUMMON_ARCHETYPES[0]!, attackRange: undefined } as unknown as (typeof SUMMON_ARCHETYPES)[number];
    expect(() => assertSummonDataConsistent([summon, ...SUMMON_ARCHETYPES.slice(1)], SUMMON_CASTS)).toThrow(/needs an "attackRange"/);
  });
});

describe("the damage factor: a monster remembers who hurt it", () => {
  const { damageRankScores, damageMemoryDecay, profiles } = BALANCE.targeting;

  function setup(archetypeId = "zombie") {
    const { ctx } = makeCtx();
    const monster = spawnInto(ctx, archetypeId);
    monster.maxHp = 100000;
    monster.hp = 100000;
    return { ctx, monster, party: ctx.party };
  }

  test("a direct hit credits its attacker with the HP it took off", () => {
    const { monster, party } = setup();
    const before = monster.hp;
    resolveSkillEffect({ kind: "damage", amount: 30 }, party[0]!, monster, { log: [] });
    expect(monster.damageTakenFrom?.[party[0]!.id]).toBe(before - monster.hp);
    resolveSkillEffect({ kind: "damage", amount: 30 }, party[0]!, monster, { log: [] });
    expect(monster.damageTakenFrom?.[party[0]!.id]).toBe(before - monster.hp);
  });

  test("a damage-over-time tick credits whoever applied the status", () => {
    const { monster, party } = setup();
    applyStatusEffectToActor(monster, "poisoned", 3, { log: [] }, undefined, undefined, undefined, undefined, undefined, party[1]!.id);
    const before = monster.hp;
    tickDotEffects(monster, { log: [] });
    expect(monster.hp).toBeLessThan(before);
    expect(monster.damageTakenFrom).toEqual({ [party[1]!.id]: before - monster.hp });
  });

  test("a character takes nothing from being hit, and a monster's hit on itself is not remembered", () => {
    const { monster, party } = setup();
    resolveSkillEffect({ kind: "damage", amount: 30 }, monster, party[0]!, { log: [] });
    resolveSkillEffect({ kind: "damage", amount: 30 }, monster, monster, { log: [] });
    expect((party[0] as unknown as { damageTakenFrom?: unknown }).damageTakenFrom).toBeUndefined();
    expect(monster.damageTakenFrom).toBeUndefined();
  });

  test("the end of every round multiplies what it remembers by damageMemoryDecay", () => {
    const { ctx, monster, party } = setup();
    monster.attack = 0;
    const combat = startCombat("r1", [monster.id], ctx, false);
    monster.damageTakenFrom = { [party[0]!.id]: 80 };
    resolveRound(combat, ctx);
    expect(monster.damageTakenFrom[party[0]!.id]).toBeCloseTo(80 * damageMemoryDecay, 9);
  });

  test("dealers rank by what they took off, most first; anyone who dealt nothing takes the last score", () => {
    const { monster, party } = setup();
    const pool = party.slice(0, 4);
    for (const c of pool) c.hp = c.maxHp;
    monster.damageTakenFrom = { [pool[0]!.id]: 10, [pool[1]!.id]: 40 };
    const weight = targetingWeight(monster, pool);
    const scores = [damageRankScores[1]!, damageRankScores[0]!, damageRankScores.at(-1)!, damageRankScores.at(-1)!];
    const total = scores.reduce((a, b) => a + b, 0);
    const w = profiles.defensive!;
    const totalAggro = pool.reduce((sum, c) => sum + Math.max(1, c.aggro), 0);
    const range = rangeShares(getArchetype(monster.archetypeId).attackRange, pool);
    pool.forEach((c, i) => {
      const expected = w.aggro * (Math.max(1, c.aggro) / totalAggro) + w.damage * (scores[i]! / total) + w.range * range(c) + (w.lowHp + w.fear) / pool.length;
      expect(weight(c)).toBeCloseTo(expected, 9);
    });
  });

  test("a defensive monster turns on whoever has been hurting it", () => {
    expect(getArchetype("zombie").aiPattern).toBe("defensive");
    function hitsOnMage(hurtByMage: boolean): number {
      let n = 0;
      for (let seed = 0; seed < 300; seed++) {
        const { ctx } = makeCtx(seed);
        const zombie = spawnInto(ctx, "zombie");
        const mage = ctx.party.find((c) => c.classId === "mage")!;
        if (hurtByMage) zombie.damageTakenFrom = { [mage.id]: 50 };
        const combat = startCombat("r1", [zombie.id], ctx, false);
        resolveRound(combat, ctx);
        if (combat.log.some((l) => l.text.includes(`attacks ${mage.name}`))) n++;
      }
      return n;
    }
    expect(hitsOnMage(true)).toBeGreaterThan(hitsOnMage(false));
  });
});

describe("targeting config validation", () => {
  const valid = (): TargetingConfig => structuredClone(BALANCE.targeting);

  test("the shipped config is valid", () => {
    expect(targetingConfigError(BALANCE.targeting)).toBeNull();
  });

  test("a profile whose weights do not sum to 1 is rejected", () => {
    const config = valid();
    config.profiles.aggressive!.aggro += 0.1;
    expect(targetingConfigError(config)).toMatch(/aggressive: weights must sum to 1/);
  });

  test("a negative weight, a missing factor, or an empty score list is rejected", () => {
    const negative = valid();
    negative.profiles.aggressive!.aggro = -0.1;
    negative.profiles.aggressive!.lowHp += 0.2;
    expect(targetingConfigError(negative)).toMatch(/>= 0/);

    const missing = valid();
    delete (missing.profiles.aggressive as Partial<Record<string, number>>).range;
    expect(targetingConfigError(missing)).toMatch(/must set exactly/);

    const empty = valid();
    empty.fearRankScores = [];
    expect(targetingConfigError(empty)).toMatch(/fearRankScores/);

    const decay = valid();
    decay.damageMemoryDecay = 1.5;
    expect(targetingConfigError(decay)).toMatch(/damageMemoryDecay/);

    const range = valid();
    range.rangeScores.otherRange = 0;
    expect(targetingConfigError(range)).toMatch(/rangeScores\.otherRange/);
  });

  test("an archetype whose aiPattern has no profile throws on load", () => {
    const stray = { ...getArchetype("skeleton"), id: "stray-pattern", aiPattern: "sneaky" } as MonsterArchetype;
    expect(() => assertMonsterDataConsistent([stray])).toThrow(/aiPattern "sneaky", which has no profile/);
  });
});


describe("monster AI rules, driven by fixture kits", () => {

  function bossFight(seed = 1) {
    const { ctx } = makeCtx(seed);
    const boss = spawnMonster("fixture-boss", 1, { tier: "boss" });
    boss.maxHp = 100000;
    boss.hp = 100000;
    ctx.monsters.push(boss);
    for (const c of ctx.party) {
      c.maxHp = 1e9;
      c.hp = 1e9;
    }
    const combat = startCombat("r1", [boss.id], ctx, true);
    const turn = () => runMonsterTurn({ kind: "monster", id: boss.id }, combat, ctx);
    const uses = (name: string) => combat.log.filter((l) => l.text.includes(`uses ${name}`)).length;
    return { ctx, boss, combat, turn, uses };
  }
  const kill = (c: { hp: number; isAlive: boolean }) => {
    c.hp = 0;
    c.isAlive = false;
  };
  const targetsOf = (text: string, skill: string) =>
    text
      .slice(text.indexOf(`uses ${skill} on `) + `uses ${skill} on `.length)
      .replace(/\.$/, "")
      .split(/, | and /);

  test("a skill's cooldown holds it back for exactly that many of the monster's own turns", () => {
    withFixture([sk("fx-a", { cooldownTurns: 2 })], { actionWeights: { boss: { "fx-a": 100 } } }, () => {
      const { boss, turn, uses } = bossFight();
      turn();
      expect(uses("fx-a")).toBe(1);
      expect(boss.skillCooldowns!["fx-a"]).toBe(1);
      turn();
      expect(uses("fx-a")).toBe(1);
      turn();
      expect(uses("fx-a")).toBe(2);
    });
  });

  test("initialCooldownTurns keeps a skill out of the opening turns", () => {
    withFixture([sk("fx-a", { initialCooldownTurns: 2 })], { actionWeights: { boss: { "fx-a": 100 } } }, () => {
      const { turn, uses } = bossFight();
      turn();
      turn();
      expect(uses("fx-a")).toBe(0);
      turn();
      expect(uses("fx-a")).toBe(1);
    });
  });

  test("usesPerCombat caps how often a skill fires", () => {
    withFixture([sk("fx-a", { usesPerCombat: 1 })], { actionWeights: { boss: { "fx-a": 100 } } }, () => {
      const { turn, uses } = bossFight();
      for (let i = 0; i < 10; i++) turn();
      expect(uses("fx-a")).toBe(1);
    });
  });

  test("aiCondition makes a skill a candidate only while it holds", () => {
    withFixture([sk("fx-a", { aiCondition: { selfHpBelowPercent: 50 } })], { actionWeights: { boss: { "fx-a": 100 } } }, () => {
      const { boss, turn, uses } = bossFight();
      for (let i = 0; i < 20; i++) turn();
      expect(uses("fx-a")).toBe(0);
      boss.hp = boss.maxHp * 0.4;
      turn();
      expect(uses("fx-a")).toBe(1);
    });
  });

  test("an aiRule that multiplies a weight to 0 removes the skill from the pick", () => {
    const rule = { if: { selfHpBelowPercent: 50 }, weightMultiplier: 0 };
    withFixture([sk("fx-a", { aiRules: [rule] })], { actionWeights: { boss: { basicAttack: 50, "fx-a": 50 } } }, () => {
      const { boss, turn, uses } = bossFight();
      boss.hp = boss.maxHp * 0.4;
      for (let i = 0; i < 30; i++) turn();
      expect(uses("fx-a")).toBe(0);
    });
  });

  test("targetRules steer a single-target skill toward the matching target", () => {
    const rule = { if: { targetHasStatusId: "bleeding" }, weightMultiplier: 1000 };
    withFixture([sk("fx-a", { targetRules: [rule] })], { actionWeights: { boss: { "fx-a": 100 } } }, () => {
      const { ctx, combat, turn } = bossFight();
      const marked = ctx.party[2]!;
      marked.activeStatusEffects.push({ statusEffectId: "bleeding", turnsRemaining: 99 });
      for (let i = 0; i < 20; i++) turn();
      const onMarked = combat.log.filter((l) => l.text.includes(`uses fx-a on ${marked.name}.`)).length;
      expect(onMarked).toBeGreaterThanOrEqual(18);
    });
  });

  test("a phase is entered once, casts its onEnterSkillId, and replaces the weights", () => {
    const phases = [{ tier: "boss", hpBelowPercent: 50, weights: { "fx-b": 1 }, onEnterSkillId: "fx-p" }];
    withFixture([sk("fx-a"), sk("fx-b"), sk("fx-p", { target: "self", effects: [{ kind: "applyStatusEffect", statusEffectId: "guard", durationTurns: 1 }] })], { phases, actionWeights: { boss: { "fx-a": 100 } } }, () => {
      const { boss, combat, turn, uses } = bossFight();
      turn();
      expect(uses("fx-a")).toBe(1);
      boss.hp = boss.maxHp * 0.4;
      turn();
      expect(combat.log.some((l) => l.text.includes("fights has changed"))).toBe(true);
      expect(uses("fx-p")).toBe(1);
      for (let i = 0; i < 5; i++) turn();
      expect(uses("fx-p")).toBe(1);
      expect(uses("fx-a")).toBe(1);
      expect(uses("fx-b")).toBe(5);
      expect(boss.enteredPhaseIndexes).toEqual([0]);
    });
  });

  test("targetCount hits that many distinct enemies, capped at the living count", () => {
    withFixture([sk("fx-m", { targetCount: { min: 3, max: 3 } })], { actionWeights: { boss: { "fx-m": 100 } } }, () => {
      const { ctx, combat, turn } = bossFight();
      turn();
      const first = combat.log.find((l) => l.text.includes("uses fx-m on"))!;
      const names = targetsOf(first.text, "fx-m");
      expect(names.length).toBe(3);
      expect(new Set(names).size).toBe(3);
      for (const c of ctx.party.slice(2)) kill(c);
      turn();
      const second = combat.log.filter((l) => l.text.includes("uses fx-m on")).at(-1)!;
      expect(targetsOf(second.text, "fx-m").length).toBe(2);
    });
  });

  test('targeting "random" ignores aggro', () => {
    withFixture([], { targeting: "random", skillIds: [], actionWeights: { boss: { basicAttack: 100 } } }, () => {
      const { ctx, combat, turn } = bossFight();
      const loud = ctx.party[0]!;
      loud.aggro = 10000;
      for (let i = 0; i < 200; i++) turn();
      const aimed = combat.log.filter((l) => l.text.includes(`attacks ${loud.name}.`) || l.text.includes(`on ${loud.name}.`) || l.text.includes(`attack on ${loud.name} out`));
      const all = combat.log.filter((l) => l.text.includes(" attacks ") || l.text.includes("misses its attack"));
      expect(all.length).toBeGreaterThan(100);
      expect(aimed.length / all.length).toBeLessThan(0.5);
    });
  });
});

describe("a monster's area skill that deals no damage", () => {
  test("logs as a plain use, not as a sweep across the party", () => {
    const cry = sk("fx-cry", { target: "allEnemies", effects: [{ kind: "modifyStat", stat: "fear", amount: 1 }] });
    withFixture([cry], { actionWeights: { boss: { "fx-cry": 100 } } }, () => {
      const { ctx } = makeCtx(1);
      const boss = spawnMonster("fixture-boss", 1, { tier: "boss" });
      ctx.monsters.push(boss);
      const combat = startCombat("r1", [boss.id], ctx, true);
      runMonsterTurn({ kind: "monster", id: boss.id }, combat, ctx);
      expect(combat.log.some((l) => l.text === `${boss.name} uses fx-cry.`)).toBe(true);
      expect(combat.log.some((l) => l.text.includes("sweeping the whole party"))).toBe(false);
    });
  });
});
