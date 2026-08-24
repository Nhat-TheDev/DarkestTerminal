import { describe, test, expect, afterAll } from "bun:test";
import { CLASSES, getClass, getSkill, getEffectiveSkill } from "../src/data/classes";
import { STATUS_EFFECTS, getStatusEffect } from "../src/data/statusEffects";
import { createFloor } from "../src/data/floor";
import { createCharacter } from "../src/engine/party";
import { Rng } from "../src/engine/rng";
import {
  getActorByRef,
  startCombat,
  queueAction,
  queueItemAction,
  checkItemUsable,
  allLivingCharactersHaveQueuedActions,
  resolveRound,
  autoResolveTargets,
  livingMonsterRefs,
  livingCharacterRefs,
  isCombatOver,
  type EngineContext,
} from "../src/engine/combat";
import {
  resolveSkillEffect,
  getFearTier,
  rollLosesControl,
  isActorAlive,
  tickStatusEffects,
  mitigatedOffense,
  rollHits,
  getFearAccuracyPenalty,
  isHelpfulStatusEffect,
} from "../src/engine/resolver";
import type { LogEntry, SkillDefinition } from "../src/types";
import { connectedRooms, getRoom, moveToRoom } from "../src/engine/dungeon";
import { spawnMonster, getMonsterSkill, getArchetype } from "../src/data/monsters";
import { rollItemDrop, getItem, ITEMS } from "../src/data/items";
import { rollArtifactRarity, rollArtifactWithMinRarity, rollArtifactOrCursed, getArtifact } from "../src/data/artifacts";
import { rollEvent, getEvent, EVENTS } from "../src/data/events";
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
  curseAggroBoostSum,
} from "../src/engine/artifacts";
import { fearGainForRound, applyRoundFear, applyVictoryFearRelief, tickSurvivalOnAction } from "../src/engine/survival";
import { Game } from "../src/engine/game";
import type { Character, CombatantRef } from "../src/types";

// Several tests below push mock entries onto STATUS_EFFECTS/CLASSES[0].skills to exercise new mechanics.
// Bun shares module state across test files within one run, so truncate back to the original length once
// this file's tests are done to avoid leaking mock entries into other test files' assertions.
const initialStatusEffectsCount = STATUS_EFFECTS.length;
const initialVanguardSkillsCount = CLASSES[0]!.skills.length;
afterAll(() => {
  STATUS_EFFECTS.length = initialStatusEffectsCount;
  CLASSES[0]!.skills.length = initialVanguardSkillsCount;
});

function makeCtx(seed = 1) {
  const rng = new Rng(seed);
  const { floor, monsters } = createFloor(rng);
  const party = CLASSES.map((cls, i) => createCharacter(`p${i + 1}`, cls.name, cls));
  const ctx: EngineContext = { party, monsters, rng, inventory: {} };
  return { ctx, floor, monsters, party };
}

function spawnInto(ctx: EngineContext, archetypeId: string, depth = 1) {
  const m = spawnMonster(archetypeId, depth);
  ctx.monsters.push(m);
  return m;
}

function pickAnyAction(
  ctx: EngineContext,
  combat: ReturnType<typeof startCombat>,
  ref: CombatantRef
): { skillId: string; targets: CombatantRef[] } {
  const actor = getActorByRef(ref, ctx) as Character;
  const attackSkill = actor.unlockedSkillIds.map(getSkill).find((s) => s.target === "singleEnemy");
  if (attackSkill) {
    const enemy = livingMonsterRefs(combat, ctx)[0]!;
    return { skillId: attackSkill.id, targets: [enemy] };
  }
  const skill = actor.unlockedSkillIds.map(getSkill)[0]!;
  const targets = autoResolveTargets(skill.target, ref, combat, ctx) ?? [ref];
  return { skillId: skill.id, targets };
}

describe("floor layout (random pattern pick — see test/floorPatterns.test.ts for per-pattern structural rules)", () => {
  test("every room is reachable from the entry room, across many random seeds", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { floor } = createFloor(new Rng(seed));
      const visited = new Set<string>([floor.entryRoomId]);
      const queue = [floor.entryRoomId];
      while (queue.length > 0) {
        const id = queue.shift()!;
        for (const next of connectedRooms(floor, id)) {
          if (!visited.has(next.id)) {
            visited.add(next.id);
            queue.push(next.id);
          }
        }
      }
      expect(visited.size).toBe(floor.rooms.length);
    }
  });

  test("exactly 1 boss room, and its monster is flagged elite/boss (guard tier)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { floor, monsters } = createFloor(new Rng(seed));
      const bossRooms = floor.rooms.filter((r) => r.type === "boss");
      expect(bossRooms).toHaveLength(1);
      const guardMonsters = bossRooms[0]!.monsterIds.map((id) => monsters.find((m) => m.id === id)!);
      expect(guardMonsters.every((m) => m.tier !== "normal")).toBe(true);
    }
  });

  test("every combat room has at least 1 monster, rest/boss rooms don't double up", () => {
    const { floor, monsters } = createFloor(new Rng(3));
    for (const room of floor.rooms) {
      if (room.type === "combat") expect(room.monsterIds.length).toBeGreaterThan(0);
      if (room.type === "rest") expect(room.monsterIds).toHaveLength(0);
    }
    expect(monsters.length).toBeGreaterThan(0);
  });
});

describe("character creation", () => {
  test("level-1 character only has slot 0-2 skills unlocked (basic attack + 2 own skills)", () => {
    const cls = getClass("vanguard");
    const c = createCharacter("c1", "Test", cls);
    expect(c.unlockedSkillIds).toEqual(["vanguard-slash", "vanguard-shield-guard", "vanguard-shield-throw"]);
    expect(c.hp).toBe(cls.baseMaxHp);
    expect(c.survival).toEqual({ hunger: 100, thirst: 100, fear: 0 });
  });
});

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

  test("modifyCombatStat status effect installs immediately and undoes on expiry (guard is now a 1-turn buff)", () => {
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

describe("aggro-weighted targeting", () => {
  test("weightedPick favors higher-weight items over many draws", () => {
    const rng = new Rng(42);
    const items = [
      { name: "low", weight: 1 },
      { name: "high", weight: 99 },
    ];
    let highCount = 0;
    for (let i = 0; i < 1000; i++) {
      const picked = rng.weightedPick(items, (x) => x.weight);
      if (picked.name === "high") highCount++;
    }
    expect(highCount).toBeGreaterThan(900);
  });
});

describe("combat round structure", () => {
  test("higher speed acts before lower speed in the resolution phase", () => {
    const { ctx } = makeCtx();

    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      const err = queueAction(combat, ref, skillId, targets, ctx);
      expect(err).toBeNull();
    }
    resolveRound(combat, ctx);
    const rogueLine = combat.log.findIndex((l) => l.text.includes("Rogue") && l.text.includes("uses"));
    const vanguardLine = combat.log.findIndex((l) => l.text.includes("Vanguard") && l.text.includes("uses"));
    expect(rogueLine).toBeGreaterThanOrEqual(0);
    expect(vanguardLine).toBeGreaterThanOrEqual(0);
    expect(rogueLine).toBeLessThan(vanguardLine);
  });

  test("isBuff skills get +20 speed for this round's turn order only, not a persistent stat change (§4.7)", () => {
    const { ctx } = makeCtx();
    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === vanguard.id) continue;
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    const vanguardLine = combat.log.findIndex((l) => l.text.includes("Vanguard") && l.text.includes("uses"));
    const rogueLine = combat.log.findIndex((l) => l.text.includes("Rogue") && l.text.includes("uses"));
    expect(vanguardLine).toBeGreaterThanOrEqual(0);
    expect(rogueLine).toBeGreaterThanOrEqual(0);
    expect(vanguardLine).toBeLessThan(rogueLine);
    expect(vanguard.speed).toBe(8);
  });

  test("MP is deducted at queue time, not at resolution", () => {
    const { ctx } = makeCtx();
    const combat = startCombat("r1", [ctx.monsters[0]!.id], ctx, false);
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    const mpBefore = mage.mp;
    const enemy = livingMonsterRefs(combat, ctx)[0]!;
    queueAction(combat, { kind: "character", id: mage.id }, "mage-fireball", [enemy], ctx);
    expect(mage.mp).toBe(mpBefore - 5);
  });

  test("cooldownTurns is set at queue time and blocks re-queueing the same skill until it expires", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.mp = 999;
    const combat = startCombat("r1", [ctx.monsters[0]!.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    const err1 = queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    expect(err1).toBeNull();
    expect(vanguard.cooldownsRemaining["vanguard-shield-guard"]).toBe(2);
    combat.queuedActions = [];
    const err2 = queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    expect(err2).not.toBeNull();
  });

  test("cooldown decrements each round and re-allows the skill once it hits 0", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.mp = 999;
    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };

    queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    resolveRound(combat, ctx);
    expect(vanguard.cooldownsRemaining["vanguard-shield-guard"]).toBe(1);
    expect(queueAction(combat, self, "vanguard-shield-guard", [self], ctx)).not.toBeNull();

    resolveRound(combat, ctx);
    expect(vanguard.cooldownsRemaining["vanguard-shield-guard"]).toBe(0);
    expect(queueAction(combat, self, "vanguard-shield-guard", [self], ctx)).toBeNull();
  });

  test("dead singleEnemy target redirects to another living enemy instead of fizzling", () => {
    const { ctx } = makeCtx();
    const rats = [spawnInto(ctx, "dungeon-rat"), spawnInto(ctx, "dungeon-rat")];
    const combat = startCombat("r1", rats.map((m) => m.id), ctx, false);
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    const [enemyA, enemyB] = livingMonsterRefs(combat, ctx);

    const targetA = getActorByRef(enemyA!, ctx);
    targetA.hp = 0;
    queueAction(combat, { kind: "character", id: rogue.id }, "rogue-stab", [enemyA!], ctx);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) continue;
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("the target is gone"))).toBe(false);
    const enemyBActor = getActorByRef(enemyB!, ctx);
    expect(enemyBActor.hp).toBeLessThan(enemyBActor.maxHp);
  });

  test("combat resolves to victory once the last monster dies, even across multiple rounds", () => {
    const { ctx } = makeCtx();
    const oneRat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [oneRat.id], ctx, false);

    for (let round = 0; round < 10 && !isCombatOver(combat, ctx); round++) {
      for (const ref of livingCharacterRefs(combat, ctx)) {
        const { skillId, targets } = pickAnyAction(ctx, combat, ref);
        queueAction(combat, ref, skillId, targets, ctx);
      }
      resolveRound(combat, ctx);
    }
    expect(isCombatOver(combat, ctx)).toBe(true);
    expect(combat.outcome).toBe("victory");
  });
});

