import { describe, test, expect } from "bun:test";
import {
  startCombat,
  queueAction,
  resolveRound,
  livingCharacterRefs,
  livingMonsterRefs,
  livingTargetableMonsterRefs,
  autoResolveTargets,
  dismissOrphanedMonsterSummons,
  applySkillEffects,
} from "../src/engine/combat";
import { STATUS_EFFECTS } from "../src/data/statusEffects";
import { resolveSkillEffect, tickDotEffects } from "../src/engine/resolver";
import { applyArtifactReflectDamage } from "../src/engine/combatHooks";
import type { CombatantRef } from "../src/types";
import { MONSTER_SKILLS, spawnMonster } from "../src/data/monsters";
import { BALANCE } from "../src/data/balanceConfig";
import { runMonsterTurn } from "../src/engine/monsterAI";
import { makeCtx, pickAnyAction, spawnInto, sk, withFixture } from "./helpers";
import { CLASSES, getSkill, getEffectiveSkill } from "../src/data/classes";
import { createCharacter } from "../src/engine/party";

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
  const roomMonsterIds = [boss.id];
  const combat = startCombat("r1", roomMonsterIds, ctx, true);
  const turn = () => runMonsterTurn({ kind: "monster", id: boss.id }, combat, ctx);
  const addsOf = () => ctx.monsters.filter((m) => m.summonerId === boss.id);
  const round = () => {
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
  };
  return { ctx, boss, combat, turn, addsOf, round, roomMonsterIds };
}

const summonGoblins = (count: number) => sk("fx-summon", { target: "self", effects: [{ kind: "summonMonster", monsterArchetypeId: "goblin", count }] });
const summonKit = { actionWeights: { boss: { "fx-summon": 100 } } };

describe("summonMonster", () => {
  test("spawns adds up to the per-summoner cap, registered in the fight, rewarding nothing", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { ctx, boss, combat, turn, addsOf, roomMonsterIds } = bossFight();
      turn();
      const adds = addsOf();
      expect(adds.length).toBe(BALANCE.combat.maxSummonedMonsters);
      for (const add of adds) {
        expect(add.archetypeId).toBe("goblin");
        expect(add.tier).toBe("normal");
        expect(add.summonerId).toBe(boss.id);
        expect(add.expReward).toBe(0);
        expect(combat.combatants.some((c) => c.ref.kind === "monster" && c.ref.id === add.id)).toBe(true);
        expect(roomMonsterIds).not.toContain(add.id);
      }
      expect(new Set(ctx.monsters.map((m) => m.id)).size).toBe(ctx.monsters.length);
      expect(combat.log.filter((l) => l.text.includes("calls up")).length).toBe(adds.length);
    });
  });

  test("casting again at the cap adds nothing", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { combat, turn, addsOf } = bossFight();
      turn();
      const first = addsOf().length;
      turn();
      expect(addsOf().length).toBe(first);
      expect(combat.log.filter((l) => l.text.includes("calls up")).length).toBe(first);
    });
  });

  test("an add that falls frees room under the cap for the next cast", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { ctx, turn, addsOf } = bossFight();
      turn();
      addsOf()[0]!.hp = 0;
      turn();
      expect(addsOf().filter((m) => m.hp > 0).length).toBe(BALANCE.combat.maxSummonedMonsters);
      expect(new Set(ctx.monsters.map((m) => m.id)).size).toBe(ctx.monsters.length);
    });
  });

  test("adds are in the next round's turn order", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { combat, turn, addsOf, round } = bossFight();
      turn();
      round();
      expect(addsOf().length).toBeGreaterThan(0);
      for (const add of addsOf()) expect(combat.turnQueue.some((r) => r.kind === "monster" && r.id === add.id)).toBe(true);
    });
  });

  test("adds fall when their summoner does, one log line each", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { ctx, boss, combat, turn, addsOf } = bossFight();
      turn();
      expect(addsOf().length).toBeGreaterThan(0);
      boss.hp = 0;
      dismissOrphanedMonsterSummons(combat, ctx, combat.log);
      for (const add of addsOf()) expect(add.hp).toBe(0);
      expect(combat.log.filter((l) => l.text.includes("does not outlast")).length).toBe(addsOf().length);
    });
  });

  test("killing the summoner with adds alive wins the fight in that same round", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { boss, combat, turn, addsOf, round } = bossFight();
      turn();
      expect(addsOf().some((a) => a.hp > 0)).toBe(true);
      boss.hp = 1;
      round();
      expect(combat.outcome).toBe("victory");
      expect(addsOf().every((a) => a.hp === 0)).toBe(true);
    });
  });
});

