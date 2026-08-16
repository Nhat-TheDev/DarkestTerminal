import { describe, test, expect } from "bun:test";
import { CLASSES, getClass, getSkill } from "../src/data/classes";
import { createFloor } from "../src/data/floor";
import { createCharacter } from "../src/engine/party";
import { Rng } from "../src/engine/rng";
import {
  getActorByRef,
  startCombat,
  queueAction,
  allLivingCharactersHaveQueuedActions,
  resolveRound,
  autoResolveTargets,
  livingMonsterRefs,
  livingCharacterRefs,
  isCombatOver,
  type EngineContext,
} from "../src/engine/combat";
import { resolveSkillEffect, getFearTier, rollLosesControl, isActorAlive, tickStatusEffects } from "../src/engine/resolver";
import { connectedRooms } from "../src/engine/dungeon";
import { Game } from "../src/engine/game";
import { spawnMonster } from "../src/data/monsters";
import type { Character, CombatantRef } from "../src/types";

function makeCtx(seed = 1) {
  const rng = new Rng(seed);
  const { floor, monsters } = createFloor(rng);
  const party = CLASSES.map((cls, i) => createCharacter(`p${i + 1}`, cls.name, cls));
  const ctx: EngineContext = { party, monsters, rng };
  return { ctx, floor, monsters, party };
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
    expect(c.unlockedSkillIds).toEqual(["vanguard-chem", "vanguard-che-chan", "vanguard-nem-khien"]);
    expect(c.hp).toBe(cls.baseMaxHp);
    expect(c.survival).toEqual({ hunger: 100, thirst: 100, fear: 0 });
  });
});