describe("new skill mechanics (docs/technical-decisions.md §4)", () => {
  test("Shield Guard applies both guard and taunt in a single cast", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    resolveRound(combat, ctx);

    expect(combat.log.some((l) => l.text.includes("gains the Guard effect"))).toBe(true);
    expect(combat.log.some((l) => l.text.includes("gains the Taunt effect"))).toBe(true);
  });

  test("stuns status makes the bearer skip their turn entirely (§4.3)", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.activeStatusEffects.push({ statusEffectId: "stunned", turnsRemaining: 1 });
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    queueAction(combat, { kind: "character", id: rogue.id }, "rogue-stab", [enemyRef], ctx);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) continue;
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("is stunned"))).toBe(true);
    expect(combat.log.some((l) => l.text.includes("Rogue") && l.text.includes("uses"))).toBe(false);
  });

  test("Poison Coat buff makes a landed damage hit auto-apply Poisoned (on-hit rider, §4.2)", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: rogue.id };

    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) queueAction(combat, self, "rogue-poison-coat", [self], ctx);
      else {
        const { skillId, targets } = pickAnyAction(ctx, combat, ref);
        queueAction(combat, ref, skillId, targets, ctx);
      }
    }
    resolveRound(combat, ctx);
    expect(rogue.activeStatusEffects.some((s) => s.statusEffectId === "poison-coat")).toBe(true);

    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) queueAction(combat, self, "rogue-knife-throw", [enemyRef], ctx);
      else {
        const { skillId, targets } = pickAnyAction(ctx, combat, ref);
        queueAction(combat, ref, skillId, targets, ctx);
      }
    }
    resolveRound(combat, ctx);
    const enemyActor = getActorByRef(enemyRef, ctx);
    expect(enemyActor.activeStatusEffects.some((s) => s.statusEffectId === "poisoned")).toBe(true);
  });

  test("dual-relation skill (Purify) damages when aimed at an enemy, cleanses when aimed at an ally", () => {
    const { ctx } = makeCtx();
    const acolyte = createCharacter("cp-test", "Acolyte Test", getClass("acolyte"), 10);
    ctx.party.push(acolyte);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.activeStatusEffects.push({ statusEffectId: "burning", turnsRemaining: 2 });

    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const acolyteRef: CombatantRef = { kind: "character", id: acolyte.id };

    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    const hpBefore = getActorByRef(enemyRef, ctx).hp;
    expect(queueAction(combat, acolyteRef, "acolyte-purify", [enemyRef], ctx)).toBeNull();
    resolveRound(combat, ctx);
    expect(getActorByRef(enemyRef, ctx).hp).toBeLessThan(hpBefore);

    const allyRef: CombatantRef = { kind: "character", id: vanguard.id };
    expect(queueAction(combat, acolyteRef, "acolyte-purify", [allyRef], ctx)).toBeNull();
    resolveRound(combat, ctx);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "burning")).toBe(false);
  });

  test("ultimate skills always hit even at high fear, but scale damage down instead of missing", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("vanguard-sword-judgment");
    vanguard.mp = 999;
    vanguard.survival.fear = 99;
    const skeleton = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [skeleton.id], ctx, false);
    const enemyRef: CombatantRef = { kind: "monster", id: skeleton.id };
    const enemyActor = getActorByRef(enemyRef, ctx);
    const fullPowerDamage = Math.max(1, 30 + mitigatedOffense(vanguard.attack, enemyActor.defense));

    queueAction(combat, { kind: "character", id: vanguard.id }, "vanguard-sword-judgment", [enemyRef], ctx);
    const hpBefore = enemyActor.hp;
    resolveRound(combat, ctx);
    const actualDamage = hpBefore - enemyActor.hp;

    expect(combat.log.some((l) => l.text.includes("misses its attack"))).toBe(false);
    expect(actualDamage).toBeGreaterThan(0);
    expect(actualDamage).toBeLessThan(fullPowerDamage);
  });
});

describe("elite/boss skill kit (docs/gameplay-decisions.md §6.12)", () => {
  function queueTrivialActions(ctx: EngineContext, combat: ReturnType<typeof startCombat>) {
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
  }

  test("elite and boss pick from a weighted action pool (data/monsters.json actionWeights): both their named skill kit and a plain basic attack are reachable outcomes", () => {

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

  test("normal-tier skeleton-guard is unaffected — still uses the old flat attack (regression)", () => {
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

  test("boss telegraphs its Finishing Blow 1 turn ahead, locking in a target, then releases a huge flat hit on release (not HP%-based)", () => {
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

  test("elite cleave (Sweeping Cleave), when it fires, damages every living character in the same round", () => {
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
});

describe("items (docs/gameplay-decisions/07-items-artifacts.md §7.1)", () => {
  test("rollItemDrop fires close to the spec'd 60% of the time", () => {
    const rng = new Rng(42);
    let drops = 0;
    const total = 4000;
    for (let i = 0; i < total; i++) {
      if (rollItemDrop("dungeon-rat", rng)) drops++;
    }
    expect(drops / total).toBeGreaterThan(0.55);
    expect(drops / total).toBeLessThan(0.65);
  });

  test("on a successful roll, roughly half go to the archetype's own signature item", () => {
    const rng = new Rng(7);
    let signatureHits = 0;
    let totalDrops = 0;
    for (let i = 0; i < 8000; i++) {
      const id = rollItemDrop("dungeon-rat", rng);
      if (!id) continue;
      totalDrops++;
      if (id === "rat-meat") signatureHits++;
    }
    expect(totalDrops).toBeGreaterThan(0);
    expect(signatureHits / totalDrops).toBeGreaterThan(0.4);
    expect(signatureHits / totalDrops).toBeLessThan(0.6);
  });

  test("an archetype in 2 groups (Zombie Knight) splits the signature half evenly between both items", () => {
    const rng = new Rng(11);
    const counts: Record<string, number> = {};
    let totalDrops = 0;
    for (let i = 0; i < 12000; i++) {
      const id = rollItemDrop("zombie-knight", rng);
      if (!id) continue;
      totalDrops++;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    const rottenFleshRatio = (counts["rotten-flesh"] ?? 0) / totalDrops;
    const bladeFragmentRatio = (counts["broken-blade-fragment"] ?? 0) / totalDrops;
    expect(rottenFleshRatio).toBeGreaterThan(0.15);
    expect(rottenFleshRatio).toBeLessThan(0.35);
    expect(bladeFragmentRatio).toBeGreaterThan(0.15);
    expect(bladeFragmentRatio).toBeLessThan(0.35);
  });

  test("a base-pool item is still reachable for an archetype that also has a signature item", () => {
    const rng = new Rng(3);
    let sawBaseItem = false;
    for (let i = 0; i < 4000 && !sawBaseItem; i++) {
      const id = rollItemDrop("dungeon-rat", rng);
      if (id && !getItem(id).archetypeIds) sawBaseItem = true;
    }
    expect(sawBaseItem).toBe(true);
  });

  test("queueItemAction deducts inventory at queue time and applies the item's effect on resolve", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    vanguard.hp = vanguard.maxHp - 30;
    ctx.inventory["small-health-potion"] = 1;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    const err = queueItemAction(combat, self, "small-health-potion", [self], ctx);
    expect(err).toBeNull();
    expect(ctx.inventory["small-health-potion"]).toBe(0);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("recovers 30 HP"))).toBe(true);
  });

  test("checkItemUsable rejects when inventory has 0 of the item", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    expect(checkItemUsable(vanguard, "small-health-potion", ctx.inventory)).not.toBeNull();
  });

  test("Regeneration heals 10 HP/turn and refreshes (doesn't stack a 2nd instance) when reapplied while active", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.hp = 1;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "regeneration" }, target, target, { log: [] });
    expect(target.activeStatusEffects.filter((s) => s.statusEffectId === "regeneration")).toHaveLength(1);
    tickStatusEffects(target, { log: [] });
    expect(target.hp).toBe(11);
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "regeneration" }, target, target, { log: [] });
    expect(target.activeStatusEffects.filter((s) => s.statusEffectId === "regeneration")).toHaveLength(1);
  });

  test("poison-vulnerable doubles the bearer's own Poisoned DoT tick", () => {
    const { ctx } = makeCtx();
    const target = ctx.party[0]!;
    target.activeStatusEffects.push({ statusEffectId: "poisoned", turnsRemaining: 3 });
    target.activeStatusEffects.push({ statusEffectId: "poison-vulnerable", turnsRemaining: 2 });
    const before = target.hp;
    tickStatusEffects(target, { log: [] });
    expect(before - target.hp).toBe(8);
  });

  test("Game.useItemOutOfCombat heals outside combat, decrements inventory, and rejects singleEnemy items", () => {
    const game = new Game(1);
    const c = game.state.party[0]!;
    c.hp = 1;
    game.state.inventory["small-health-potion"] = 1;
    expect(game.useItemOutOfCombat("small-health-potion", c.id)).toBeNull();
    expect(c.hp).toBe(31);
    expect(game.state.inventory["small-health-potion"]).toBe(0);

    game.state.inventory["venom-thorn"] = 1;
    expect(game.useItemOutOfCombat("venom-thorn", c.id)).not.toBeNull();
  });

  test("Dragon Scale (allAllies) buffs every living party member at once outside combat", () => {
    const game = new Game(2);
    game.state.inventory["dragon-scale"] = 1;
    expect(game.useItemOutOfCombat("dragon-scale")).toBeNull();
    for (const c of game.state.party) {
      if (c.isAlive) expect(c.defense).toBeGreaterThan(getClass(c.classId).baseDefense);
    }
  });
});

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