describe("untargetable monsters", () => {
  function withAirborne(body: () => void) {
    STATUS_EFFECTS.push({ id: "fx-airborne", name: "Airborne", description: "x", perTurnEffects: [], untargetable: true } as any);
    try {
      body();
    } finally {
      STATUS_EFFECTS.splice(STATUS_EFFECTS.findIndex((s) => s.id === "fx-airborne"), 1);
    }
  }
  const airborne = { statusEffectId: "fx-airborne", turnsRemaining: 99 };

  function airborneFight() {
    const { ctx } = makeCtx(1);
    const boss = spawnMonster("giant-spider", 1, { tier: "boss" });
    boss.hp = boss.maxHp = 100000;
    boss.speed = 1;
    boss.activeStatusEffects.push({ ...airborne });
    ctx.monsters.push(boss);
    const combat = startCombat("r1", [boss.id], ctx, true);
    const ref = (classId: string): CombatantRef => ({ kind: "character", id: ctx.party.find((p) => p.classId === classId)!.id });
    return { ctx, boss, combat, ref };
  }

  test("is left out of the party's target pool and its area targeting", () => {
    withAirborne(() => {
      const { ctx, boss, combat, ref } = airborneFight();
      expect(livingMonsterRefs(combat, ctx).some((r) => r.id === boss.id)).toBe(true);
      expect(livingTargetableMonsterRefs(combat, ctx)).toEqual([]);
      expect(autoResolveTargets("allEnemies", ref("knight"), combat, ctx)).toEqual([]);
    });
  });

  test("a single-target attack on it fizzles while a self-buff still resolves", () => {
    withAirborne(() => {
      const { ctx, boss, combat, ref } = airborneFight();
      const archer = ref("archer");
      const attack = pickAnyAction(ctx, combat, archer);
      queueAction(combat, archer, attack.skillId, attack.targets, ctx);
      queueAction(combat, ref("knight"), "interpose", [ref("mage")], ctx);
      const before = boss.hp;
      resolveRound(combat, ctx);
      expect(boss.hp).toBe(before);
      const mage = ctx.party.find((p) => p.classId === "mage")!;
      expect(combat.log.some((l) => l.text === `${mage.name} gains the Interposed effect.`)).toBe(true);
    });
  });

  test("an area attack skips it, lands on the rest, and the round still finishes", () => {
    withAirborne(() => {
      const { ctx, boss, ref } = airborneFight();
      const rat = spawnInto(ctx, "dungeon-rat");
      rat.hp = rat.maxHp = 9999;
      const combat = startCombat("r1", [boss.id, rat.id], ctx, true);
      // Fire Pillar opens at level 10; the default party is level 1.
      const mage = ctx.party.find((p) => p.classId === "mage")!;
      mage.level = 10;
      mage.unlockedSkillIds.push("fire-pillar");
      mage.mp = mage.maxMp = 999;
      const targets = autoResolveTargets("allEnemies", ref("mage"), combat, ctx)!;
      expect(targets).toEqual([{ kind: "monster", id: rat.id }]);
      expect(queueAction(combat, ref("mage"), "fire-pillar", [...targets, { kind: "monster", id: boss.id }], ctx)).toBeNull();
      const before = boss.hp;
      resolveRound(combat, ctx);
      expect(boss.hp).toBe(before);
      expect(rat.hp).toBeLessThan(9999);
      expect(combat.roundNumber).toBe(2);
      expect(combat.outcome).toBeUndefined();
    });
  });

  test("a single-target attack aimed at it lands on a targetable monster instead", () => {
    withAirborne(() => {
      const { ctx, boss, ref } = airborneFight();
      const rat = spawnInto(ctx, "dungeon-rat");
      rat.hp = rat.maxHp = 9999;
      const combat = startCombat("r1", [boss.id, rat.id], ctx, true);
      const archer = ref("archer");
      queueAction(combat, archer, pickAnyAction(ctx, combat, archer).skillId, [{ kind: "monster", id: boss.id }], ctx);
      const bossBefore = boss.hp;
      resolveRound(combat, ctx);
      expect(boss.hp).toBe(bossBefore);
      expect(rat.hp).toBeLessThan(9999);
    });
  });

  test("Overwatch holds its shot: no shot at it, its turn goes ahead, the watcher stays primed", () => {
    withAirborne(() => {
      const { ctx, boss, combat, ref } = airborneFight();
      boss.attack = 0;
      const archer = ctx.party.find((p) => p.classId === "archer")!;
      // Primed for several rounds, so what is under test is the hold itself, not the status running out.
      archer.activeStatusEffects.push({ statusEffectId: "overwatched", turnsRemaining: 5 });
      const before = boss.hp;
      resolveRound(combat, ctx);
      expect(boss.hp).toBe(before);
      expect(combat.log.some((l) => l.text.includes("fires from Overwatch") || l.text.includes("Overwatch shot misses"))).toBe(false);
      const acted = new RegExp(`^${boss.name.replace(/[()]/g, "\\$&")} (uses|attacks|misses|gathers|unleashes) `);
      expect(combat.log.some((l) => acted.test(l.text))).toBe(true);
      expect(archer.activeStatusEffects.some((s) => s.statusEffectId === "overwatched")).toBe(true);
    });
  });
});

