import { describe, test, expect } from "bun:test";
import { CLASSES, getClass, getSkill } from "../src/data/classes";
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
import { resolveSkillEffect, getFearTier, rollLosesControl, isActorAlive, tickStatusEffects, mitigatedOffense } from "../src/engine/resolver";
import type { LogEntry } from "../src/types";
import { connectedRooms, getRoom, moveToRoom } from "../src/engine/dungeon";
import { spawnMonster } from "../src/data/monsters";
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

function makeCtx(seed = 1) {
  const rng = new Rng(seed);
  const { floor, monsters } = createFloor(rng);
  const party = CLASSES.map((cls, i) => createCharacter(`p${i + 1}`, cls.name, cls));
  const ctx: EngineContext = { party, monsters, rng, inventory: {} };
  return { ctx, floor, monsters, party };
}

/** Spawns a specific archetype straight into ctx.monsters — the random floor's composition now
 * draws from a much larger archetype pool (11+ regular, several guard-only), so tests that need a
 * particular monster (e.g. the tanky skeleton-guard, or exactly 2 dungeon-rats) can't rely on it
 * showing up by chance anymore. */
function spawnInto(ctx: EngineContext, archetypeId: string, depth = 1) {
  const m = spawnMonster(archetypeId, depth);
  ctx.monsters.push(m);
  return m;
}