describe("resolver", () => {
  test("damage formula: max(1, amount + attack - defense)", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!; // vanguard, attack 14
    const target = ctx.party[1]!; // mage, defense 4
    const before = target.hp;
    resolveSkillEffect({ kind: "damage", amount: 10 }, attacker, target, { log: [] });
    expect(target.hp).toBe(before - (10 + 14 - 4));
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

  test("modifyCombatStat status effect installs immediately and undoes on expiry (phong-thu is now a 1-turn buff)", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const baseDef = vanguard.defense;
    const log: string[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "phong-thu" }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(baseDef + 6);

    tickStatusEffects(vanguard, { log }); // 1 -> 0, expires
    expect(vanguard.defense).toBe(baseDef);
    expect(vanguard.activeStatusEffects).toHaveLength(0);
  });

  test("a status effect's own recurring damage tick (DoT, e.g. Trúng Độc) is flat, not attack-minus-defense (regression: source===target self-tick was going through the full damage formula)", () => {
    const { ctx } = makeCtx();
    const victim = ctx.monsters[0]!; // has nonzero attack/defense, unlike a flat 0-0 stub
    const log: string[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "trung-doc" }, victim, victim, { log });
    const before = victim.hp;
    tickStatusEffects(victim, { log });
    expect(before - victim.hp).toBe(4); // status-effects.json: trung-doc perTurnEffects damage amount 4, flat
  });

  test("re-applying an active status effect refreshes duration instead of stacking (bong: 2-turn debuff)", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const log: string[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "bong" }, vanguard, vanguard, { log });
    tickStatusEffects(vanguard, { log }); // 2 -> 1
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "bong" }, vanguard, vanguard, { log });
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
    const tanky = ctx.monsters.find((m) => m.archetypeId === "skeleton-guard")!;
    const combat = startCombat("r1", [tanky.id], ctx, false);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      const err = queueAction(combat, ref, skillId, targets, ctx);
      expect(err).toBeNull();
    }
    resolveRound(combat, ctx);
    const rogueLine = combat.log.findIndex((l) => l.includes("Sát Thủ") && l.includes("dùng"));
    const vanguardLine = combat.log.findIndex((l) => l.includes("Cận Vệ") && l.includes("dùng"));
    expect(rogueLine).toBeGreaterThanOrEqual(0);
    expect(vanguardLine).toBeGreaterThanOrEqual(0);
    expect(rogueLine).toBeLessThan(vanguardLine); // rogue speed 16 > vanguard speed 8
  });

  test("isBuff skills get +20 speed for this round's turn order only, not a persistent stat change (§4.7)", () => {
    const { ctx } = makeCtx();
    const tanky = ctx.monsters.find((m) => m.archetypeId === "skeleton-guard")!;
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    queueAction(combat, self, "vanguard-che-chan", [self], ctx); // isBuff — vanguard (speed 8) would normally act last
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === vanguard.id) continue;
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    const vanguardLine = combat.log.findIndex((l) => l.includes("Cận Vệ") && l.includes("dùng"));
    const rogueLine = combat.log.findIndex((l) => l.includes("Sát Thủ") && l.includes("dùng"));
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
    queueAction(combat, { kind: "character", id: mage.id }, "mage-cau-lua", [enemy], ctx);
    expect(mage.mp).toBe(mpBefore - 5);
  });

  test("cooldownTurns is set at queue time and blocks re-queueing the same skill until it expires", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.mp = 999;
    const combat = startCombat("r1", [ctx.monsters[0]!.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    const err1 = queueAction(combat, self, "vanguard-che-chan", [self], ctx);
    expect(err1).toBeNull();
    expect(vanguard.cooldownsRemaining["vanguard-che-chan"]).toBe(2);
    combat.queuedActions = []; // simulate a fresh round without going through resolution
    const err2 = queueAction(combat, self, "vanguard-che-chan", [self], ctx);
    expect(err2).not.toBeNull();
  });

  test("cooldown decrements each round and re-allows the skill once it hits 0", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.mp = 999;
    const tanky = ctx.monsters.find((m) => m.archetypeId === "skeleton-guard")!;
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };

    queueAction(combat, self, "vanguard-che-chan", [self], ctx); // cooldownTurns 2
    resolveRound(combat, ctx); // round 1 -> 2, cooldown 2 -> 1
    expect(vanguard.cooldownsRemaining["vanguard-che-chan"]).toBe(1);
    expect(queueAction(combat, self, "vanguard-che-chan", [self], ctx)).not.toBeNull(); // still cooling down

    resolveRound(combat, ctx); // round 2 -> 3, cooldown 1 -> 0
    expect(vanguard.cooldownsRemaining["vanguard-che-chan"]).toBe(0);
    expect(queueAction(combat, self, "vanguard-che-chan", [self], ctx)).toBeNull(); // usable again
  });

  test("dead singleEnemy target redirects to another living enemy instead of fizzling", () => {
    const { ctx } = makeCtx();
    const rats = ctx.monsters.filter((m) => m.archetypeId === "dungeon-rat").slice(0, 2);
    const combat = startCombat("r1", rats.map((m) => m.id), ctx, false);
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    const [enemyA, enemyB] = livingMonsterRefs(combat, ctx);
    // Kill enemyA "before" rogue's turn by zeroing its hp directly, simulating an earlier actor finishing it off.
    const targetA = getActorByRef(enemyA!, ctx);
    targetA.hp = 0;
    queueAction(combat, { kind: "character", id: rogue.id }, "rogue-dam", [enemyA!], ctx);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) continue;
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.includes("mục tiêu không còn"))).toBe(false);
    const enemyBActor = getActorByRef(enemyB!, ctx);
    expect(enemyBActor.hp).toBeLessThan(enemyBActor.maxHp); // redirected hit landed on the surviving rat
  });

  test("full combat resolves to victory when all monsters are pre-defeated", () => {
    const { ctx } = makeCtx();
    const oneRat = ctx.monsters.filter((m) => m.archetypeId === "dungeon-rat")[0]!;
    const combat = startCombat("r1", [oneRat.id], ctx, false);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    expect(isCombatOver(combat, ctx)).toBe(true);
    // Every class now has a free singleEnemy basic attack (amount 0 = attack - defense): vanguard 13 +
    // mage 5 + rogue 15 + chaplain 5 = 38, already exceeds the rat's 16 hp at depth 1 (base stats, no
    // growth bonus yet — see levelGrowth.ts).
    expect(combat.outcome).toBe("victory");
  });
});