describe("breakable shell", () => {
  const shell = { hitsToBreak: { min: 3, max: 3 }, hitDamageCapMaxHpPercent: 5, breakStatusId: "stunned", breakDurationTurns: 1, reformAfterOwnTurns: 2 };

  function withShell(skills: any[], archetypeOver: any, body: () => void) {
    withFixture(skills, { shell, actionWeights: { boss: { basicAttack: 100 } }, ...archetypeOver }, body);
  }

  function shellFight() {
    const { ctx } = makeCtx(1);
    const boss = spawnMonster("fixture-boss", 1, { tier: "boss" });
    boss.maxHp = 1000;
    boss.hp = 1000;
    ctx.monsters.push(boss);
    const combat = startCombat("r1", [boss.id], ctx, true);
    const hitter = ctx.party[0]!;
    const hit = (amount = 400) => {
      const before = boss.hp;
      resolveSkillEffect({ kind: "damage", amount }, hitter, boss, { log: combat.log });
      return before - boss.hp;
    };
    const turn = () => runMonsterTurn({ kind: "monster", id: boss.id }, combat, ctx);
    const lines = (text: string) => combat.log.filter((l) => l.text.includes(text)).length;
    const status = (id: string) => ({ statusEffectId: id, turnsRemaining: 5 });
    return { ctx, boss, combat, hitter, hit, turn, lines, status };
  }

  test("a shell bearer starts the fight with its shell intact and a rolled hit count", () => {
    withShell([], {}, () => {
      const { boss } = shellFight();
      expect(boss.shell).toEqual({ state: "intact", hitsLeft: 3, ownTurnsSinceBreak: 0 });
    });
  });

  test("an intact shell caps a direct hit at its share of max HP and counts it", () => {
    withShell([], {}, () => {
      const { boss, hit } = shellFight();
      expect(hit(400)).toBe(50);
      expect(boss.shell!.hitsLeft).toBe(2);
    });
  });

  test("an intact shell turns a status tick away", () => {
    withShell([], {}, () => {
      const { boss, combat } = shellFight();
      boss.activeStatusEffects.push({ statusEffectId: "burning", turnsRemaining: 3 });
      tickDotEffects(boss, { log: combat.log });
      expect(boss.hp).toBe(1000);
    });
  });

  test("a multi-hit counts every hit, an area skill counts the bearer once", () => {
    withShell([], {}, () => {
      const { ctx, boss, combat, hitter } = shellFight();
      const multi = { id: "fx-multi", name: "fx-multi", description: "x", mpCost: 0, target: "singleEnemy", effects: [{ kind: "damage", amount: 1, hitCountRange: { min: 3, max: 3 } }], slot: 0, unlockLevel: 1 } as any;
      applySkillEffects(multi, hitter, [boss], combat, ctx, combat.log);
      expect(boss.shell!.state).toBe("broken");
    });
    withShell([], {}, () => {
      const { ctx, boss, combat, hitter } = shellFight();
      const rat = spawnInto(ctx, "dungeon-rat");
      combat.combatants.push({ ref: { kind: "monster", id: rat.id }, speed: rat.speed });
      const area = { id: "fx-area", name: "fx-area", description: "x", mpCost: 0, target: "allEnemies", effects: [{ kind: "damage", amount: 1 }], slot: 0, unlockLevel: 1 } as any;
      applySkillEffects(area, hitter, [boss, rat], combat, ctx, combat.log);
      expect(boss.shell!.hitsLeft).toBe(2);
    });
  });

  test("breaking stuns the bearer once, lifts the cap and lets ticks bite", () => {
    withShell([], {}, () => {
      const { boss, hit, lines, combat } = shellFight();
      hit();
      hit();
      hit();
      expect(boss.shell!.state).toBe("broken");
      expect(boss.activeStatusEffects.some((s) => s.statusEffectId === "stunned")).toBe(true);
      expect(lines("cracks open")).toBe(1);
      expect(hit(400)).toBeGreaterThan(50);
      boss.hp = 1000;
      boss.activeStatusEffects.push({ statusEffectId: "burning", turnsRemaining: 3 });
      tickDotEffects(boss, { log: combat.log });
      expect(boss.hp).toBeLessThan(1000);
    });
  });

  test("it re-forms after the configured own turn, shedding debuffs and keeping buffs", () => {
    withShell([], {}, () => {
      const { boss, hit, turn, lines, status } = shellFight();
      hit();
      hit();
      hit();
      boss.activeStatusEffects.push(status("burning"), status("weakened"), status("empower"));
      turn();
      expect(boss.shell!.state).toBe("broken");
      turn();
      expect(boss.shell).toEqual({ state: "intact", hitsLeft: 3, ownTurnsSinceBreak: 0 });
      expect(lines("closes over again")).toBe(1);
      expect(boss.activeStatusEffects.map((s) => s.statusEffectId)).toEqual(["empower"]);
    });
  });

  test("an artifact's reflect is capped by the intact shell and does not count as a hit", () => {
    withShell([], {}, () => {
      const { boss, hitter, combat } = shellFight();
      hitter.equippedArtifactIds.push("spiked-cloak");
      const before = boss.hp;
      applyArtifactReflectDamage(hitter, boss, 5000, combat.log);
      expect(before - boss.hp).toBe(50);
      expect(boss.shell!.hitsLeft).toBe(3);
    });
  });
});