/** Picks a singleEnemy skill if the character has one unlocked, else falls back to whatever's available. */
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
    const attacker = ctx.party[0]!; // vanguard, attack 14
    const target = ctx.party[1]!; // mage, defense 4
    const before = target.hp;
    resolveSkillEffect({ kind: "damage", amount: 10 }, attacker, target, { log: [] });
    expect(before - target.hp).toBe(Math.max(1, Math.round(10 + mitigatedOffense(attacker.attack, target.defense))));
  });

  test("damage is floored at 1 even vs. huge defense", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[1]!; // low attack
    const target = ctx.party[0]!; // high defense
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

    tickStatusEffects(vanguard, { log }); // 1 -> 0, expires
    expect(vanguard.defense).toBe(baseDef);
    expect(vanguard.activeStatusEffects).toHaveLength(0);
  });

  test("a status effect's own recurring damage tick (DoT, e.g. Trúng Độc) is flat, not attack-minus-defense (regression: source===target self-tick was going through the full damage formula)", () => {
    const { ctx } = makeCtx();
    const victim = ctx.monsters[0]!; // has nonzero attack/defense, unlike a flat 0-0 stub
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poisoned" }, victim, victim, { log });
    const before = victim.hp;
    tickStatusEffects(victim, { log });
    expect(before - victim.hp).toBe(4); // status-effects.json: poisoned perTurnEffects damage amount 4, flat
  });

  test("re-applying an active status effect refreshes duration instead of stacking (bong: 2-turn debuff)", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const log: LogEntry[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "burning" }, vanguard, vanguard, { log });
    tickStatusEffects(vanguard, { log }); // 2 -> 1
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "burning" }, vanguard, vanguard, { log });
    expect(vanguard.activeStatusEffects).toHaveLength(1);
    expect(vanguard.activeStatusEffects[0]!.turnsRemaining).toBe(2); // refreshed to full duration, not stacked to a 2nd entry
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
    const alwaysTrue = () => 0; // roll < 0.25 always true
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
    // Tanky enough (skeleton-guard, 55hp) that no single hit ends combat mid-round,
    // so every character's turn actually runs and shows up in the log.
    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      const err = queueAction(combat, ref, skillId, targets, ctx);
      expect(err).toBeNull();
    }
    resolveRound(combat, ctx);
    const rogueLine = combat.log.findIndex((l) => l.text.includes("Rogue") && l.text.includes("dùng"));
    const vanguardLine = combat.log.findIndex((l) => l.text.includes("Vanguard") && l.text.includes("dùng"));
    expect(rogueLine).toBeGreaterThanOrEqual(0);
    expect(vanguardLine).toBeGreaterThanOrEqual(0);
    expect(rogueLine).toBeLessThan(vanguardLine); // rogue speed 16 > vanguard speed 8
  });

  test("isBuff skills get +20 speed for this round's turn order only, not a persistent stat change (§4.7)", () => {
    const { ctx } = makeCtx();
    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    queueAction(combat, self, "vanguard-shield-guard", [self], ctx); // isBuff — vanguard (speed 8) would normally act last
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === vanguard.id) continue;
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    const vanguardLine = combat.log.findIndex((l) => l.text.includes("Vanguard") && l.text.includes("dùng"));
    const rogueLine = combat.log.findIndex((l) => l.text.includes("Rogue") && l.text.includes("dùng"));
    expect(vanguardLine).toBeGreaterThanOrEqual(0);
    expect(rogueLine).toBeGreaterThanOrEqual(0);
    expect(vanguardLine).toBeLessThan(rogueLine); // +20 (=28) now outranks rogue's speed 16
    expect(vanguard.speed).toBe(8); // the bonus never touches the real stat
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
    combat.queuedActions = []; // simulate a fresh round without going through resolution
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

    queueAction(combat, self, "vanguard-shield-guard", [self], ctx); // cooldownTurns 2
    resolveRound(combat, ctx); // round 1 -> 2, cooldown 2 -> 1
    expect(vanguard.cooldownsRemaining["vanguard-shield-guard"]).toBe(1);
    expect(queueAction(combat, self, "vanguard-shield-guard", [self], ctx)).not.toBeNull(); // still cooling down

    resolveRound(combat, ctx); // round 2 -> 3, cooldown 1 -> 0
    expect(vanguard.cooldownsRemaining["vanguard-shield-guard"]).toBe(0);
    expect(queueAction(combat, self, "vanguard-shield-guard", [self], ctx)).toBeNull(); // usable again
  });

  test("dead singleEnemy target redirects to another living enemy instead of fizzling", () => {
    const { ctx } = makeCtx();
    const rats = [spawnInto(ctx, "dungeon-rat"), spawnInto(ctx, "dungeon-rat")];
    const combat = startCombat("r1", rats.map((m) => m.id), ctx, false);
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    const [enemyA, enemyB] = livingMonsterRefs(combat, ctx);
    // Kill enemyA "before" rogue's turn by zeroing its hp directly, simulating an earlier actor finishing it off.
    const targetA = getActorByRef(enemyA!, ctx);
    targetA.hp = 0;
    queueAction(combat, { kind: "character", id: rogue.id }, "rogue-stab", [enemyA!], ctx);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) continue;
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("mục tiêu không còn"))).toBe(false);
    const enemyBActor = getActorByRef(enemyB!, ctx);
    expect(enemyBActor.hp).toBeLessThan(enemyBActor.maxHp); // redirected hit landed on the surviving rat
  });

  test("combat resolves to victory once the last monster dies, even across multiple rounds", () => {
    const { ctx } = makeCtx();
    const oneRat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [oneRat.id], ctx, false);
    // Rats now have enough HP (2026-08-16 rebalance) to survive a round or two of basic attacks,
    // so resolve rounds until the fight actually ends instead of assuming a 1-round kill.
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
    // Both are now 1-turn buffs, so by the time resolveRound's end-of-round tick runs they've
    // already expired again (correct — that's the "buff luôn 1 lượt" rule) — assert via the log
    // instead of activeStatusEffects, which is empty again by the time resolveRound returns.
    expect(combat.log.some((l) => l.text.includes("nhận hiệu ứng Guard"))).toBe(true);
    expect(combat.log.some((l) => l.text.includes("nhận hiệu ứng Taunt"))).toBe(true);
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
    expect(combat.log.some((l) => l.text.includes("đang choáng"))).toBe(true);
    expect(combat.log.some((l) => l.text.includes("Rogue") && l.text.includes("dùng"))).toBe(false);
  });

  test("Tẩm Độc buff makes a landed damage hit auto-apply Trúng Độc (on-hit rider, §4.2)", () => {
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
    // skeleton-guard (55hp), not dungeon-rat (16hp) — Purify's enemy branch (15 + mitigatedOffense(magicPower, defense))
    // would one-shot a rat and end combat before the 2nd (ally-branch) queueAction in this test runs.
    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const acolyteRef: CombatantRef = { kind: "character", id: acolyte.id };

    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    const hpBefore = getActorByRef(enemyRef, ctx).hp;
    expect(queueAction(combat, acolyteRef, "acolyte-purify", [enemyRef], ctx)).toBeNull();
    resolveRound(combat, ctx);
    expect(getActorByRef(enemyRef, ctx).hp).toBeLessThan(hpBefore); // enemy branch: damage 15

    const allyRef: CombatantRef = { kind: "character", id: vanguard.id };
    expect(queueAction(combat, acolyteRef, "acolyte-purify", [allyRef], ctx)).toBeNull();
    resolveRound(combat, ctx);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "burning")).toBe(false); // ally branch: removeStatusEffect
  });

  test("ultimate skills always hit even at high fear, but scale damage down instead of missing", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("vanguard-sword-judgment"); // unlockLevel 35 — force-unlock for the test
    vanguard.mp = 999;
    vanguard.survival.fear = 99; // Hoảng Loạn (tier 3): normal skills would get -20% accuracy, -15% dmg
    const skeleton = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [skeleton.id], ctx, false);
    const enemyRef: CombatantRef = { kind: "monster", id: skeleton.id };
    const enemyActor = getActorByRef(enemyRef, ctx);
    const fullPowerDamage = Math.max(1, 30 + mitigatedOffense(vanguard.attack, enemyActor.defense));

    queueAction(combat, { kind: "character", id: vanguard.id }, "vanguard-sword-judgment", [enemyRef], ctx);
    const hpBefore = enemyActor.hp;
    resolveRound(combat, ctx);
    const actualDamage = hpBefore - enemyActor.hp;

    expect(combat.log.some((l) => l.text.includes("trượt"))).toBe(false); // ultimate never misses
    expect(actualDamage).toBeGreaterThan(0);
    expect(actualDamage).toBeLessThan(fullPowerDamage); // fear-scaled effectiveness kicked in instead
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
    // Unlike the old hardcoded chance rolls, elite/boss can now also fall back to a flat "tấn công"
    // (actionWeights.elite/boss.basicAttack) — see docs request "boss và elite cũng có thể đánh thường".
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
        if (monsterLines.some((l) => l.text.includes("Cleaving Strike") || l.text.includes("Sweeping Cleave") || l.text.includes("kết liễu") || l.text.includes("Crush"))) {
          sawNamedKit = true;
        }
        if (monsterLines.some((l) => l.text.includes("tấn công"))) sawBasicAttack = true;
      }
    }
    expect(sawNamedKit).toBe(true);
    expect(sawBasicAttack).toBe(true);
  });

  test("normal-tier skeleton-guard is unaffected — still uses the old flat attack (regression)", () => {
    const { ctx } = makeCtx(1);
    const monster = spawnMonster("skeleton-guard", 1); // tier defaults to "normal"
    ctx.monsters.push(monster);
    const combat = startCombat("r1", [monster.id], ctx, false);
    queueTrivialActions(ctx, combat);
    resolveRound(combat, ctx);
    const monsterLines = combat.log.filter((l) => l.text.startsWith(monster.name));
    expect(monsterLines.some((l) => l.text.includes("tấn công"))).toBe(true);
    expect(monsterLines.some((l) => l.text.includes("Cleaving Strike") || l.text.includes("Sweeping Cleave"))).toBe(false);
  });

  test("boss telegraphs Đòn Kết Liễu 1 turn ahead, locking in a target, then releases a huge flat hit on release (not HP%-based)", () => {
    const { ctx } = makeCtx();
    const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });
    // Pinned well above its natural depth-1 HP so it reliably survives to the charge/release round
    // regardless of the party's exact per-round damage (which depends on the attack/defense damage
    // formula, not the mechanic under test here) — this test is about the execute telegraph, not a DPS race.
    boss.maxHp = 1000;
    boss.hp = 1000;
    ctx.monsters.push(boss);
    const combat = startCombat("r1", [boss.id], ctx, false);

    // Cooldown starts at EXECUTE_COOLDOWN_TURNS (§6.12) — run rounds until the charge/warning turn fires.
    let charged = false;
    for (let round = 0; round < 10 && combat.phase !== "over" && !charged; round++) {
      queueTrivialActions(ctx, combat);
      resolveRound(combat, ctx);
      charged = combat.log.some((l) => l.text.includes("bắt đầu tích lực"));
    }
    expect(charged).toBe(true);
    expect(boss.isChargingExecute).toBe(true);
    const markedTarget = ctx.party.find((p) => p.id === boss.executeTargetId);
    expect(markedTarget).toBeDefined();
    markedTarget!.hp = markedTarget!.maxHp; // reset to full so the release's damage is measured cleanly, independent of whatever chip damage landed during the charge-up rounds

    const hpBefore = markedTarget!.hp;
    queueTrivialActions(ctx, combat);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("tung đòn kết liễu đã tích lực") && l.text.includes(markedTarget!.name))).toBe(true);
    // §6.12: fixed, very high damage regardless of the target's HP going in (not a %-HP trigger) —
    // amount 71 (dominant over mitigatedOffense(boss.attack, target.defense) at low level) comfortably exceeds half a squishy class's maxHp.
    const damageDealt = Math.max(0, hpBefore - markedTarget!.hp);
    expect(damageDealt).toBeGreaterThan(markedTarget!.maxHp * 0.5);
    expect(boss.isChargingExecute).toBe(false); // resets after releasing
    expect(boss.executeCooldownTurns).toBeGreaterThan(0); // back on cooldown, won't charge again immediately
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
      expect(hitCount).toBe(hpBefore.size); // every character alive before the round took damage
    }
    expect(found).toBe(true); // cleave should fire at least once across 50 seeds at a 30% chance/round
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
    expect(found).toBe(true); // debuff should fire at least once across 50 seeds at a 30% chance/round
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
    vanguard.hp = vanguard.maxHp - 30; // otherwise heal clamps at maxHp and the log line reads "hồi 0 HP."
    ctx.inventory["small-health-potion"] = 1;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0; // keep vanguard's hp deterministic regardless of turn order (damage still floors at 1)
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    const err = queueItemAction(combat, self, "small-health-potion", [self], ctx);
    expect(err).toBeNull();
    expect(ctx.inventory["small-health-potion"]).toBe(0); // spent at queue time, like skill MP (technical-decisions.md §2)
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("hồi 30 HP"))).toBe(true);
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
    expect(before - target.hp).toBe(8); // 4 base * 2 multiplier
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
    expect(game.equipArtifact(c.id, "heart-of-stone")).not.toBeNull(); // 4th slot rejected
    expect(game.state.unequippedArtifactIds).toEqual(["heart-of-stone"]);

    expect(game.unequipArtifact(c.id, "sharp-claw")).toBeNull();
    expect(c.equippedArtifactIds).toHaveLength(2);
    expect(game.state.unequippedArtifactIds).toContain("sharp-claw");
  });

  test("statBoost recomputes attack from scratch and survives a level-up", () => {
    const game = new Game(2);
    const c = game.state.party[0]!;
    const baseAttack = c.attack;
    game.state.unequippedArtifactIds.push("iron-gauntlet"); // +3 attack
    expect(game.equipArtifact(c.id, "iron-gauntlet")).toBeNull();
    expect(c.attack).toBe(baseAttack + 3);

    applyPartyExp(game.state, 999999);
    expect(c.level).toBeGreaterThan(1);
    expect(c.attack).toBe(statsForLevel(getClass(c.classId), c.level).attack + 3);
  });

  test("rollDodge fires close to the equipped artifact's chance", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedArtifactIds.push("featherweight-boots"); // dodgeChance 6%
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
    c.equippedArtifactIds.push("immortal-heart"); // reflectDamage 15 + statBoost defense+10 + statBoost maxHp+60
    expect(totalReflectDamagePercent(c)).toBe(15);
    expect(artifactStatBoostSum(c).defense).toBe(10);
    expect(artifactStatBoostSum(c).maxHp).toBe(60);

    c.equippedArtifactIds.push("reapers-covenant"); // healOnKill 25 + lifesteal 8
    expect(totalHealOnKill(c)).toBe(25);
    expect(totalLifestealPercent(c)).toBe(8);

    c.equippedArtifactIds.push("thunder-totem", "thunder-totem"); // 2 copies -> 2 separate auto-damage ticks
    expect(autoDamageAmounts(c)).toEqual([6, 6]);
  });

  test("totalExpBoostPercent is party-wide; fearResist/cooldownReduction/survivalDrainReduction are per-character", () => {
    const { ctx } = makeCtx();
    ctx.party[0]!.equippedArtifactIds.push("scholars-insight"); // expBoost 15
    ctx.party[1]!.equippedArtifactIds.push("eternal-scholars-tome"); // expBoost 25 + cooldownReduction 1
    expect(totalExpBoostPercent(ctx.party)).toBe(40);
    expect(totalCooldownReduction(ctx.party[1]!)).toBe(1);
    expect(totalCooldownReduction(ctx.party[0]!)).toBe(0);

    ctx.party[0]!.equippedArtifactIds.push("pendant-of-calm"); // fearResist 10%
    expect(fearResistMultiplier(ctx.party[0]!)).toBeCloseTo(0.9);
    ctx.party[0]!.equippedArtifactIds.push("travelers-ration"); // survivalDrainReduction 15%
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
    expect(fearGainForRound(c, 1)).toBe(3); // not 1 + 3
  });

  test("fearGainForRound: scales +5%/floor depth, capped separately for base vs low-HP", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    expect(fearGainForRound(c, 40)).toBe(3); // 1 * (1 + 0.05*39) = 2.95 -> rounds to the 3 cap
    expect(fearGainForRound(c, 100)).toBe(3); // scaled value (5.95) is well past the cap, stays at 3
    c.hp = Math.floor(c.maxHp * 0.59);
    expect(fearGainForRound(c, 100)).toBe(6); // low-HP capped at 6
  });

  test("fearGainForRound: reduced by fearResist artifacts", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.hp = Math.floor(c.maxHp * 0.59);
    c.equippedArtifactIds.push("pendant-of-calm"); // fearResist 10%
    expect(fearGainForRound(c, 1)).toBe(3); // round(3 * 0.9) = round(2.7) = 3
  });

  test("applyRoundFear adds the gain and skips dead characters", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.survival.fear = 10;
    applyRoundFear(c, 1);
    expect(c.survival.fear).toBe(11);

    c.isAlive = false;
    applyRoundFear(c, 1);
    expect(c.survival.fear).toBe(11); // unchanged — dead characters don't accrue fear
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
    // isBossFight: false on purpose — proves the relief is driven by the monster's actual
    // tier, not by whichever room flag started the fight.
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
    c.equippedArtifactIds.push("travelers-ration"); // survivalDrainReduction 15%
    tickSurvivalOnAction(c, []);
    expect(c.survival.hunger).toBeCloseTo(99.1, 5); // 100 - round(1 * 0.85 * 10)/10
    expect(c.survival.thirst).toBeCloseTo(98.7, 5); // 100 - round(1.5 * 0.85 * 10)/10
  });

  test("reflectDamage: a monster's attack on the bearer reflects a percent back (combat.ts integration)", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.equippedArtifactIds.push("thorned-armor"); // reflectDamage 5%
    // Knock out every other party member so the rat's aggro-weighted target pick (pickAggroWeighted)
    // has only 1 living candidate — deterministic, instead of relying on Taunt's aggro edge winning
    // a weighted roll (it doesn't guarantee 100%, and the RNG draw it lands on shifts with unrelated
    // engine changes upstream in the same round).
    for (const c of ctx.party) {
      if (c.id !== vanguard.id) c.isAlive = false;
    }
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 200; // guarantee a hit big enough that 5% doesn't round down to 0
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    queueAction(combat, self, "vanguard-shield-guard", [self], ctx); // self-target, so only the rat's attack matters this round
    const ratHpBefore = rat.hp;
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("phản lại từ artifact"))).toBe(true);
    expect(rat.hp).toBeLessThan(ratHpBefore);
  });

  test("lifesteal and healOnKill heal the equipped character on their own damage (combat.ts integration)", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.equippedArtifactIds.push("reapers-covenant"); // healOnKill 25 + lifesteal 8%
    vanguard.hp = Math.max(1, vanguard.maxHp - 100); // room to see the heal in the log
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.hp = 1; // guaranteed killing blow
    const combat = startCombat("r1", [rat.id], ctx, false);
    const attackSkill = vanguard.unlockedSkillIds.map(getSkill).find((s) => s.target === "singleEnemy")!;
    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    queueAction(combat, { kind: "character", id: vanguard.id }, attackSkill.id, [enemyRef], ctx);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("nhờ artifact khi hạ gục địch"))).toBe(true);
    expect(combat.log.some((l) => l.text.includes("hồi") && l.text.includes("nhờ artifact") && !l.text.includes("khi hạ gục"))).toBe(true);
  });

  test("autoDamage fires at the start of the round, independent of turn order (combat.ts integration)", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.equippedArtifactIds.push("thunder-totem"); // autoDamage 6
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes(`Artifact của ${vanguard.name} gây 6 sát thương`))).toBe(true);
  });

  test("cooldownReduction shortens a skill's cooldown at queue time (combat.ts integration)", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.equippedArtifactIds.push("quickcharge-rune"); // cooldownReduction 1
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: rogue.id };
    expect(queueAction(combat, self, "rogue-poison-coat", [self], ctx)).toBeNull();
    expect(rogue.cooldownsRemaining["rogue-poison-coat"]).toBe(3); // base cooldown 4, minus 1
  });

  test("expBoost artifacts increase EXP gained on victory (Game integration)", () => {
    const game = new Game(3);
    const vanguard = game.state.party[0]!;
    game.state.unequippedArtifactIds.push("scholars-insight"); // expBoost 15%
    expect(game.equipArtifact(vanguard.id, "scholars-insight")).toBeNull();

    const rat = spawnMonster("dungeon-rat", 1);
    rat.hp = 1; // guaranteed 1-hit kill
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
    expect(game.state.combat!.log.some((l) => l.text.includes(`nhận ${expectedExp} EXP`))).toBe(true);
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
    game.state.activeEvent = { eventId: "merchant", offerArtifactIds: ["iron-gauntlet"] }; // common -> 15%
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
    expect(game.state.unequippedArtifactIds).not.toContain("sharp-claw"); // discarded, never entered anywhere

    const game2 = new Game(10);
    const c2 = game2.state.party[0]!;
    game2.state.unequippedArtifactIds.push("ancient-sword", "heart-of-stone", "eternal-vial");
    expect(game2.equipArtifact(c2.id, "ancient-sword")).toBeNull();
    expect(game2.equipArtifact(c2.id, "heart-of-stone")).toBeNull();
    expect(game2.equipArtifact(c2.id, "eternal-vial")).toBeNull();
    forceEventRoom(game2, "twin-altars");
    game2.state.activeEvent = { eventId: "twin-altars", offerArtifactIds: ["iron-gauntlet", "sharp-claw"] };
    expect(game2.twinAltarsChoose(0, c2.id)).not.toBeNull(); // full, no unequip pick given
    expect(game2.twinAltarsChoose(0, c2.id, "ancient-sword")).toBeNull();
    expect(c2.equippedArtifactIds).toContain("iron-gauntlet");
    expect(c2.equippedArtifactIds).not.toContain("ancient-sword");
    expect(game2.state.unequippedArtifactIds).toContain("ancient-sword"); // swapped out, back in the pool
  });

  test("sacrifice consumes the sacrificed artifact and rolls at/above its rarity; room only closes via sacrificeLeave", () => {
    const game = new Game(11);
    forceEventRoom(game, "sacrificial-circle");
    let sawSubUnique = false;
    for (let i = 0; i < 60 && !sawSubUnique; i++) {
      game.state.unequippedArtifactIds = ["scholars-insight"]; // unique tier, reset each iteration
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
    c.equippedArtifactIds.push("unstable-core"); // curseAggroBoost 25
    expect(curseAggroBoostSum(c)).toBe(25);

    const { ctx: ctx2 } = makeCtx();
    const c2 = ctx2.party[0]!;
    c2.equippedArtifactIds.push("shackle-of-hunger"); // curseDrainBoost 30%
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