describe("new skill mechanics (docs/technical-decisions.md §4)", () => {
  test("Che Chắn applies both phong-thu and khieu-khich in a single cast", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const rat = ctx.monsters.filter((m) => m.archetypeId === "dungeon-rat")[0]!;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    queueAction(combat, self, "vanguard-che-chan", [self], ctx);
    resolveRound(combat, ctx);
    // Both are now 1-turn buffs, so by the time resolveRound's end-of-round tick runs they've
    // already expired again (correct — that's the "buff luôn 1 lượt" rule) — assert via the log
    // instead of activeStatusEffects, which is empty again by the time resolveRound returns.
    expect(combat.log.some((l) => l.includes("nhận hiệu ứng Phòng Thủ"))).toBe(true);
    expect(combat.log.some((l) => l.includes("nhận hiệu ứng Khiêu Khích"))).toBe(true);
  });

  test("stuns status makes the bearer skip their turn entirely (§4.3)", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    rogue.activeStatusEffects.push({ statusEffectId: "choang", turnsRemaining: 1 });
    const rat = ctx.monsters.filter((m) => m.archetypeId === "dungeon-rat")[0]!;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    queueAction(combat, { kind: "character", id: rogue.id }, "rogue-dam", [enemyRef], ctx);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) continue;
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.includes("đang choáng"))).toBe(true);
    expect(combat.log.some((l) => l.includes("Sát Thủ") && l.includes("dùng"))).toBe(false);
  });

  test("Tẩm Độc buff makes a landed damage hit auto-apply Trúng Độc (on-hit rider, §4.2)", () => {
    const { ctx } = makeCtx();
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    const tanky = ctx.monsters.find((m) => m.archetypeId === "skeleton-guard")!;
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: rogue.id };

    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) queueAction(combat, self, "rogue-tam-doc", [self], ctx);
      else {
        const { skillId, targets } = pickAnyAction(ctx, combat, ref);
        queueAction(combat, ref, skillId, targets, ctx);
      }
    }
    resolveRound(combat, ctx);
    expect(rogue.activeStatusEffects.some((s) => s.statusEffectId === "dao-doc")).toBe(true);

    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) queueAction(combat, self, "rogue-phong-dao", [enemyRef], ctx);
      else {
        const { skillId, targets } = pickAnyAction(ctx, combat, ref);
        queueAction(combat, ref, skillId, targets, ctx);
      }
    }
    resolveRound(combat, ctx);
    const enemyActor = getActorByRef(enemyRef, ctx);
    expect(enemyActor.activeStatusEffects.some((s) => s.statusEffectId === "trung-doc")).toBe(true);
  });

  test("dual-relation skill (Thanh Tẩy) damages when aimed at an enemy, cleanses when aimed at an ally", () => {
    const { ctx } = makeCtx();
    const chaplain = createCharacter("cp-test", "Tu Sĩ Test", getClass("chaplain"), 10);
    ctx.party.push(chaplain);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.activeStatusEffects.push({ statusEffectId: "bong", turnsRemaining: 2 });
    // skeleton-guard (55hp), not dungeon-rat (16hp) — Thanh Tẩy's enemy branch (15 + attack - defense)
    // would one-shot a rat and end combat before the 2nd (ally-branch) queueAction in this test runs.
    const tanky = ctx.monsters.find((m) => m.archetypeId === "skeleton-guard")!;
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const chaplainRef: CombatantRef = { kind: "character", id: chaplain.id };

    const enemyRef = livingMonsterRefs(combat, ctx)[0]!;
    const hpBefore = getActorByRef(enemyRef, ctx).hp;
    expect(queueAction(combat, chaplainRef, "chaplain-thanh-tay", [enemyRef], ctx)).toBeNull();
    resolveRound(combat, ctx);
    expect(getActorByRef(enemyRef, ctx).hp).toBeLessThan(hpBefore); // enemy branch: damage 15

    const allyRef: CombatantRef = { kind: "character", id: vanguard.id };
    expect(queueAction(combat, chaplainRef, "chaplain-thanh-tay", [allyRef], ctx)).toBeNull();
    resolveRound(combat, ctx);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "bong")).toBe(false); // ally branch: removeStatusEffect
  });

  test("ultimate skills always hit even at high fear, but scale damage down instead of missing", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("vanguard-giang-kiem"); // unlockLevel 35 — force-unlock for the test
    vanguard.mp = 999;
    vanguard.survival.fear = 99; // Hoảng Loạn (tier 3): normal skills would get -20% accuracy, -15% dmg
    const skeleton = ctx.monsters.find((m) => m.archetypeId === "skeleton-guard")!;
    const combat = startCombat("r1", [skeleton.id], ctx, false);
    const enemyRef: CombatantRef = { kind: "monster", id: skeleton.id };
    const enemyActor = getActorByRef(enemyRef, ctx);
    const fullPowerDamage = Math.max(1, 30 + vanguard.attack - enemyActor.defense);

    queueAction(combat, { kind: "character", id: vanguard.id }, "vanguard-giang-kiem", [enemyRef], ctx);
    const hpBefore = enemyActor.hp;
    resolveRound(combat, ctx);
    const actualDamage = hpBefore - enemyActor.hp;

    expect(combat.log.some((l) => l.includes("trượt"))).toBe(false); // ultimate never misses
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

  test("elite and boss use their named skill kit instead of the old flat 'tấn công' attack", () => {
    for (let seed = 0; seed < 10; seed++) {
      for (const tier of ["elite", "boss"] as const) {
        const { ctx } = makeCtx(seed);
        const monster = spawnMonster("skeleton-guard", 1, { tier });
        ctx.monsters.push(monster);
        const combat = startCombat("r1", [monster.id], ctx, false);
        queueTrivialActions(ctx, combat);
        resolveRound(combat, ctx);
        const monsterLines = combat.log.filter((l) => l.startsWith(monster.name));
        expect(monsterLines.some((l) => l.includes("Chém Hạ Gục") || l.includes("Chém Quét") || l.includes("kết liễu") || l.includes("Nghiền Nát"))).toBe(true);
        expect(monsterLines.some((l) => l.includes("tấn công"))).toBe(false);
      }
    }
  });

  test("normal-tier skeleton-guard is unaffected — still uses the old flat attack (regression)", () => {
    const { ctx } = makeCtx(1);
    const monster = spawnMonster("skeleton-guard", 1); // tier defaults to "normal"
    ctx.monsters.push(monster);
    const combat = startCombat("r1", [monster.id], ctx, false);
    queueTrivialActions(ctx, combat);
    resolveRound(combat, ctx);
    const monsterLines = combat.log.filter((l) => l.startsWith(monster.name));
    expect(monsterLines.some((l) => l.includes("tấn công"))).toBe(true);
    expect(monsterLines.some((l) => l.includes("Chém Hạ Gục") || l.includes("Chém Quét"))).toBe(false);
  });

  test("boss telegraphs Đòn Kết Liễu 1 turn ahead, locking in a target, then releases a huge flat hit on release (not HP%-based)", () => {
    const { ctx } = makeCtx();
    const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });
    ctx.monsters.push(boss);
    const combat = startCombat("r1", [boss.id], ctx, false);

    // Cooldown starts at EXECUTE_COOLDOWN_TURNS (§6.12) — run rounds until the charge/warning turn fires.
    let charged = false;
    for (let round = 0; round < 10 && combat.phase !== "over" && !charged; round++) {
      queueTrivialActions(ctx, combat);
      resolveRound(combat, ctx);
      charged = combat.log.some((l) => l.includes("bắt đầu tích lực"));
    }
    expect(charged).toBe(true);
    expect(boss.isChargingExecute).toBe(true);
    const markedTarget = ctx.party.find((p) => p.id === boss.executeTargetId);
    expect(markedTarget).toBeDefined();
    markedTarget!.hp = markedTarget!.maxHp; // reset to full so the release's damage is measured cleanly, independent of whatever chip damage landed during the charge-up rounds

    const hpBefore = markedTarget!.hp;
    queueTrivialActions(ctx, combat);
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.includes("tung đòn kết liễu đã tích lực") && l.includes(markedTarget!.name))).toBe(true);
    // §6.12: fixed, very high damage regardless of the target's HP going in (not a %-HP trigger) —
    // amount 71 + boss.attack - target.defense comfortably exceeds half a squishy class's maxHp.
    const damageDealt = Math.max(0, hpBefore - markedTarget!.hp);
    expect(damageDealt).toBeGreaterThan(markedTarget!.maxHp * 0.5);
    expect(boss.isChargingExecute).toBe(false); // resets after releasing
    expect(boss.executeCooldownTurns).toBeGreaterThan(0); // back on cooldown, won't charge again immediately
  });

  test("elite cleave (Chém Quét), when it fires, damages every living character in the same round", () => {
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const elite = spawnMonster("skeleton-guard", 1, { tier: "elite" });
      ctx.monsters.push(elite);
      const combat = startCombat("r1", [elite.id], ctx, false);
      queueTrivialActions(ctx, combat);
      const hpBefore = new Map(ctx.party.filter((c) => c.isAlive).map((c) => [c.id, c.hp]));
      resolveRound(combat, ctx);
      if (!combat.log.some((l) => l.includes("Chém Quét"))) continue;
      found = true;
      const hitCount = [...hpBefore.entries()].filter(([id, hp]) => {
        const c = ctx.party.find((p) => p.id === id)!;
        return c.hp < hp;
      }).length;
      expect(hitCount).toBe(hpBefore.size); // every character alive before the round took damage
    }
    expect(found).toBe(true); // cleave should fire at least once across 50 seeds at a 30% chance/round
  });

  test("boss debuff (Nghiền Nát) applies suy-yeu, weakening the target's defense", () => {
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const { ctx } = makeCtx(seed);
      const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });
      ctx.monsters.push(boss);
      const combat = startCombat("r1", [boss.id], ctx, false);
      queueTrivialActions(ctx, combat);
      resolveRound(combat, ctx);
      if (!combat.log.some((l) => l.includes("Nghiền Nát"))) continue;
      found = true;
      const debuffed = ctx.party.find((c) => c.activeStatusEffects.some((s) => s.statusEffectId === "suy-yeu"));
      expect(debuffed).toBeDefined();
    }
    expect(found).toBe(true); // debuff should fire at least once across 50 seeds at a 30% chance/round
  });
});

