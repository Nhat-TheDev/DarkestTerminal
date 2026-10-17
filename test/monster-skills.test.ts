import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, resolveRound, livingCharacterRefs, type EngineContext } from "../src/engine/combat";
import { spawnMonster, getMonsterSkill, getArchetype, assertMonsterDataConsistent, MONSTER_ARCHETYPES } from "../src/data/monsters";
import { runMonsterTurn } from "../src/engine/monsterAI";
import type { MonsterArchetype } from "../src/types";
import { createFloor } from "../src/data/floor";
import { Rng } from "../src/engine/rng";
import { makeCtx, spawnInto, pickAnyAction, sk, withFixture } from "./helpers";

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

  test("a boss's telegraph charges one turn, then releases on its locked target", () => {
    const { ctx } = makeCtx();
    const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });
    boss.maxHp = 5000;
    boss.hp = 5000;
    ctx.monsters.push(boss);
    const combat = startCombat("r1", [boss.id], ctx, false);

    let charged = false;
    for (let round = 0; round < 20 && combat.phase !== "over" && !charged; round++) {
      queueTrivialActions(ctx, combat);
      resolveRound(combat, ctx);
      charged = boss.charging !== undefined;
    }
    expect(charged).toBe(true);
    expect(boss.charging!.skillId).toBe("overhead-cut");
    expect(combat.log.some((l) => l.text.includes("draws back for Overhead Cut"))).toBe(true);

    queueTrivialActions(ctx, combat);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("unleashes Overhead Cut"))).toBe(true);
    expect(boss.charging).toBeUndefined();
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
        // makeCtx's party has 1 character per class — their combined opening damage would otherwise
        // kill a low-HP monster like Dungeon Rat before it ever gets a turn to use its named skill,
        // which is what this test is actually checking for.
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

  test("the-founder carries its own kit and two phases, weighted for boss tier only", () => {
    const founder = getArchetype("the-founder");
    expect(founder.skillIds).toEqual(["paid-in-full", "the-same-price", "whats-left-listening", "everything-you-asked-for", "hung-lower", "the-last-of-it"]);
    expect(getMonsterSkill("everything-you-asked-for").telegraph).toBe(true);
    expect(getMonsterSkill("paid-in-full").targetCount).toEqual({ min: 2, max: 3 });
    expect(getMonsterSkill("the-same-price").target).toBe("allEnemies");
    expect(Object.keys(founder.actionWeights!.boss!).sort()).toEqual(["basicAttack", "everything-you-asked-for", "paid-in-full", "the-same-price", "whats-left-listening"]);
    expect(founder.phases!.map((p) => p.onEnterSkillId)).toEqual(["hung-lower", "the-last-of-it"]);
    // Never spawned at elite tier, so it deliberately has no elite weights and no elite sprite.
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
        // The telegraph charges/releases on its own cycle; hold it off so every boss turn
        // goes through the strike/cleave roll.
        monster.skillCooldowns = { "everything-you-asked-for": 99 };
        monster.charging = undefined;
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
    // Zombie and Skeleton Warrior keep their skill at weight 0 — it fires only from the low-HP
    // branch below, never from the weighted roll. The key stays so the rebalance editor can still
    // reach it: its PATCH endpoint only accepts keys the archetype already has.
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

    const typo = { id: "typo-test", roles: ["normal"], powerTier: "weak", minFloor: 0, skillIds: ["bite"], actionWeights: { normal: { basicAttack: 70, bight: 30 } } } as unknown as MonsterArchetype;
    expect(() => assertMonsterDataConsistent([typo])).toThrow(/actionWeights\.normal key "bight" is not in its skillIds/);

    const ghost = { id: "ghost-test", roles: ["normal"], powerTier: "weak", minFloor: 0, skillIds: ["no-such-skill"], actionWeights: { normal: { basicAttack: 100 } } } as unknown as MonsterArchetype;
    expect(() => assertMonsterDataConsistent([ghost])).toThrow(/Unknown monster skill: no-such-skill/);
  });

  // data/monsters.json reaches src/data/monsters.ts through an `as unknown as MonsterArchetype[]`
  // cast, so TypeScript never checks it — an archetype added without a description would ship
  // silently. The digit check enforces 02-monster.md's rule that this field carries no numbers:
  // it is flavor a player reads, not a place to write down a balance fact.
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
    // Skeleton Guard is defensive and spawns at normal tier in ordinary combat rooms, while its
    // skillIds hold its guard-room kit — self-targeted guard skills included. The low-HP branch
    // only considers a self skill the tier's own weights name, so the normal tier never reaches them.
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
    // Regeneration sits at weight 0 today, but the rebalance editor exists to change exactly that:
    // its PATCH endpoint allows any key already present, and "regeneration" is present at 0. Before
    // this was fixed, raising it made the Zombie heal a party member instead of itself.
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
    // Zombie is normal-only so it can never spawn as boss; flip the tier after spawn
    // to verify the branch itself is gated on actor.tier, not on the archetype.
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