describe("a party caster felled by riposte", () => {
  /** A boss Skeleton Guard under riposte (first target) and a plain second target, against one hero on 1 HP. */
  function riposteFight(classId: string, level: number, artifactIds: string[] = []) {
    const { ctx } = makeCtx(2);
    const guard = spawnMonster("skeleton-guard", 1, { tier: "boss" });
    guard.maxHp = 1e6;
    guard.hp = 1e6;
    guard.activeStatusEffects.push({ statusEffectId: "riposte", turnsRemaining: 2 });
    const second = spawnMonster("skeleton-guard", 1, { tier: "boss" });
    second.maxHp = 1e6;
    second.hp = 1e6;
    ctx.monsters.push(guard, second);
    const hero = createCharacter("hero", "Hero", CLASSES.find((c) => c.id === classId)!, level);
    hero.equippedArtifactIds = artifactIds;
    hero.attack = 5000;
    hero.magicPower = 5000;
    hero.hp = 1;
    ctx.party[0] = hero;
    const combat = startCombat("r1", [guard.id, second.id], ctx, true);
    const cast = (skillId: string) => applySkillEffects(getEffectiveSkill(getSkill(skillId), level), hero, [guard, second], combat, ctx, combat.log);
    return { hero, guard, second, combat, cast };
  }

  test("stays dead: no lifesteal heals it after the reflect", () => {
    const { hero, combat, cast } = riposteFight("knight", 1, ["bloodthirsty-blade"]);
    cast("slash");
    expect(hero.isAlive).toBe(false);
    expect(hero.hp).toBe(0);
    const defeatedAt = combat.log.findIndex((l) => l.text.includes("Hero is defeated"));
    expect(defeatedAt).toBeGreaterThan(-1);
    expect(combat.log.slice(defeatedAt).some((l) => l.text.startsWith("Hero recovers"))).toBe(false);
  });

  test("stops the cast: no further hits, no further targets", () => {
    const { hero, guard, second, cast } = riposteFight("ninja", 20);
    const guardBefore = guard.hp;
    cast("shuriken-storm");
    expect(hero.isAlive).toBe(false);
    expect(guard.hp).toBeLessThan(guardBefore);
    expect(second.hp).toBe(second.maxHp);
  });

  test("a Viking's blood-fury self-damage does not bring it back to 1 HP", () => {
    // Blood Fury opens at level 5; on 1 HP it is active, so the self-damage branch is reached.
    const { hero, cast } = riposteFight("viking", 5);
    cast("axe-slash");
    expect(hero.isAlive).toBe(false);
    expect(hero.hp).toBe(0);
  });
});