describe("full scripted playthrough (smoke test)", () => {
  // docs/gameplay-decisions.md §6.9/6.10: floor depth is uncapped (roguelite —
  // clearing the guard room always advances instead of ending the game), so a
  // bounded smoke test can't expect to reach gameOver at all — early floors
  // are comfortably survivable (over-leveled) **for a bot that heals when
  // hurt** (§6.12: elite/boss can now meaningfully threaten HP, unlike the
  // old near-harmless numbers — a pure attack-every-turn bot is no longer a
  // fair floor-1 baseline), and death only becomes likely
  // many floors deeper than this guard can reach. Assert progression + the
  // "victory" outcome being unreachable instead of "run finishes".
  test("descends through many floors without throwing; gameOver, if reached, is only ever defeat", () => {
    const game = new Game(12345);
    const startingDepth = game.state.floor.depth;
    let guard = 0;
    while (!game.state.gameOver && guard < 2000) {
      guard++;
      if (game.state.combat && game.state.combat.phase !== "over") {
        const livingAllies = game.livingAllyRefs().map((r) => getActorByRef(r, game.ctx) as Character);
        for (const ref of game.livingAllyRefs()) {
          const actor = getActorByRef(ref, game.ctx) as Character;
          const already = game.state.combat.queuedActions.some((qa) => qa.actor.id === ref.id);
          if (already) continue;

          // §6.12: elite/boss can now meaningfully threaten HP, so a bot that never heals isn't a fair
          // baseline anymore — heal the most-injured ally when someone drops below half HP and this
          // character has a singleAlly heal skill unlocked, otherwise fall back to plain attacking.
          const healSkill = actor.unlockedSkillIds.map(getSkill).find((s) => s.target === "singleAlly" && s.effects?.some((e) => e.kind === "heal"));
          const mostInjured = livingAllies.reduce((worst, c) => (c.hp / c.maxHp < worst.hp / worst.maxHp ? c : worst));
          if (healSkill && actor.mp >= healSkill.mpCost && mostInjured.hp / mostInjured.maxHp < 0.5) {
            game.queue(ref, healSkill.id, [{ kind: "character", id: mostInjured.id }]);
            continue;
          }

          // Picks the strongest affordable singleEnemy skill instead of just the first one (usually the
          // free basic attack) — §6.12's elite defense is high enough that a low-attack class's basic
          // attack alone barely scratches it, so "always use the cheapest option" is no longer a fair bot.
          const affordable = actor.unlockedSkillIds
            .map(getSkill)
            .filter((s) => s.target === "singleEnemy" && actor.mp >= s.mpCost && (actor.cooldownsRemaining[s.id] ?? 0) === 0);
          const skillAmount = (s: (typeof affordable)[number]) => s.effects?.reduce((sum, e) => sum + (e.kind === "damage" ? (e.amount ?? 0) : 0), 0) ?? 0;
          const attackSkill = affordable.reduce<(typeof affordable)[number] | undefined>(
            (best, s) => (!best || skillAmount(s) > skillAmount(best) ? s : best),
            undefined
          );
          const enemies = game.livingEnemyRefs();
          if (attackSkill && enemies.length > 0 && actor.mp >= attackSkill.mpCost) {
            game.queue(ref, attackSkill.id, [enemies[0]!]);
          } else {
            const cheap = actor.unlockedSkillIds.map(getSkill).find((s) => s.mpCost === 0) ?? actor.unlockedSkillIds.map(getSkill)[0]!;
            const targets = game.autoTargets(cheap.target, ref) ?? [ref];
            game.queue(ref, cheap.id, targets);
          }
        }
        if (game.readyToResolve()) game.resolve();
        continue;
      }
      game.clearFinishedCombat();
      if (game.state.gameOver) break;
      const choices = game.connectedRoomChoices().filter((r) => true);
      const next = choices.find((r) => !r.cleared) ?? choices[0];
      if (!next) break;
      game.move(next.id);
    }
    expect(game.state.gameOver).not.toBe("victory"); // boss-clear always advances the floor now, never ends the game
    expect(game.state.floor.depth).toBeGreaterThan(startingDepth); // actually descended at least once
    expect(game.state.party.every((c) => c.hp >= 0)).toBe(true);
  });
});
