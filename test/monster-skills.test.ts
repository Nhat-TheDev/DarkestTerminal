import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, resolveRound, livingCharacterRefs, type EngineContext } from "../src/engine/combat";
import { spawnMonster, getMonsterSkill, getArchetype } from "../src/data/monsters";
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
    expect(founder.eliteSkillIds).toEqual({ strike: "elite-strike-the-founder", cleave: "elite-cleave-the-founder" });
    expect(founder.bossSkillIds).toEqual({ execute: "boss-execute-the-founder", debuff: "boss-debuff-the-founder" });
    expect(getMonsterSkill("elite-strike-the-founder").target).toBe("singleEnemy");
    expect(getMonsterSkill("elite-cleave-the-founder").target).toBe("allEnemies");
    expect(founder.actionWeights?.boss).toEqual({ basicAttack: 30, strike: 20, cleave: 15, debuff: 35 });
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
      expect(a.actionWeights?.normal).toEqual({ basicAttack: 70, skill: 30 });
    }
    for (const id of ["zombie", "skeleton-warrior"]) {
      const a = getArchetype(id);
      expect(a.skillIds.length).toBe(1);
      expect(a.actionWeights?.normal).toEqual({ basicAttack: 100, skill: 0 });
    }
  });

  test("Skeleton Guard is untouched — no normal-tier skill, elite/boss kit intact", () => {
    const guard = getArchetype("skeleton-guard");
    expect(guard.skillIds).toEqual([]);
    expect(guard.actionWeights?.normal).toEqual({ basicAttack: 100, skill: 0 });
    expect(guard.eliteSkillIds).toEqual({ strike: "elite-strike-skeleton-guard", cleave: "elite-cleave-skeleton-guard" });
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

  test("other defensive archetypes with empty skillIds are unaffected below 40% HP", () => {
    const { ctx } = makeCtx();
    const knight = spawnInto(ctx, "zombie-knight");
    knight.hp = Math.floor(knight.maxHp * 0.1);
    const combat = startCombat("r1", [knight.id], ctx, false);
    const hpBefore = knight.hp;
    resolveRound(combat, ctx);
    expect(getArchetype("zombie-knight").skillIds).toEqual([]);
    expect(knight.hp).toBe(hpBefore);
  });

  test("a self-targeted monster skill rolled from the weighted pool heals the monster, never the party", () => {
    // Regeneration sits at weight 0 today, but the rebalance editor exists to change exactly that:
    // its PATCH endpoint allows any key already present, and "skill" is present at 0. Before this
    // was fixed, raising it made the Zombie heal a party member instead of itself.
    const zombieArchetype = getArchetype("zombie");
    const originalWeights = { ...zombieArchetype.actionWeights!.normal };
    zombieArchetype.actionWeights!.normal = { basicAttack: 0, skill: 100 };
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