describe("a monster turn lost to Overwatch", () => {
  /** An Overwatch status that always hits and either always or never interrupts. */
  function withWatch(interruptChance: number, body: () => void) {
    STATUS_EFFECTS.push({
      id: "fx-watch",
      name: "Watch",
      description: "x",
      perTurnEffects: [],
      tickCategory: "statMod",
      triggersOverwatch: true,
      overwatchShot: { amount: 10, offenseMultiplierPercent: 100 },
      interruptChance,
    } as any);
    try {
      body();
    } finally {
      STATUS_EFFECTS.splice(STATUS_EFFECTS.findIndex((s) => s.id === "fx-watch"), 1);
    }
  }
  const shell = { hitsToBreak: { min: 1, max: 1 }, hitDamageCapMaxHpPercent: 5, breakStatusId: "stunned", breakDurationTurns: 1, reformAfterOwnTurns: 2 };

  /** The fixture boss alone against the party, with the Archer primed on Overwatch. */
  function watchedFight() {
    const { ctx } = makeCtx(1);
    const boss = spawnMonster("fixture-boss", 1, { tier: "boss" });
    boss.hp = boss.maxHp = 100000;
    ctx.monsters.push(boss);
    const combat = startCombat("r1", [boss.id], ctx, true);
    ctx.party.find((p) => p.classId === "archer")!.activeStatusEffects.push({ statusEffectId: "fx-watch", turnsRemaining: 9 });
    return { ctx, boss, combat };
  }

  test("still counts down its cooldowns", () => {
    withWatch(1, () => {
      withFixture([], { actionWeights: { boss: { basicAttack: 100 } } }, () => {
        const { ctx, boss, combat } = watchedFight();
        boss.skillCooldowns = { "some-skill": 2 };
        resolveRound(combat, ctx);
        expect(combat.log.some((l) => l.text.includes("Overwatch"))).toBe(true);
        expect(boss.skillCooldowns["some-skill"]).toBe(1);
      });
    });
  });

  test("a shell broken by the shot costs the bearer exactly one turn", () => {
    withWatch(0, () => {
      withFixture([], { shell, actionWeights: { boss: { basicAttack: 100 } } }, () => {
        const { ctx, boss, combat } = watchedFight();
        expect(boss.shell!.hitsLeft).toBe(1);
        resolveRound(combat, ctx);
        expect(boss.shell!.state).toBe("broken");
        expect(combat.log.some((l) => l.text.includes(`${boss.name} is stunned`))).toBe(true);
        expect(boss.activeStatusEffects.some((s) => s.statusEffectId === "stunned")).toBe(false);
        expect(boss.shell!.ownTurnsSinceBreak).toBe(1);
      });
    });
  });

  test("a shell broken by an interrupting shot is counted on that lost turn", () => {
    withWatch(1, () => {
      withFixture([], { shell, actionWeights: { boss: { basicAttack: 100 } } }, () => {
        const { ctx, boss, combat } = watchedFight();
        resolveRound(combat, ctx);
        expect(boss.shell!.state).toBe("broken");
        expect(boss.activeStatusEffects.some((s) => s.statusEffectId === "stunned")).toBe(false);
        expect(boss.shell!.ownTurnsSinceBreak).toBe(1);
      });
    });
  });
});

describe("a summoner killed by artifact auto-damage", () => {
  test("its adds fall before any of them takes a turn", () => {
    withFixture([summonGoblins(2)], { actionWeights: { boss: { basicAttack: 100 } } }, () => {
      let checked = 0;
      for (let seed = 0; seed < 40 && checked < 3; seed++) {
        const { ctx, boss, combat, addsOf } = bossFight(seed);
        // The summon is cast directly, so the adds are on the field before the round starts.
        applySkillEffects(MONSTER_SKILLS.find((s) => s.id === "fx-summon")!, boss, [boss], combat, { ...ctx, floorDepth: 1 }, combat.log);
        expect(addsOf().length).toBe(2);
        // First in the turn order, so only the prune right after the auto-damage can stop them.
        for (const add of addsOf()) {
          add.hp = add.maxHp = 1e6;
          add.speed = 999;
          combat.combatants.find((c) => c.ref.id === add.id)!.speed = 999;
        }
        boss.hp = 1;
        ctx.party[0]!.equippedArtifactIds = ["thunder-totem"];
        const logStart = combat.log.length;
        resolveRound(combat, ctx);
        const roundLog = combat.log.slice(logStart).map((l) => l.text);
        const bossFellAt = roundLog.findIndex((l) => l.startsWith(`${boss.name} is defeated`));
        if (bossFellAt === -1) continue;
        // Only seeds where the auto-damage itself landed on the summoner prove anything.
        if (!roundLog.slice(0, bossFellAt).some((l) => l.includes("Thunder Totem"))) continue;
        checked += 1;
        const addNames = new Set(addsOf().map((a) => a.name));
        expect(roundLog.some((l) => [...addNames].some((n) => l.startsWith(`${n} attacks`) || l.startsWith(`${n} uses`)))).toBe(false);
        expect(combat.outcome).toBe("victory");
      }
      expect(checked).toBeGreaterThan(0);
    });
  });
});