function forceEventRoom(game: Game, eventId: string) {
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  room.type = "event";
  room.cleared = false;
  room.rolledEventId = eventId;
  return room;
}

describe("events (docs/gameplay-decisions/08-events.md)", () => {
  test("rollEvent: only picks ids from the 2 tiers, roughly 65% Common / 35% Rare", () => {
    const rng = new Rng(3);
    const commonIds = new Set(EVENTS.filter((e) => e.tier === "common").map((e) => e.id));
    const rareIds = new Set(EVENTS.filter((e) => e.tier === "rare").map((e) => e.id));
    let commonCount = 0;
    const total = 4000;
    for (let i = 0; i < total; i++) {
      const id = rollEvent(rng);
      expect(commonIds.has(id) || rareIds.has(id)).toBe(true);
      if (commonIds.has(id)) commonCount++;
    }
    expect(commonCount / total).toBeGreaterThan(0.6);
    expect(commonCount / total).toBeLessThan(0.7);
  });

  test("rollArtifactWithMinRarity('rare', ...) never rolls Common, matches §8.9's 60/30/10 Rare/Unique/Epic split", () => {
    const rng = new Rng(4);
    const counts: Record<string, number> = {};
    const total = 6000;
    for (let i = 0; i < total; i++) {
      const rarity = getArtifact(rollArtifactWithMinRarity("rare", rng)).rarity;
      counts[rarity] = (counts[rarity] ?? 0) + 1;
    }
    expect(counts["common"] ?? 0).toBe(0);
    expect((counts["rare"] ?? 0) / total).toBeGreaterThan(0.55);
    expect((counts["rare"] ?? 0) / total).toBeLessThan(0.65);
    expect((counts["epic"] ?? 0) / total).toBeGreaterThan(0.06);
    expect((counts["epic"] ?? 0) / total).toBeLessThan(0.14);
  });

  test("rollArtifactWithMinRarity('epic', ...) always returns an Epic", () => {
    const rng = new Rng(6);
    for (let i = 0; i < 20; i++) expect(getArtifact(rollArtifactWithMinRarity("epic", rng)).rarity).toBe("epic");
  });

  test("rollArtifactOrCursed fires the Cursed pool close to 30% of the time", () => {
    const rng = new Rng(7);
    let cursedCount = 0;
    const total = 4000;
    for (let i = 0; i < total; i++) {
      if (getArtifact(rollArtifactOrCursed(rng)).isCursed) cursedCount++;
    }
    expect(cursedCount / total).toBeGreaterThan(0.24);
    expect(cursedCount / total).toBeLessThan(0.36);
  });

  test("moveToRoom auto-resolves open-chest: grants 1 Artifact immediately and clears the room", () => {
    const game = new Game(1);
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "open-chest";
    const before = game.state.unequippedArtifactIds.length;
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.unequippedArtifactIds.length).toBe(before + 1);
    expect(room.cleared).toBe(true);
  });

  test("moveToRoom auto-resolves guardian-fight: starts combat with 1-2 scaled monsters", () => {
    const game = new Game(2);
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "guardian-fight";
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.combat).not.toBeNull();
    expect(room.monsterIds.length).toBeGreaterThanOrEqual(1);
    expect(room.monsterIds.length).toBeLessThanOrEqual(2);
  });

  test("moveToRoom pre-rolls merchant offers into activeEvent (2-3 artifacts)", () => {
    const game = new Game(3);
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "merchant";
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.activeEvent?.eventId).toBe("merchant");
    const offers = game.state.activeEvent?.offerArtifactIds ?? [];
    expect(offers.length).toBeGreaterThanOrEqual(2);
    expect(offers.length).toBeLessThanOrEqual(3);
  });

  test("merchantPurchase deducts HP price by rarity and grants the artifact; rejects a payer with too little HP", () => {
    const game = new Game(4);
    forceEventRoom(game, "merchant");
    const payer = game.state.party[0]!;
    game.state.activeEvent = { eventId: "merchant", offerArtifactIds: ["iron-gauntlet"] };
    const before = payer.hp;
    const cost = Math.floor((payer.maxHp * 15) / 100);
    expect(game.merchantPurchase(0, payer.id)).toBeNull();
    expect(payer.hp).toBe(before - cost);
    expect(game.state.unequippedArtifactIds).toContain("iron-gauntlet");
    expect(getRoom(game.state.floor, game.state.currentRoomId).cleared).toBe(true);

    const game2 = new Game(5);
    forceEventRoom(game2, "merchant");
    const poorPayer = game2.state.party[0]!;
    poorPayer.hp = 1;
    game2.state.activeEvent = { eventId: "merchant", offerArtifactIds: ["iron-gauntlet"] };
    expect(game2.merchantPurchase(0, poorPayer.id)).not.toBeNull();
  });

  test("bloodAltarPay pays a fixed 25% maxHP for 1 fully random artifact", () => {
    const game = new Game(6);
    forceEventRoom(game, "blood-altar");
    const c = game.state.party[0]!;
    const before = c.hp;
    const cost = Math.floor((c.maxHp * 25) / 100);
    const beforeCount = game.state.unequippedArtifactIds.length;
    expect(game.bloodAltarPay(c.id)).toBeNull();
    expect(c.hp).toBe(before - cost);
    expect(game.state.unequippedArtifactIds.length).toBe(beforeCount + 1);
  });

  test("cursedShrineDecide: accept grants the pre-rolled offer, decline grants nothing", () => {
    const game = new Game(7);
    forceEventRoom(game, "cursed-shrine");
    game.state.activeEvent = { eventId: "cursed-shrine", offerArtifactIds: ["blackened-locket"] };
    expect(game.cursedShrineDecide(true)).toBeNull();
    expect(game.state.unequippedArtifactIds).toContain("blackened-locket");

    const game2 = new Game(8);
    forceEventRoom(game2, "cursed-shrine");
    game2.state.activeEvent = { eventId: "cursed-shrine", offerArtifactIds: ["blackened-locket"] };
    expect(game2.cursedShrineDecide(false)).toBeNull();
    expect(game2.state.unequippedArtifactIds).not.toContain("blackened-locket");
  });

  test("twinAltarsChoose equips the chosen offer immediately, discards the other, and requires an unequip pick when full", () => {
    const game = new Game(9);
    forceEventRoom(game, "twin-altars");
    game.state.activeEvent = { eventId: "twin-altars", offerArtifactIds: ["iron-gauntlet", "sharp-claw"] };
    const c = game.state.party[0]!;
    expect(game.twinAltarsChoose(0, c.id)).toBeNull();
    expect(c.equippedArtifactIds).toContain("iron-gauntlet");
    expect(game.state.unequippedArtifactIds).not.toContain("sharp-claw");

    const game2 = new Game(10);
    const c2 = game2.state.party[0]!;
    game2.state.unequippedArtifactIds.push("ancient-sword", "heart-of-stone", "eternal-vial");
    expect(game2.equipArtifact(c2.id, "ancient-sword")).toBeNull();
    expect(game2.equipArtifact(c2.id, "heart-of-stone")).toBeNull();
    expect(game2.equipArtifact(c2.id, "eternal-vial")).toBeNull();
    forceEventRoom(game2, "twin-altars");
    game2.state.activeEvent = { eventId: "twin-altars", offerArtifactIds: ["iron-gauntlet", "sharp-claw"] };
    expect(game2.twinAltarsChoose(0, c2.id)).not.toBeNull();
    expect(game2.twinAltarsChoose(0, c2.id, "ancient-sword")).toBeNull();
    expect(c2.equippedArtifactIds).toContain("iron-gauntlet");
    expect(c2.equippedArtifactIds).not.toContain("ancient-sword");
    expect(game2.state.unequippedArtifactIds).toContain("ancient-sword");
  });

  test("sacrifice consumes the sacrificed artifact and rolls at/above its rarity; room only closes via sacrificeLeave", () => {
    const game = new Game(11);
    forceEventRoom(game, "sacrificial-circle");
    let sawSubUnique = false;
    for (let i = 0; i < 60 && !sawSubUnique; i++) {
      game.state.unequippedArtifactIds = ["scholars-insight"];
      expect(game.sacrifice("scholars-insight")).toBeNull();
      const rarity = getArtifact(game.state.unequippedArtifactIds[0]!).rarity;
      if (rarity === "common" || rarity === "rare") sawSubUnique = true;
    }
    expect(sawSubUnique).toBe(false);
    expect(getRoom(game.state.floor, game.state.currentRoomId).cleared).toBe(false);
    game.sacrificeLeave();
    expect(getRoom(game.state.floor, game.state.currentRoomId).cleared).toBe(true);
  });

  test("gamblingDenBet: win adds a same-rarity artifact, lose removes the bet permanently", () => {
    let won = false;
    let lost = false;
    for (let seed = 1; seed < 60 && !(won && lost); seed++) {
      const game = new Game(seed);
      forceEventRoom(game, "gambling-den");
      game.state.unequippedArtifactIds = ["iron-gauntlet"];
      expect(game.gamblingDenBet("iron-gauntlet")).toBeNull();
      if (game.state.unequippedArtifactIds.length === 2 && game.state.unequippedArtifactIds.includes("iron-gauntlet")) won = true;
      if (game.state.unequippedArtifactIds.length === 0) lost = true;
    }
    expect(won).toBe(true);
    expect(lost).toBe(true);
  });

  test("hermitRemoveCurse deletes a Cursed Artifact entirely (not returned to the pool)", () => {
    const game = new Game(12);
    forceEventRoom(game, "wandering-hermit");
    const c = game.state.party[0]!;
    game.state.unequippedArtifactIds.push("blackened-locket");
    expect(game.equipArtifact(c.id, "blackened-locket")).toBeNull();
    expect(game.hermitRemoveCurse(c.id, "blackened-locket")).toBeNull();
    expect(c.equippedArtifactIds).not.toContain("blackened-locket");
    expect(game.state.unequippedArtifactIds).not.toContain("blackened-locket");
  });

  test("hermitRerollFortune trades any owned artifact (auto-unequipping first) for a new random roll", () => {
    const game = new Game(13);
    forceEventRoom(game, "wandering-hermit");
    const c = game.state.party[0]!;
    game.state.unequippedArtifactIds.push("iron-gauntlet");
    expect(game.equipArtifact(c.id, "iron-gauntlet")).toBeNull();
    const beforeCount = game.state.unequippedArtifactIds.length + c.equippedArtifactIds.length;
    expect(game.hermitRerollFortune("iron-gauntlet")).toBeNull();
    expect(c.equippedArtifactIds).not.toContain("iron-gauntlet");
    expect(game.state.unequippedArtifactIds).not.toContain("iron-gauntlet");
    expect(game.state.unequippedArtifactIds.length + c.equippedArtifactIds.length).toBe(beforeCount);
  });

  test("collapsedFloorAttempt pays a fixed HP cost, then grants a Unique/Epic artifact on the 60% success roll", () => {
    let sawSuccess = false;
    let sawFailure = false;
    for (let seed = 1; seed < 60 && !(sawSuccess && sawFailure); seed++) {
      const game = new Game(seed);
      forceEventRoom(game, "collapsed-floor");
      const c = game.state.party[0]!;
      const hpBefore = c.hp;
      const before = game.state.unequippedArtifactIds.length;
      expect(game.collapsedFloorAttempt(c.id)).toBeNull();
      expect(c.hp).toBeLessThan(hpBefore);
      if (game.state.unequippedArtifactIds.length > before) {
        const gained = game.state.unequippedArtifactIds[game.state.unequippedArtifactIds.length - 1]!;
        expect(["unique", "epic"]).toContain(getArtifact(gained).rarity);
        sawSuccess = true;
      } else {
        sawFailure = true;
      }
    }
    expect(sawSuccess).toBe(true);
    expect(sawFailure).toBe(true);
  });

  test("curseAggroBoost adds flat aggro, curseDrainBoost speeds up survival drain", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedArtifactIds.push("unstable-core");
    expect(curseAggroBoostSum(c)).toBe(25);

    const { ctx: ctx2 } = makeCtx();
    const c2 = ctx2.party[0]!;
    c2.equippedArtifactIds.push("shackle-of-hunger");
    expect(survivalDrainMultiplier(c2)).toBeCloseTo(1.3);
  });

  test("recomputeCharacterStats folds curseAggroBoost into character.aggro on equip", () => {
    const game = new Game(14);
    const c = game.state.party[0]!;
    const baseAggro = c.aggro;
    game.state.unequippedArtifactIds.push("unstable-core");
    expect(game.equipArtifact(c.id, "unstable-core")).toBeNull();
    expect(c.aggro).toBe(baseAggro + 25);
    expect(game.unequipArtifact(c.id, "unstable-core")).toBeNull();
    expect(c.aggro).toBe(baseAggro);
  });
});

