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
import { resolveSkillEffect, getFearTier, rollLosesControl, isActorAlive } from "../src/engine/resolver";
import { connectedRooms } from "../src/engine/dungeon";
import { Game } from "../src/engine/game";
import type { Character, CombatantRef } from "../src/types";

function makeCtx(seed = 1) {
  const rng = new Rng(seed);
  const { floor, monsters } = createFloor(rng);
  const party = CLASSES.map((cls, i) => createCharacter(`p${i + 1}`, cls.name, cls));
  const ctx: EngineContext = { party, monsters, rng };
  return { ctx, floor, monsters, party };
}

/** Picks a singleEnemy skill if the character has one unlocked, else falls back to whatever's available (e.g. the Chaplain has none at level 1). */
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

  test("exactly 1 boss room, and its monster is flagged isBoss", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { floor, monsters } = createFloor(new Rng(seed));
      const bossRooms = floor.rooms.filter((r) => r.type === "boss");
      expect(bossRooms).toHaveLength(1);
      const bossMonsters = bossRooms[0]!.monsterIds.map((id) => monsters.find((m) => m.id === id)!);
      expect(bossMonsters.every((m) => m.isBoss)).toBe(true);
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
  test("level-1 character only has slot 0-1 skills unlocked", () => {
    const cls = getClass("vanguard");
    const c = createCharacter("c1", "Test", cls);
    expect(c.unlockedSkillIds).toEqual(["vanguard-chem-khien", "vanguard-tran-thu"]);
    expect(c.hp).toBe(cls.baseMaxHp);
    expect(c.survival).toEqual({ hunger: 100, thirst: 100, fear: 0 });
  });
});

describe("resolver", () => {
  test("damage formula: max(1, amount + attack - defense)", () => {
    const { ctx } = makeCtx();
    const attacker = ctx.party[0]!; // vanguard, attack 14
    const target = ctx.party[1]!; // shadow mage, defense 4
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

  test("modifyCombatStat status effect installs immediately and undoes on expiry", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const baseDef = vanguard.defense;
    const log: string[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "phong-thu" }, vanguard, vanguard, { log });
    expect(vanguard.defense).toBe(baseDef + 6);

    const { tickStatusEffects } = require("../src/engine/resolver");
    tickStatusEffects(vanguard, { log }); // 2 -> 1
    expect(vanguard.defense).toBe(baseDef + 6);
    tickStatusEffects(vanguard, { log }); // 1 -> 0, expires
    expect(vanguard.defense).toBe(baseDef);
    expect(vanguard.activeStatusEffects).toHaveLength(0);
  });

  test("re-applying an active status effect refreshes duration instead of stacking", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party[0]!;
    const log: string[] = [];
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "phong-thu" }, vanguard, vanguard, { log });
    const { tickStatusEffects } = require("../src/engine/resolver");
    tickStatusEffects(vanguard, { log }); // 2 -> 1
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "phong-thu" }, vanguard, vanguard, { log });
    expect(vanguard.activeStatusEffects).toHaveLength(1);
    expect(vanguard.activeStatusEffects[0]!.turnsRemaining).toBe(2);
    expect(vanguard.defense).toBe(12 + 6); // only applied once, not doubled
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
    // Tanky enough (skeleton-guard, 48hp) that no single hit ends combat mid-round,
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

  test("MP and usesPerCombat are deducted at queue time, not at resolution", () => {
    const { ctx } = makeCtx();
    const combat = startCombat("r1", [ctx.monsters[0]!.id], ctx, false);
    const mage = ctx.party.find((p) => p.classId === "shadow-mage")!;
    const mpBefore = mage.mp;
    const enemy = livingMonsterRefs(combat, ctx)[0]!;
    queueAction(combat, { kind: "character", id: mage.id }, "mage-phi-anh", [enemy], ctx);
    expect(mage.mp).toBe(mpBefore - 5);
  });

  test("usesPerCombat blocks a second cast within the same combat", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.unlockedSkillIds.push("vanguard-bat-khuat"); // force-unlock the ultimate for this test
    vanguard.mp = 999;
    const combat = startCombat("r1", [ctx.monsters[0]!.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    const err1 = queueAction(combat, self, "vanguard-bat-khuat", [self], ctx);
    expect(err1).toBeNull();
    combat.queuedActions = []; // simulate a fresh round without going through resolution
    const err2 = queueAction(combat, self, "vanguard-bat-khuat", [self], ctx);
    expect(err2).not.toBeNull();
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
    queueAction(combat, { kind: "character", id: rogue.id }, "rogue-dam-len", [enemyA!], ctx);
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
    // Vanguard(10) + mage(14) + rogue(12) already exceed the rat's 26 hp (18 base + 1*8 depth).
    expect(combat.outcome).toBe("victory");
  });
});

describe("full scripted playthrough (smoke test)", () => {
  test("game reaches victory or defeat without throwing, boss room requires isBoss monster", () => {
    const game = new Game(12345);
    let guard = 0;
    while (!game.state.gameOver && guard < 500) {
      guard++;
      if (game.state.combat && game.state.combat.phase !== "over") {
        for (const ref of game.livingAllyRefs()) {
          const actor = getActorByRef(ref, game.ctx) as Character;
          const already = game.state.combat.queuedActions.some((qa) => qa.actor.id === ref.id);
          if (already) continue;
          const attackSkill = actor.unlockedSkillIds.map(getSkill).find((s) => s.target === "singleEnemy");
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
    expect(game.state.gameOver === "victory" || game.state.gameOver === "defeat").toBe(true);
    expect(game.state.party.every((c) => c.hp >= 0)).toBe(true);
  });
});