describe("aiPattern targeting: aggressive follows aggro, opportunistic mirrors it", () => {
  /** Counts which party member a monster's basic attack lands on, across many seeds. */
  function countTargets(archetypeId: string, seeds = 300): Map<string, number> {
    const hits = new Map<string, number>();
    for (let seed = 0; seed < seeds; seed++) {
      const { ctx } = makeCtx(seed);
      const monster = spawnInto(ctx, archetypeId);
      const combat = startCombat("r1", [monster.id], ctx, false);
      resolveRound(combat, ctx);
      for (const c of ctx.party) {
        if (combat.log.some((l) => l.text.includes(`attacks ${c.name}`))) {
          hits.set(c.classId, (hits.get(c.classId) ?? 0) + 1);
        }
      }
    }
    return hits;
  }

  // Knight has the highest baseAggro in the party, Mage and Plague Doctor the lowest.
  test("an aggressive archetype hits the highest-aggro character more than the lowest", () => {
    const hits = countTargets("skeleton");
    expect(getArchetype("skeleton").aiPattern).toBe("aggressive");
    expect(hits.get("knight") ?? 0).toBeGreaterThan(hits.get("mage") ?? 0);
  });

  test("an opportunistic archetype reverses that — the lowest-aggro character is hit more", () => {
    const hits = countTargets("skeleton-archer");
    expect(getArchetype("skeleton-archer").aiPattern).toBe("opportunistic");
    expect(hits.get("mage") ?? 0).toBeGreaterThan(hits.get("knight") ?? 0);
  });

  test("taunting pulls attacks toward the Knight for aggressive, and away from it for opportunistic", () => {
    function hitsOnKnightWithTaunt(archetypeId: string): number {
      let n = 0;
      for (let seed = 0; seed < 300; seed++) {
        const { ctx } = makeCtx(seed);
        const monster = spawnInto(ctx, archetypeId);
        const knight = ctx.party.find((c) => c.classId === "knight")!;
        knight.aggro += 40; // what the taunt status is worth
        const combat = startCombat("r1", [monster.id], ctx, false);
        resolveRound(combat, ctx);
        if (combat.log.some((l) => l.text.includes(`attacks ${knight.name}`))) n++;
      }
      return n;
    }
    // This is the deliberate trade-off of the mirrored rule, not an accident: against an
    // opportunistic archetype, taunting makes the Knight *safer* and the rest of the party
    // more exposed.
    expect(hitsOnKnightWithTaunt("skeleton")).toBeGreaterThan(hitsOnKnightWithTaunt("skeleton-archer"));
  });

  test("a single surviving character is still a valid target for both patterns", () => {
    for (const id of ["skeleton", "skeleton-archer"]) {
      const { ctx } = makeCtx();
      const monster = spawnInto(ctx, id);
      for (const c of ctx.party.slice(1)) c.isAlive = false;
      const survivor = ctx.party[0]!;
      const combat = startCombat("r1", [monster.id], ctx, false);
      resolveRound(combat, ctx);
      expect(combat.log.some((l) => l.text.includes(survivor.name))).toBe(true);
    }
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

  test("a telegraph charges without dealing damage, then releases on the locked target", () => {
    withFixture([sk("fx-t", { telegraph: true, cooldownTurns: 4, effects: [{ kind: "damage", amount: 50 }] })], { actionWeights: { boss: { "fx-t": 100 } } }, () => {
      const { ctx, boss, combat, turn } = bossFight();
      const hp = () => ctx.party.map((c) => c.hp);
      const before = hp();
      turn();
      expect(combat.log.some((l) => l.text.includes("draws back for fx-t"))).toBe(true);
      expect(hp()).toEqual(before);
      expect(boss.charging!.skillId).toBe("fx-t");
      expect(boss.charging!.targetIds.length).toBe(1);
      expect(boss.skillCooldowns!["fx-t"]).toBe(3);
      const lockedId = boss.charging!.targetIds[0]!;
      turn();
      expect(combat.log.some((l) => l.text.includes("unleashes fx-t"))).toBe(true);
      expect(boss.charging).toBeUndefined();
      const changed = ctx.party.filter((c, i) => c.hp !== before[i]);
      expect(changed.map((c) => c.id)).toEqual([lockedId]);
    });
  });

  test("a telegraph whose locked target died re-picks a living one", () => {
    withFixture([sk("fx-t", { telegraph: true, cooldownTurns: 4 })], { actionWeights: { boss: { "fx-t": 100 } } }, () => {
      const { ctx, boss, combat, turn } = bossFight();
      turn();
      const locked = ctx.party.find((c) => c.id === boss.charging!.targetIds[0])!;
      kill(locked);
      turn();
      expect(boss.charging).toBeUndefined();
      expect(combat.log.some((l) => l.text.includes("unleashes fx-t"))).toBe(true);
    });
  });

  test("a stun delays a charged release instead of cancelling it", () => {
    withFixture([sk("fx-t", { telegraph: true, cooldownTurns: 6 })], { actionWeights: { boss: { "fx-t": 100 } } }, () => {
      const { boss, combat, turn } = bossFight();
      turn();
      boss.activeStatusEffects.push({ statusEffectId: "stunned", turnsRemaining: 1 });
      turn();
      expect(combat.log.some((l) => l.text.includes("is stunned"))).toBe(true);
      expect(boss.charging).toBeDefined();
      expect(combat.log.some((l) => l.text.includes("unleashes fx-t"))).toBe(false);
      boss.activeStatusEffects = [];
      turn();
      expect(boss.charging).toBeUndefined();
      expect(combat.log.some((l) => l.text.includes("unleashes fx-t"))).toBe(true);
    });
  });

  test("chargeEffects resolve on the caster during the charge turn", () => {
    const charge = [{ kind: "applyStatusEffect", statusEffectId: "guard", durationTurns: 1 }];
    withFixture([sk("fx-t", { telegraph: true, cooldownTurns: 4, chargeEffects: charge })], { actionWeights: { boss: { "fx-t": 100 } } }, () => {
      const { boss, turn } = bossFight();
      turn();
      expect(boss.activeStatusEffects.some((s) => s.statusEffectId === "guard")).toBe(true);
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