describe("skill rank resolution (docs/gameplay-decisions/10-skill-ranks-and-monster-skills.md §10.1)", () => {
  const mockSkill: SkillDefinition = {
    id: "mock-skill",
    name: "Mock Skill",
    description: "",
    mpCost: 5,
    target: "singleEnemy",
    effects: [{ kind: "damage", amount: 10 }],
    slot: 1,
    unlockLevel: 1,
    ranks: [
      { rank: 1, unlockLevel: 1, mpCost: 5, effects: [{ kind: "damage", amount: 10 }] },
      { rank: 2, unlockLevel: 7, mpCost: 6, effects: [{ kind: "damage", amount: 13 }] },
      { rank: 3, unlockLevel: 15, mpCost: 7, effects: [{ kind: "damage", amount: 16 }] },
    ],
  };

  test("below rank-2 threshold resolves to rank-1 numbers", () => {
    const effective = getEffectiveSkill(mockSkill, 6);
    expect(effective.mpCost).toBe(5);
    expect(effective.effects).toEqual([{ kind: "damage", amount: 10 }]);
  });

  test("at/above rank-2 threshold but below rank-3 resolves to rank-2 numbers", () => {
    const effective = getEffectiveSkill(mockSkill, 7);
    expect(effective.mpCost).toBe(6);
    expect(effective.effects).toEqual([{ kind: "damage", amount: 13 }]);
    expect(getEffectiveSkill(mockSkill, 14).mpCost).toBe(6);
  });

  test("at/above rank-3 threshold resolves to rank-3 numbers", () => {
    const effective = getEffectiveSkill(mockSkill, 15);
    expect(effective.mpCost).toBe(7);
    expect(effective.effects).toEqual([{ kind: "damage", amount: 16 }]);
    expect(getEffectiveSkill(mockSkill, 100).mpCost).toBe(7);
  });

  test("a skill with no ranks is returned unchanged", () => {
    const noRanks = getSkill("vanguard-slash");
    expect(getEffectiveSkill(noRanks, 100)).toBe(noRanks);
  });

  test("a rank switching from effectsByRelation to plain effects (or vice versa) doesn't leak the stale field", () => {
    const mixedSkill: SkillDefinition = {
      id: "mock-mixed-skill",
      name: "Mock Mixed Skill",
      description: "",
      mpCost: 5,
      target: "singleAllyOrEnemy",
      effectsByRelation: { ally: [{ kind: "heal", amount: 10 }], enemy: [{ kind: "damage", amount: 10 }] },
      slot: 1,
      unlockLevel: 1,
      ranks: [
        { rank: 1, unlockLevel: 1, mpCost: 5, effectsByRelation: { ally: [{ kind: "heal", amount: 10 }], enemy: [{ kind: "damage", amount: 10 }] } },
        { rank: 2, unlockLevel: 7, mpCost: 6, effects: [{ kind: "damage", amount: 13 }] },
      ],
    };
    const rank2 = getEffectiveSkill(mixedSkill, 7);
    expect(rank2.effects).toEqual([{ kind: "damage", amount: 13 }]);
    expect(rank2.effectsByRelation).toBeUndefined();
  });
});

