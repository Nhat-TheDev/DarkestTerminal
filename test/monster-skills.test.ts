import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, resolveRound, livingCharacterRefs, type EngineContext } from "../src/engine/combat";
import { spawnMonster, getMonsterSkill, getArchetype, assertMonsterDataConsistent, MONSTER_ARCHETYPES } from "../src/data/monsters";
import type { MonsterArchetype } from "../src/types";
import { createFloor } from "../src/data/floor";
import { Rng } from "../src/engine/rng";
import { makeCtx, spawnInto, pickAnyAction } from "./helpers";

describe("elite/boss skill kit", () => {
  function queueTrivialActions(ctx: EngineContext, combat: ReturnType<typeof startCombat>) {
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
  }

  test("elite/boss pick from a weighted action pool; skill kit and basic attack are both reachable", () => {

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
        if (monsterLines.some((l) => l.text.includes("Cleaving Strike") || l.text.includes("Sweeping Cleave") || l.text.includes("finishing blow") || l.text.includes("Crush"))) {
          sawNamedKit = true;
        }
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
    expect(monsterLines.some((l) => l.text.includes("Cleaving Strike") || l.text.includes("Sweeping Cleave"))).toBe(false);
  });

  test("boss telegraphs Finishing Blow 1 turn ahead, then releases a flat hit", () => {
    const { ctx } = makeCtx();
    const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });

    boss.maxHp = 1000;
    boss.hp = 1000;
    ctx.monsters.push(boss);
    const combat = startCombat("r1", [boss.id], ctx, false);

    let charged = false;
    for (let round = 0; round < 10 && combat.phase !== "over" && !charged; round++) {
      queueTrivialActions(ctx, combat);
      resolveRound(combat, ctx);
      charged = combat.log.some((l) => l.text.includes("begins charging"));
    }
    expect(charged).toBe(true);
    expect(boss.isChargingExecute).toBe(true);
    const markedTarget = ctx.party.find((p) => p.id === boss.executeTargetId);
    expect(markedTarget).toBeDefined();
    markedTarget!.hp = markedTarget!.maxHp;

    const hpBefore = markedTarget!.hp;
    queueTrivialActions(ctx, combat);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("unleashes its charged finishing blow") && l.text.includes(markedTarget!.name))).toBe(true);

    const damageDealt = Math.max(0, hpBefore - markedTarget!.hp);
    expect(damageDealt).toBeGreaterThan(markedTarget!.maxHp * 0.5);
    expect(boss.isChargingExecute).toBe(false);
    expect(boss.executeCooldownTurns).toBeGreaterThan(0);
  });

  test("elite cleave damages every living character when it fires", () => {
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const elite = spawnMonster("skeleton-guard", 1, { tier: "elite" });
      ctx.monsters.push(elite);
      const combat = startCombat("r1", [elite.id], ctx, false);
      queueTrivialActions(ctx, combat);
      const hpBefore = new Map(ctx.party.filter((c) => c.isAlive).map((c) => [c.id, c.hp]));
      resolveRound(combat, ctx);
      if (!combat.log.some((l) => l.text.includes("Sweeping Cleave"))) continue;
      found = true;
      const hitCount = [...hpBefore.entries()].filter(([id, hp]) => {
        const c = ctx.party.find((p) => p.id === id)!;
        return c.hp < hp;
      }).length;
      expect(hitCount).toBe(hpBefore.size);
    }
    expect(found).toBe(true);
  });

  test("boss debuff (Crush) applies weakened, weakening the target's defense", () => {
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });
      ctx.monsters.push(boss);
      const combat = startCombat("r1", [boss.id], ctx, false);
      queueTrivialActions(ctx, combat);
      resolveRound(combat, ctx);
      if (!combat.log.some((l) => l.text.includes("Crush"))) continue;
      found = true;
      const debuffed = ctx.party.find((c) => c.activeStatusEffects.some((s) => s.statusEffectId === "weakened"));
      expect(debuffed).toBeDefined();
    }
    expect(found).toBe(true);
  });

  test("every monster skill log line derives from the skill's own target, not from which weight key rolled it", () => {
    // Single-target skills all name their target now, whatever tier or weight key produced them —
    // a plain monster's skill and a boss's debuff used to print without one.
    const lines: string[] = [];
    for (let seed = 0; seed < 40; seed++) {
      for (const [id, tier] of [["dungeon-rat", "normal"], ["skeleton-guard", "boss"]] as const) {
        const { ctx } = makeCtx(seed);
        const monster = spawnMonster(id, 1, tier === "normal" ? undefined : { tier });
        monster.executeCooldownTurns = 99;
        ctx.monsters.push(monster);
        const combat = startCombat("r1", [monster.id], ctx, false);
        queueTrivialActions(ctx, combat);
        resolveRound(combat, ctx);
        lines.push(...combat.log.map((l) => l.text));
      }
    }
    const bite = lines.find((l) => l.includes("uses Bite"));
    const crush = lines.find((l) => l.includes("uses Crush"));
    const cleave = lines.find((l) => l.includes("Sweeping Cleave"));
    expect(bite).toMatch(/^Dungeon Rat uses Bite on .+\.$/);
    expect(crush).toMatch(/^Skeleton Guard \(Boss\) uses Crush on .+\.$/);
    expect(cleave).toBe("Skeleton Guard (Boss) uses Sweeping Cleave, sweeping the whole party!");
  });

  test("the-founder carries the full strike/cleave/execute/debuff kit, weighted for boss tier only", () => {
    const founder = getArchetype("the-founder");
    expect(founder.skillIds).toEqual(["elite-strike-the-founder", "elite-cleave-the-founder", "boss-debuff-the-founder"]);
    expect(founder.executeSkillId).toBe("boss-execute-the-founder");
    expect(getMonsterSkill("elite-strike-the-founder").target).toBe("singleEnemy");
    expect(getMonsterSkill("elite-cleave-the-founder").target).toBe("allEnemies");
    expect(founder.actionWeights?.boss).toEqual({
      basicAttack: 30,
      "elite-strike-the-founder": 20,
      "elite-cleave-the-founder": 15,
      "boss-debuff-the-founder": 35,
    });
    // Never spawned at elite tier, so it deliberately has no elite weights and no elite sprite.
    expect(founder.actionWeights?.elite).toBeUndefined();
  });

  test("the-founder actually reaches its strike and cleave in combat", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 80 && seen.size < 2; seed++) {
      const { ctx } = makeCtx(seed);
      const monster = spawnMonster("the-founder", 1, { tier: "boss" });
      ctx.monsters.push(monster);
      const combat = startCombat("r1", [monster.id], ctx, false);
      for (let round = 0; round < 6 && seen.size < 2; round++) {
        // Execute charges/releases on its own cycle and bypasses the weighted pool entirely;
        // hold it off so every boss turn goes through pickMonsterAction().
        monster.executeCooldownTurns = 99;
        monster.isChargingExecute = false;
        queueTrivialActions(ctx, combat);
        resolveRound(combat, ctx);
        if (combat.log.some((l) => l.text.includes("Paid In Full"))) seen.add("strike");
        if (combat.log.some((l) => l.text.includes("The Same Price"))) seen.add("cleave");
      }
    }
    expect(seen).toEqual(new Set(["strike", "cleave"]));
  });

  test("the-founder is scriptedOnly — it never appears in a rolled boss room", () => {
    expect(getArchetype("the-founder").scriptedOnly).toBe(true);
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
    expect(getMonsterSkill("blood-drain").effects).toEqual([{ kind: "damage", amount: 2, lifestealPercent: 50 }]);
  });

  test("Zombie's Regeneration is a self-heal", () => {
    const skill = getMonsterSkill("regeneration");
    expect(skill.target).toBe("self");
    expect(skill.effects).toEqual([{ kind: "heal", amount: 15 }]);
  });

  test("Slime's Acid Spit procs acid-burn and corroded together, Spider's Web Spit procs webbed", () => {
    expect(getMonsterSkill("acid-spit").effects).toEqual([
      { kind: "damage", amount: 2 },
      { kind: "applyStatusEffect", statusEffectId: "acid-burn", alsoApplyStatusEffectIds: ["corroded"], chance: 0.5 },
    ]);
    expect(getMonsterSkill("web-spit").effects).toEqual([
      { kind: "damage", amount: 2 },
      { kind: "applyStatusEffect", statusEffectId: "webbed", chance: 0.5 },
    ]);
  });

  test("Skeleton Warrior's Guard Stance applies the shared guard status", () => {
    const skill = getMonsterSkill("guard-stance");
    expect(skill.target).toBe("self");
    expect(skill.effects).toEqual([{ kind: "applyStatusEffect", statusEffectId: "guard" }]);
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
    expect(guard.skillIds).toEqual(["elite-strike-skeleton-guard", "elite-cleave-skeleton-guard", "boss-debuff-skeleton-guard"]);
    expect(guard.executeSkillId).toBe("boss-execute-skeleton-guard");
  });

  test("every action-weight key names a skill the archetype declares, and a stray key throws on load", () => {
    assertMonsterDataConsistent(MONSTER_ARCHETYPES); // the shipped catalog

    const typo = { id: "typo-test", skillIds: ["bite"], actionWeights: { normal: { basicAttack: 70, bight: 30 } } } as unknown as MonsterArchetype;
    expect(() => assertMonsterDataConsistent([typo])).toThrow(/actionWeights\.normal key "bight" is not in its skillIds/);

    const ghost = { id: "ghost-test", skillIds: ["no-such-skill"], actionWeights: {} } as unknown as MonsterArchetype;
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

  test("a defensive archetype whose only skills target enemies never turns one on itself below 40% HP", () => {
    // Skeleton Guard is defensive, spawns at normal tier in ordinary combat rooms, and since
    // skillIds became "every skill at any tier" its first entry is Cleaving Strike. Picking by
    // position instead of by target would have it hitting itself.
    const guard = getArchetype("skeleton-guard");
    expect(guard.skillIds.length).toBeGreaterThan(0);
    expect(guard.skillIds.some((id) => getMonsterSkill(id).target === "self")).toBe(false);

    for (let seed = 0; seed < 30; seed++) {
      const { ctx } = makeCtx(seed);
      const monster = spawnInto(ctx, "skeleton-guard");
      monster.hp = Math.floor(monster.maxHp * 0.1);
      const combat = startCombat("r1", [monster.id], ctx, false);
      const hpBefore = monster.hp;
      resolveRound(combat, ctx);
      expect(monster.hp).toBe(hpBefore);
      expect(combat.log.some((l) => l.text.includes("Cleaving Strike") || l.text.includes("Sweeping Cleave"))).toBe(false);
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
    const zombieAsBoss = spawnMonster("zombie", 1, { tier: "boss" });
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

  // Vanguard has the highest baseAggro in the party, Mage and Plague Doctor the lowest.
  test("an aggressive archetype hits the highest-aggro character more than the lowest", () => {
    const hits = countTargets("skeleton");
    expect(getArchetype("skeleton").aiPattern).toBe("aggressive");
    expect(hits.get("vanguard") ?? 0).toBeGreaterThan(hits.get("mage") ?? 0);
  });

  test("an opportunistic archetype reverses that — the lowest-aggro character is hit more", () => {
    const hits = countTargets("skeleton-archer");
    expect(getArchetype("skeleton-archer").aiPattern).toBe("opportunistic");
    expect(hits.get("mage") ?? 0).toBeGreaterThan(hits.get("vanguard") ?? 0);
  });

  test("taunting pulls attacks toward the Vanguard for aggressive, and away from it for opportunistic", () => {
    function hitsOnVanguardWithTaunt(archetypeId: string): number {
      let n = 0;
      for (let seed = 0; seed < 300; seed++) {
        const { ctx } = makeCtx(seed);
        const monster = spawnInto(ctx, archetypeId);
        const vanguard = ctx.party.find((c) => c.classId === "vanguard")!;
        vanguard.aggro += 40; // what Shield Guard's taunt status is worth
        const combat = startCombat("r1", [monster.id], ctx, false);
        resolveRound(combat, ctx);
        if (combat.log.some((l) => l.text.includes(`attacks ${vanguard.name}`))) n++;
      }
      return n;
    }
    // This is the deliberate trade-off of the mirrored rule, not an accident: against an
    // opportunistic archetype, taunting makes the Vanguard *safer* and the rest of the party
    // more exposed.
    expect(hitsOnVanguardWithTaunt("skeleton")).toBeGreaterThan(hitsOnVanguardWithTaunt("skeleton-archer"));
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