describe("new engine mechanics for §9 (onHitAoeDamage, conditionalBonus, lifestealPercent, accuracyPenaltyPercent)", () => {
  test("onHitAoeDamage: a landed hit splashes AoE damage to every living enemy", () => {
    STATUS_EFFECTS.push({
      id: "test-storm-empowered",
      name: "Test Storm-Empowered",
      description: "",
      perTurnEffects: [],
      curableByMiniGame: [],
      durationTurns: 3,
      onHitAoeDamage: { amount: 6, isMagic: true, ignoreDefensePercent: 30 },
    });
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.activeStatusEffects.push({ statusEffectId: "test-storm-empowered", turnsRemaining: 3 });
    const rat1 = spawnInto(ctx, "dungeon-rat");
    const rat2 = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat1.id, rat2.id], ctx, false);
    const enemyRefs = livingMonsterRefs(combat, ctx);
    const hpBefore = enemyRefs.map((r) => getActorByRef(r, ctx).hp);

    queueAction(combat, { kind: "character", id: vanguard.id }, "vanguard-slash", [enemyRefs[0]!], ctx);
    resolveRound(combat, ctx);

    for (let i = 0; i < enemyRefs.length; i++) {
      expect(getActorByRef(enemyRefs[i]!, ctx).hp).toBeLessThan(hpBefore[i]!);
    }
  });

  test("onHitAoeDamage: an AoE skill hitting multiple enemies splashes only once per cast, not once per target (no quadratic blowup)", () => {
    STATUS_EFFECTS.push({
      id: "test-storm-empowered-aoe",
      name: "Test Storm-Empowered AoE",
      description: "",
      perTurnEffects: [],
      curableByMiniGame: [],
      durationTurns: 3,
      onHitAoeDamage: { amount: 6, isMagic: true, ignoreDefensePercent: 30 },
    });
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.mp = 999;
    vanguard.unlockedSkillIds.push("vanguard-heavy-charge");
    vanguard.activeStatusEffects.push({ statusEffectId: "test-storm-empowered-aoe", turnsRemaining: 3 });
    const rat1 = spawnInto(ctx, "dungeon-rat");
    const rat2 = spawnInto(ctx, "dungeon-rat");
    rat1.maxHp = 500;
    rat1.hp = 500;
    rat2.maxHp = 500;
    rat2.hp = 500;
    const combat = startCombat("r1", [rat1.id, rat2.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    const targets = autoResolveTargets("allEnemies", self, combat, ctx) ?? [];

    const directDmg = Math.max(1, Math.round(mitigatedOffense(vanguard.attack, rat1.defense) + 12));
    const splashDmg = Math.max(1, Math.round(mitigatedOffense(vanguard.magicPower, rat1.defense * 0.7) + 6));

    queueAction(combat, self, "vanguard-heavy-charge", targets, ctx);
    resolveRound(combat, ctx);

    const dmgTaken1 = 500 - getActorByRef({ kind: "monster", id: rat1.id }, ctx).hp;
    const dmgTaken2 = 500 - getActorByRef({ kind: "monster", id: rat2.id }, ctx).hp;

    expect(dmgTaken1).toBe(directDmg + splashDmg);
    expect(dmgTaken2).toBe(directDmg + splashDmg);
  });

  test("onHitAoeDamage: splash damage is scoped to the current combat's enemies, not every monster on the floor", () => {
    STATUS_EFFECTS.push({
      id: "test-storm-empowered-scope",
      name: "Test Storm-Empowered Scope",
      description: "",
      perTurnEffects: [],
      curableByMiniGame: [],
      durationTurns: 3,
      onHitAoeDamage: { amount: 6, isMagic: true, ignoreDefensePercent: 30 },
    });
    const { ctx, monsters } = makeCtx();
    const offFloor = monsters.slice(0, 2);
    const offFloorHpBefore = offFloor.map((m) => m.hp);

    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.activeStatusEffects.push({ statusEffectId: "test-storm-empowered-scope", turnsRemaining: 3 });
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);

    queueAction(combat, { kind: "character", id: vanguard.id }, "vanguard-slash", [{ kind: "monster", id: rat.id }], ctx);
    resolveRound(combat, ctx);

    for (let i = 0; i < offFloor.length; i++) {
      expect(offFloor[i]!.hp).toBe(offFloorHpBefore[i]!);
    }
  });

  test("conditionalBonus: adds ignoreDefensePercent when the required status is active, and keeps it when consumesStatus is absent", () => {
    STATUS_EFFECTS.push({
      id: "test-conditional-buff",
      name: "Test Conditional Buff",
      description: "",
      perTurnEffects: [],
      curableByMiniGame: [],
      durationTurns: 3,
    });
    CLASSES[0]!.skills.push({
      id: "test-conditional-skill",
      name: "Test Conditional Skill",
      description: "",
      mpCost: 0,
      target: "singleEnemy",
      effects: [{ kind: "damage", amount: 10 }],
      slot: 1,
      unlockLevel: 1,
      conditionalBonus: { requiresStatusId: "test-conditional-buff", ignoreDefensePercentBonus: 30 },
    });

    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("test-conditional-skill");
    vanguard.activeStatusEffects.push({ statusEffectId: "test-conditional-buff", turnsRemaining: 3 });
    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    const hpBefore = getActorByRef(enemyRef, ctx).hp;
    const noBonusDamage = Math.max(1, Math.round(mitigatedOffense(vanguard.attack, getActorByRef(enemyRef, ctx).defense)) + 10);

    queueAction(combat, { kind: "character", id: vanguard.id }, "test-conditional-skill", [enemyRef], ctx);
    resolveRound(combat, ctx);
    const actualDamage = hpBefore - getActorByRef(enemyRef, ctx).hp;

    expect(actualDamage).toBeGreaterThan(noBonusDamage);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "test-conditional-buff")).toBe(true);
  });

  test("conditionalBonus: consumesStatus removes the status after casting", () => {
    CLASSES[0]!.skills.push({
      id: "test-consuming-skill",
      name: "Test Consuming Skill",
      description: "",
      mpCost: 0,
      target: "singleEnemy",
      effects: [{ kind: "damage", amount: 10 }],
      slot: 1,
      unlockLevel: 1,
      isUltimate: true,
      conditionalBonus: { requiresStatusId: "test-conditional-buff", ignoreDefensePercentBonus: 60, consumesStatus: true },
    });

    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("test-consuming-skill");
    vanguard.activeStatusEffects.push({ statusEffectId: "test-conditional-buff", turnsRemaining: 3 });
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    const hpBefore = getActorByRef(enemyRef, ctx).hp;

    queueAction(combat, { kind: "character", id: vanguard.id }, "test-consuming-skill", [enemyRef], ctx);
    resolveRound(combat, ctx);

    expect(getActorByRef(enemyRef, ctx).hp).toBeLessThan(hpBefore);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "test-conditional-buff")).toBe(false);
  });

  test("conditionalBonus: consumesStatus does NOT remove the status if the bonus effect never actually connects", () => {
    CLASSES[0]!.skills.push({
      id: "test-whiff-consuming-skill",
      name: "Test Whiff Consuming Skill",
      description: "",
      mpCost: 0,
      target: "singleEnemy",
      effects: [{ kind: "damage", amount: 10, chance: 0 }],
      slot: 1,
      unlockLevel: 1,
      conditionalBonus: { requiresStatusId: "test-conditional-buff", ignoreDefensePercentBonus: 60, consumesStatus: true },
    });

    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("test-whiff-consuming-skill");
    vanguard.activeStatusEffects.push({ statusEffectId: "test-conditional-buff", turnsRemaining: 3 });
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    const hpBefore = getActorByRef(enemyRef, ctx).hp;

    queueAction(combat, { kind: "character", id: vanguard.id }, "test-whiff-consuming-skill", [enemyRef], ctx);
    resolveRound(combat, ctx);

    expect(getActorByRef(enemyRef, ctx).hp).toBe(hpBefore);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "test-conditional-buff")).toBe(true);
  });

  test("lifestealPercent heals the source by the given % of dealt damage, capped at maxHp", () => {
    const { ctx } = makeCtx();
    const bat = spawnInto(ctx, "black-bat");
    const rat = spawnInto(ctx, "dungeon-rat");
    bat.hp = 1;
    const log: LogEntry[] = [];
    const dealt = resolveSkillEffect({ kind: "damage", amount: 2, lifestealPercent: 50 }, bat, rat, { log });
    expect(bat.hp).toBe(Math.min(bat.maxHp, 1 + Math.round(dealt * 0.5)));
    expect(log.some((l) => l.kind === "heal")).toBe(true);
  });

  test("lifestealPercent heal is capped at the source's maxHp", () => {
    const { ctx } = makeCtx();
    const bat = spawnInto(ctx, "black-bat");
    const rat = spawnInto(ctx, "dungeon-rat");
    bat.hp = bat.maxHp;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "damage", amount: 2, lifestealPercent: 50 }, bat, rat, { log });
    expect(bat.hp).toBe(bat.maxHp);
  });

  test("rollHits: a monster with no accuracyPenaltyPercent status always hits (no regression)", () => {
    const { ctx } = makeCtx();
    const rat = spawnInto(ctx, "dungeon-rat");
    expect(rollHits(rat, () => 0)).toBe(true);
  });

  test("rollHits: a monster carrying an accuracyPenaltyPercent status misses below the threshold, hits at/above it", () => {
    STATUS_EFFECTS.push({
      id: "test-blinded",
      name: "Test Blinded",
      description: "",
      perTurnEffects: [],
      curableByMiniGame: [],
      durationTurns: 2,
      accuracyPenaltyPercent: 60,
    });
    const { ctx } = makeCtx();
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.activeStatusEffects.push({ statusEffectId: "test-blinded", turnsRemaining: 2 });
    expect(rollHits(rat, () => 0.5)).toBe(false);
    expect(rollHits(rat, () => 0.7)).toBe(true);
  });

  test("rollHits: a character's fear penalty and accuracyPenaltyPercent status combine, clamped at 100%", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.survival.fear = 50;
    vanguard.activeStatusEffects.push({ statusEffectId: "test-blinded", turnsRemaining: 2 });
    expect(getFearAccuracyPenalty(getFearTier(vanguard.survival.fear))).toBeCloseTo(0.1);
    expect(rollHits(vanguard, () => 0.65)).toBe(false);
    expect(rollHits(vanguard, () => 0.75)).toBe(true);

    vanguard.activeStatusEffects.push({ statusEffectId: "test-blinded", turnsRemaining: 2 });
    expect(rollHits(vanguard, () => 0.99)).toBe(false);
  });

  test("isHelpfulStatusEffect: a status with only accuracyPenaltyPercent set is a debuff, not a buff", () => {
    expect(isHelpfulStatusEffect(getStatusEffect("test-blinded"))).toBe(false);
  });

  test("a monster's basicAttack now rolls rollHits: never misses without accuracyPenaltyPercent, can miss when Blinded", () => {
    let missWithoutBlinded = 0;
    let missWithBlinded = 0;
    for (let seed = 0; seed < 40; seed++) {
      const plain = makeCtx(seed).ctx;
      const zombiePlain = spawnInto(plain, "zombie");
      const combatPlain = startCombat("r1", [zombiePlain.id], plain, false);
      resolveRound(combatPlain, plain);
      if (combatPlain.log.some((l) => l.text.includes("misses its attack"))) missWithoutBlinded++;

      const blinded = makeCtx(seed).ctx;
      const zombieBlinded = spawnInto(blinded, "zombie");
      zombieBlinded.activeStatusEffects.push({ statusEffectId: "blinded", turnsRemaining: 2 });
      const combatBlinded = startCombat("r1", [zombieBlinded.id], blinded, false);
      resolveRound(combatBlinded, blinded);
      if (combatBlinded.log.some((l) => l.text.includes("misses its attack"))) missWithBlinded++;
    }
    expect(missWithoutBlinded).toBe(0);
    expect(missWithBlinded).toBeGreaterThan(0);
  });
});

describe("Vanguard skill ranks (docs/gameplay-decisions/10-skill-ranks-and-monster-skills.md §10.1)", () => {
  test("Shield Guard ranks resolve to guard-ii/guard-iii at lv7/lv15", () => {
    const skill = getSkill("vanguard-shield-guard");
    expect(getEffectiveSkill(skill, 1).mpCost).toBe(8);
    expect(getEffectiveSkill(skill, 1).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "guard" },
      { kind: "applyStatusEffect", statusEffectId: "taunt" },
    ]);
    expect(getEffectiveSkill(skill, 7).mpCost).toBe(9);
    expect(getEffectiveSkill(skill, 7).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "guard-ii" },
      { kind: "applyStatusEffect", statusEffectId: "taunt" },
    ]);
    expect(getEffectiveSkill(skill, 15).mpCost).toBe(10);
    expect(getEffectiveSkill(skill, 15).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "guard-iii" },
      { kind: "applyStatusEffect", statusEffectId: "taunt" },
    ]);
  });

  test("Sword Judgment ranks resolve to dmg 30/38/47 at lv35/70/100", () => {
    const skill = getSkill("vanguard-sword-judgment");
    expect(getEffectiveSkill(skill, 35).effects).toEqual([{ kind: "damage", amount: 30 }]);
    expect(getEffectiveSkill(skill, 70).effects).toEqual([{ kind: "damage", amount: 38 }]);
    expect(getEffectiveSkill(skill, 100).effects).toEqual([{ kind: "damage", amount: 47 }]);
  });
});

describe("Mage skill ranks (docs/gameplay-decisions/10-skill-ranks-and-monster-skills.md §10.1)", () => {
  test("Fireball ranks resolve dmg/mp/burn-chance at lv1/7/15", () => {
    const skill = getSkill("mage-fireball");
    expect(getEffectiveSkill(skill, 1)).toMatchObject({
      mpCost: 5,
      effects: [
        { kind: "damage", amount: 10 },
        { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.3 },
      ],
    });
    expect(getEffectiveSkill(skill, 7)).toMatchObject({
      mpCost: 6,
      effects: [
        { kind: "damage", amount: 13 },
        { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.4 },
      ],
    });
    expect(getEffectiveSkill(skill, 15)).toMatchObject({
      mpCost: 7,
      effects: [
        { kind: "damage", amount: 16 },
        { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.5 },
      ],
    });
  });

  test("Ice Age ranks resolve dmg 22/28/35 at lv35/70/100", () => {
    const skill = getSkill("mage-ice-age");
    expect(getEffectiveSkill(skill, 35).effects).toEqual([{ kind: "damage", amount: 22 }]);
    expect(getEffectiveSkill(skill, 70).effects).toEqual([{ kind: "damage", amount: 28 }]);
    expect(getEffectiveSkill(skill, 100).effects).toEqual([{ kind: "damage", amount: 35 }]);
  });
});

describe("Rogue rebalance + Plague Doctor class base (docs/gameplay-decisions/09-new-classes-viking-plaguedoctor.md §9.2/§9.4)", () => {
  test("Rogue's maxHp/maxMp are rebalanced to 109/40, other fields unchanged", () => {
    const rogue = getClass("rogue");
    expect(rogue.baseMaxHp).toBe(109);
    expect(rogue.baseMaxMp).toBe(40);
    expect(rogue.baseAttack).toBe(16);
    expect(rogue.baseDefense).toBe(6);
    expect(rogue.baseAggro).toBe(10);
    expect(rogue.baseSpeed).toBe(16);
    expect(rogue.growthWeights).toEqual({ attack: 1.7, defense: 0.9, maxHp: 1.3, maxMp: 0.8, magicPower: 0.3 });
  });

  test("Plague Doctor base stats and growthWeights match §9.4", () => {
    const doc = getClass("plague-doctor");
    expect({
      baseAttack: doc.baseAttack,
      baseMagicPower: doc.baseMagicPower,
      baseDefense: doc.baseDefense,
      baseMaxHp: doc.baseMaxHp,
      baseMaxMp: doc.baseMaxMp,
      baseAggro: doc.baseAggro,
      baseSpeed: doc.baseSpeed,
    }).toEqual({ baseAttack: 4, baseMagicPower: 13, baseDefense: 6, baseMaxHp: 85, baseMaxMp: 60, baseAggro: 8, baseSpeed: 11 });
    expect(doc.growthWeights).toEqual({ attack: 0.2, defense: 0.9, maxHp: 1.1, maxMp: 1.3, magicPower: 1.5 });
    expect(doc.skills.length).toBe(6);
  });

  test("blinded status has accuracyPenaltyPercent 60, no perTurnEffects", () => {
    const blinded = getStatusEffect("blinded");
    expect(blinded.accuracyPenaltyPercent).toBe(60);
    expect(blinded.perTurnEffects).toEqual([]);
    expect(blinded.durationTurns).toBe(2);
    expect(isHelpfulStatusEffect(blinded)).toBe(false);
  });

  test("Fire Vial ranks resolve dmg/burn% at lv1/7/15", () => {
    const skill = getSkill("plaguedoc-fire-vial");
    expect(getEffectiveSkill(skill, 1).effects).toEqual([
      { kind: "damage", amount: 5 },
      { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.6 },
    ]);
    expect(getEffectiveSkill(skill, 7).effects).toEqual([
      { kind: "damage", amount: 7 },
      { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.7 },
    ]);
    expect(getEffectiveSkill(skill, 15).effects).toEqual([
      { kind: "damage", amount: 9 },
      { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.8 },
    ]);
  });

  test("Total Plague ranks resolve effectsByRelation at lv35/70/100", () => {
    const skill = getSkill("plaguedoc-total-plague");
    expect(getEffectiveSkill(skill, 35).effectsByRelation).toEqual({
      ally: [
        { kind: "heal", amount: 20 },
        { kind: "removeStatusEffect" },
      ],
      enemy: [
        { kind: "damage", amount: 10 },
        { kind: "applyStatusEffect", statusEffectId: "poisoned", chance: 0.8 },
        { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.8 },
      ],
    });
    expect(getEffectiveSkill(skill, 100).effectsByRelation).toEqual({
      ally: [
        { kind: "heal", amount: 31 },
        { kind: "removeStatusEffect" },
      ],
      enemy: [
        { kind: "damage", amount: 16 },
        { kind: "applyStatusEffect", statusEffectId: "poisoned", chance: 0.9 },
        { kind: "applyStatusEffect", statusEffectId: "burning", chance: 0.9 },
      ],
    });
  });

  test("Blinding Vial, when its proc succeeds, applies blinded to the target and logs it as a debuff", () => {
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const doc = ctx.party.find((p) => p.classId === "plague-doctor")!;
      doc.unlockedSkillIds.push("plaguedoc-blinding-vial");
      doc.mp = 999;
      const tanky = spawnInto(ctx, "skeleton-guard");
      const combat = startCombat("r1", [tanky.id], ctx, false);
      const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
      queueAction(combat, { kind: "character", id: doc.id }, "plaguedoc-blinding-vial", [enemyRef], ctx);
      resolveRound(combat, ctx);
      const enemyActor = getActorByRef(enemyRef, ctx);
      if (!enemyActor.activeStatusEffects.some((s) => s.statusEffectId === "blinded")) continue;
      found = true;
      expect(combat.log.some((l) => l.text.includes("gains the Blinded effect") && l.kind === "debuff")).toBe(true);
    }
    expect(found).toBe(true);
  });

  test("blinded's accuracyPenaltyPercent makes the bearer miss more via rollHits (real status, not a mock)", () => {
    const { ctx } = makeCtx();
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.activeStatusEffects.push({ statusEffectId: "blinded", turnsRemaining: 2 });
    expect(rollHits(rat, () => 0.5)).toBe(false);
    expect(rollHits(rat, () => 0.7)).toBe(true);
  });

  test("Total Plague heals+cures allies and damages+afflicts enemies in the same cast", () => {
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const doc = ctx.party.find((p) => p.classId === "plague-doctor")!;
      doc.unlockedSkillIds.push("plaguedoc-total-plague");
      doc.mp = 999;
      const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
      vanguard.activeStatusEffects.push({ statusEffectId: "weakened", turnsRemaining: 2 });
      vanguard.hp = 1;
      const tanky = spawnInto(ctx, "skeleton-guard");
      const combat = startCombat("r1", [tanky.id], ctx, false);
      const docRef: CombatantRef = { kind: "character", id: doc.id };
      const targets = autoResolveTargets("allAlliesAndEnemies", docRef, combat, ctx) ?? [];
      queueAction(combat, docRef, "plaguedoc-total-plague", targets, ctx);
      resolveRound(combat, ctx);

      expect(combat.log.some((l) => l.text.startsWith(vanguard.name) && l.text.includes("recovers"))).toBe(true);
      expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "weakened")).toBe(false);
      const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
      const enemyActor = getActorByRef(enemyRef, ctx);
      if (!enemyActor.activeStatusEffects.some((s) => s.statusEffectId === "poisoned" || s.statusEffectId === "burning")) continue;
      found = true;
    }
    expect(found).toBe(true);
  });
});

describe("Viking class (docs/gameplay-decisions/09-new-classes-viking-plaguedoctor.md §9.3)", () => {
  test("Viking base stats and growthWeights match §9.3", () => {
    const viking = getClass("viking");
    expect({
      baseAttack: viking.baseAttack,
      baseMagicPower: viking.baseMagicPower,
      baseDefense: viking.baseDefense,
      baseMaxHp: viking.baseMaxHp,
      baseMaxMp: viking.baseMaxMp,
      baseAggro: viking.baseAggro,
      baseSpeed: viking.baseSpeed,
    }).toEqual({ baseAttack: 18, baseMagicPower: 6, baseDefense: 6, baseMaxHp: 105, baseMaxMp: 30, baseAggro: 16, baseSpeed: 11 });
    expect(viking.growthWeights).toEqual({ attack: 1.5, defense: 0.7, maxHp: 1.2, maxMp: 0.7, magicPower: 0.9 });
    expect(viking.skills.length).toBe(6);
  });

  test("Lightning Axe applies storm-empowered + self def-4/aggro+8 at rank 1", () => {
    const skill = getSkill("viking-lightning-axe");
    expect(getEffectiveSkill(skill, 1).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "storm-empowered" },
      { kind: "modifyCombatStat", combatStat: "defense", amount: -4 },
      { kind: "modifyCombatStat", combatStat: "aggro", amount: 8 },
    ]);
  });

  test("Lightning Axe ranks reference storm-empowered-ii/iii, self-debuff unchanged", () => {
    const skill = getSkill("viking-lightning-axe");
    expect(getEffectiveSkill(skill, 7).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "storm-empowered-ii" },
      { kind: "modifyCombatStat", combatStat: "defense", amount: -4 },
      { kind: "modifyCombatStat", combatStat: "aggro", amount: 8 },
    ]);
    expect(getEffectiveSkill(skill, 15).effects).toEqual([
      { kind: "applyStatusEffect", statusEffectId: "storm-empowered-iii" },
      { kind: "modifyCombatStat", combatStat: "defense", amount: -4 },
      { kind: "modifyCombatStat", combatStat: "aggro", amount: 8 },
    ]);
  });

  test("Thunder God's Fury has consumesStatus conditionalBonus and ranks resolve dmg 32/40/50", () => {
    const skill = getSkill("viking-thunder-god-fury");
    expect(skill.conditionalBonus).toEqual({ requiresStatusId: "storm-empowered", ignoreDefensePercentBonus: 60, consumesStatus: true });
    expect(getEffectiveSkill(skill, 35).effects).toEqual([{ kind: "damage", amount: 32 }]);
    expect(getEffectiveSkill(skill, 70).effects).toEqual([{ kind: "damage", amount: 40 }]);
    expect(getEffectiveSkill(skill, 100).effects).toEqual([{ kind: "damage", amount: 50 }]);
  });

  test("Frenzied Slash/Throw Axe/Spinning Axe ranks resolve dmg+bleed% per §10.4", () => {
    const slash = getSkill("viking-frenzied-slash");
    expect(getEffectiveSkill(slash, 7).effects).toEqual([
      { kind: "damage", amount: 12 },
      { kind: "applyStatusEffect", statusEffectId: "bleeding", chance: 0.6 },
    ]);
    expect(getEffectiveSkill(slash, 15).effects).toEqual([
      { kind: "damage", amount: 15 },
      { kind: "applyStatusEffect", statusEffectId: "bleeding", chance: 0.7 },
    ]);

    const throwAxe = getSkill("viking-throw-axe");
    expect(getEffectiveSkill(throwAxe, 25).effects).toEqual([{ kind: "damage", amount: 20 }]);
    expect(getEffectiveSkill(throwAxe, 45).effects).toEqual([{ kind: "damage", amount: 25 }]);

    const spinAxe = getSkill("viking-spin-axe");
    expect(getEffectiveSkill(spinAxe, 50).effects).toEqual([
      { kind: "damage", amount: 18 },
      { kind: "applyStatusEffect", statusEffectId: "bleeding", chance: 0.4 },
    ]);
    expect(getEffectiveSkill(spinAxe, 75).effects).toEqual([
      { kind: "damage", amount: 22 },
      { kind: "applyStatusEffect", statusEffectId: "bleeding", chance: 0.5 },
    ]);
  });

  test("storm-empowered-ii/iii and bleeding statuses exist with the documented fields", () => {
    expect(getStatusEffect("storm-empowered-ii").onHitAoeDamage).toEqual({ amount: 8, isMagic: true, ignoreDefensePercent: 30 });
    expect(getStatusEffect("storm-empowered-iii").onHitAoeDamage).toEqual({ amount: 10, isMagic: true, ignoreDefensePercent: 30 });
    expect(getStatusEffect("bleeding").perTurnEffects).toEqual([{ kind: "damage", amount: 5 }]);
  });

  test("full combat sequence: Lightning Axe -> Frenzied Slash (bonus + AoE splash) -> Thunder God's Fury (bonus + consumes)", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.mp = 999;
    viking.unlockedSkillIds.push("viking-thunder-god-fury");
    const rat1 = spawnInto(ctx, "dungeon-rat");
    const rat2 = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat1.id, rat2.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: viking.id };
    const rat1Ref: CombatantRef = { kind: "monster", id: rat1.id };

    queueAction(combat, self, "viking-lightning-axe", [self], ctx);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("gains the Storm-Empowered effect"))).toBe(true);
    expect(viking.activeStatusEffects.some((s) => s.statusEffectId === "storm-empowered")).toBe(true);

    const rat2HpBefore = getActorByRef({ kind: "monster", id: rat2.id }, ctx).hp;
    queueAction(combat, self, "viking-frenzied-slash", [rat1Ref], ctx);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("misses"))).toBe(false);
    const rat2HpAfter = getActorByRef({ kind: "monster", id: rat2.id }, ctx).hp;
    expect(rat2HpAfter).toBeLessThan(rat2HpBefore);
    expect(viking.activeStatusEffects.some((s) => s.statusEffectId === "storm-empowered")).toBe(true);

    const ultimateTargets = autoResolveTargets("allEnemies", self, combat, ctx) ?? [];
    queueAction(combat, self, "viking-thunder-god-fury", ultimateTargets, ctx);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("Thunder God's Fury"))).toBe(true);
    expect(viking.activeStatusEffects.some((s) => s.statusEffectId === "storm-empowered")).toBe(false);
  });

  test("rank-resolution picks up Viking's rank-2/3 numbers at the correct character level", () => {
    const skill = getSkill("viking-throw-axe");
    const character = createCharacter("vk-test", "Viking Test", getClass("viking"), 25);
    expect(getEffectiveSkill(skill, character.level).effects).toEqual([{ kind: "damage", amount: 20 }]);
  });

  test("conditionalBonus still triggers once Lightning Axe's buff is the rank-2 variant (storm-empowered-ii)", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.level = 10;
    viking.mp = 999;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.defense = 15;
    rat.maxHp = 500;
    rat.hp = 500;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: viking.id };
    const enemyRef: CombatantRef = { kind: "monster", id: rat.id };

    queueAction(combat, self, "viking-lightning-axe", [self], ctx);
    resolveRound(combat, ctx);
    expect(viking.activeStatusEffects.some((s) => s.statusEffectId === "storm-empowered-ii")).toBe(true);

    // storm-empowered's own onHitAoeDamage splash also lands on the same single enemy every cast, independent of
    // whether Frenzied Slash's conditionalBonus applies — so the fix must be verified on the DIRECT hit's exact
    // damage (parsed from the log), not the round's total HP delta, which the splash would confound either way.
    const withBonusDamage = Math.max(1, Math.round(12 + mitigatedOffense(viking.attack, rat.defense * 0.7)));
    const noBonusDamage = Math.max(1, Math.round(12 + mitigatedOffense(viking.attack, rat.defense)));
    expect(withBonusDamage).toBeGreaterThan(noBonusDamage);

    const logBefore = combat.log.length;
    queueAction(combat, self, "viking-frenzied-slash", [enemyRef], ctx);
    resolveRound(combat, ctx);
    const directHitLine = combat.log.slice(logBefore).find((l) => /^Dungeon Rat takes \d+ damage from Viking\.$/.test(l.text));
    const directDamage = Number(directHitLine!.text.match(/takes (\d+) damage/)![1]);

    expect(directDamage).toBe(withBonusDamage);
  });

  test("consumesStatus still removes the buff once it's the rank-3 variant (storm-empowered-iii)", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.level = 40;
    viking.mp = 999;
    viking.unlockedSkillIds.push("viking-thunder-god-fury");
    const rat1 = spawnInto(ctx, "dungeon-rat");
    const rat2 = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat1.id, rat2.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: viking.id };

    queueAction(combat, self, "viking-lightning-axe", [self], ctx);
    resolveRound(combat, ctx);
    expect(viking.activeStatusEffects.some((s) => s.statusEffectId === "storm-empowered-iii")).toBe(true);

    const ultimateTargets = autoResolveTargets("allEnemies", self, combat, ctx) ?? [];
    queueAction(combat, self, "viking-thunder-god-fury", ultimateTargets, ctx);
    resolveRound(combat, ctx);

    expect(viking.activeStatusEffects.some((s) => s.statusEffectId.startsWith("storm-empowered"))).toBe(false);
  });
});

describe("Rogue skill ranks + poison exclusivity (docs/gameplay-decisions/10-skill-ranks-and-monster-skills.md §10.1)", () => {
  test("Poison Bomb ranks apply poisoned-ii/iii, exclusive to this skill", () => {
    const bomb = getSkill("rogue-poison-bomb");
    expect(getEffectiveSkill(bomb, 20).effects).toEqual([{ kind: "applyStatusEffect", statusEffectId: "poisoned" }]);
    expect(getEffectiveSkill(bomb, 50).effects).toEqual([{ kind: "applyStatusEffect", statusEffectId: "poisoned-ii" }]);
    expect(getEffectiveSkill(bomb, 75).effects).toEqual([{ kind: "applyStatusEffect", statusEffectId: "poisoned-iii" }]);
  });

  test("Poison Coat's on-hit rider always applies plain poisoned, even at rank 2/3", () => {
    const coat = getSkill("rogue-poison-coat");
    expect(getStatusEffect("poison-coat-ii").onHitStatusEffectId).toBe("poisoned");
    expect(getStatusEffect("poison-coat-iii").onHitStatusEffectId).toBe("poisoned");

    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.unlockedSkillIds.push(coat.id);
    rogue.level = 15;
    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: rogue.id };
    queueAction(combat, self, "rogue-poison-coat", [self], ctx);
    resolveRound(combat, ctx);
    expect(rogue.activeStatusEffects.some((s) => s.statusEffectId === "poison-coat-iii")).toBe(true);

    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    queueAction(combat, self, "rogue-knife-throw", [enemyRef], ctx);
    resolveRound(combat, ctx);
    const enemyActor = getActorByRef(enemyRef, ctx);
    expect(enemyActor.activeStatusEffects.some((s) => s.statusEffectId === "poisoned")).toBe(true);
    expect(enemyActor.activeStatusEffects.some((s) => s.statusEffectId === "poisoned-ii" || s.statusEffectId === "poisoned-iii")).toBe(false);
  });
});

describe("Acolyte skill ranks incl. effectsByRelation (docs/gameplay-decisions/10-skill-ranks-and-monster-skills.md §10.1)", () => {
  test("Heal ranks resolve heal 16/22/30 at lv1/7/15", () => {
    const skill = getSkill("acolyte-heal");
    expect(getEffectiveSkill(skill, 1).effects).toEqual([{ kind: "heal", amount: 16 }]);
    expect(getEffectiveSkill(skill, 7).effects).toEqual([{ kind: "heal", amount: 22 }]);
    expect(getEffectiveSkill(skill, 15).effects).toEqual([{ kind: "heal", amount: 30 }]);
  });

  test("Divine Descent ranks resolve effectsByRelation (ally heal+fear, enemy dmg) at lv35/70/100", () => {
    const skill = getSkill("acolyte-divine-descent");
    expect(getEffectiveSkill(skill, 35).effectsByRelation).toEqual({
      ally: [
        { kind: "heal", amount: 25 },
        { kind: "modifyStat", stat: "fear", amount: -15 },
      ],
      enemy: [{ kind: "damage", amount: 20 }],
    });
    expect(getEffectiveSkill(skill, 70).effectsByRelation).toEqual({
      ally: [
        { kind: "heal", amount: 30 },
        { kind: "modifyStat", stat: "fear", amount: -20 },
      ],
      enemy: [{ kind: "damage", amount: 25 }],
    });
    expect(getEffectiveSkill(skill, 100).effectsByRelation).toEqual({
      ally: [
        { kind: "heal", amount: 40 },
        { kind: "modifyStat", stat: "fear", amount: -25 },
      ],
      enemy: [{ kind: "damage", amount: 30 }],
    });
  });

  test("Purify ranks resolve the enemy-branch damage only, ally branch always removeStatusEffect", () => {
    const skill = getSkill("acolyte-purify");
    expect(getEffectiveSkill(skill, 10).effectsByRelation).toEqual({
      ally: [{ kind: "removeStatusEffect" }],
      enemy: [{ kind: "damage", amount: 15 }],
    });
    expect(getEffectiveSkill(skill, 45).effectsByRelation).toEqual({
      ally: [{ kind: "removeStatusEffect" }],
      enemy: [{ kind: "damage", amount: 27 }],
    });
  });
});

describe("regular monster skills (docs/gameplay-decisions/10-skill-ranks-and-monster-skills.md §10.2)", () => {
  test("Black Bat's Blood Drain has lifestealPercent 50", () => {
    expect(getMonsterSkill("blood-drain").effects).toEqual([{ kind: "damage", amount: 2, lifestealPercent: 50 }]);
  });

  test("Zombie's Regeneration is a self-heal", () => {
    const skill = getMonsterSkill("regeneration");
    expect(skill.target).toBe("self");
    expect(skill.effects).toEqual([{ kind: "heal", amount: 15 }]);
  });

  test("Slime's Acid Spit procs corroded, Spider's Web Spit procs webbed", () => {
    expect(getMonsterSkill("acid-spit").effects).toEqual([
      { kind: "damage", amount: 2 },
      { kind: "applyStatusEffect", statusEffectId: "corroded", chance: 0.5 },
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

  test("actionWeights.normal is 70/30 for the 8 randomly-triggered archetypes, 100/0 for Zombie/Skeleton Warrior", () => {
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

describe("aiPattern: \"defensive\" HP<40% self-skill fix (docs/gameplay-decisions/10-skill-ranks-and-monster-skills.md §10.3)", () => {
  test("a Zombie below 40% HP is biased toward self-casting Regeneration, but not deterministically (weighted, not 'always')", () => {
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

  test("a Zombie at/above 40% HP never self-casts (falls through to actionWeights, which never rolls skill for it)", () => {
    const { ctx } = makeCtx();
    const zombie = spawnInto(ctx, "zombie");
    zombie.hp = Math.ceil(zombie.maxHp * 0.4);
    const combat = startCombat("r1", [zombie.id], ctx, false);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("Regeneration"))).toBe(false);
  });

  test("a Skeleton Warrior below 40% HP is biased toward Guard Stance but can still attack (fixes the permanently-passive bug)", () => {
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

  test("other defensive archetypes with empty skillIds are unaffected even below 40% HP (regression)", () => {
    const { ctx } = makeCtx();
    const knight = spawnInto(ctx, "zombie-knight");
    knight.hp = Math.floor(knight.maxHp * 0.1);
    const combat = startCombat("r1", [knight.id], ctx, false);
    const hpBefore = knight.hp;
    resolveRound(combat, ctx);
    expect(getArchetype("zombie-knight").skillIds).toEqual([]);
    expect(knight.hp).toBe(hpBefore);
  });

  test("the low-HP self-skill branch only applies at normal tier, even if the archetype has skillIds (regression guard)", () => {
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

describe("regular monster skills end-to-end (docs/gameplay-decisions/10-skill-ranks-and-monster-skills.md §10.2)", () => {
  function queueTrivialPartyActions(ctx: EngineContext, combat: ReturnType<typeof startCombat>) {
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
  }

  test("Slime's Acid Spit, when it fires and procs, applies corroded (damage + defense debuff per turn)", () => {
    let found = false;
    for (let seed = 0; seed < 100 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const slime = spawnMonster("slime", 1);
      slime.maxHp = 500;
      slime.hp = 500;
      ctx.monsters.push(slime);
      const combat = startCombat("r1", [slime.id], ctx, false);
      queueTrivialPartyActions(ctx, combat);
      resolveRound(combat, ctx);
      if (!combat.log.some((l) => l.text.includes("Acid Spit"))) continue;
      const target = ctx.party.find((p) => p.activeStatusEffects.some((s) => s.statusEffectId === "corroded"));
      if (!target) continue;
      found = true;
    }
    expect(found).toBe(true);
  });

  test("Spider's Web Spit, when it fires and procs, applies webbed (speed -20 per turn)", () => {
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

  test("Black Bat's Blood Drain, when it fires, damages the target and heals the bat via lifesteal", () => {
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

