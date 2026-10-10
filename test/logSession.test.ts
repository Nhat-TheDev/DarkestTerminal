import { describe, expect, test } from "bun:test";
import { applySkillEffects, queueAction, resolveRound, snapshotCombatants, startCombat } from "../src/engine/combat";
import { hpDeltas } from "../src/ui/battlefieldFocus";
import { Game } from "../src/engine/game";
import { runMonsterTurn } from "../src/engine/monsterAI";
import { ARTIFACTS } from "../src/data/artifacts";
import { debuffResistPercent } from "../src/engine/artifacts";
import { spawnMonster } from "../src/data/monsters";
import { getStatusEffect } from "../src/data/statusEffects";
import { noteAffected, noteBasicAttack, noteMiss, noteResisted, noteSkillTarget, runInSession, runTicksInSession, unitId } from "../src/engine/logSession";
import { expireStatusEffect, statusRole, type Actor } from "../src/engine/resolver";
import type { Character, CombatantRef, CombatState, SkillDefinition, SkillEffect, Summon } from "../src/types";
import { makeCtx, spawnInto } from "./helpers";

function setup() {
  const { ctx } = makeCtx(5);
  const goblin = spawnInto(ctx, "goblin");
  const goblin2 = spawnInto(ctx, "goblin");
  const combat = startCombat("r1", [goblin.id, goblin2.id], ctx, false);
  const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
  const acolyte = ctx.party.find((p) => p.classId === "acolyte")!;
  return { ctx, combat, goblin, goblin2, vanguard, acolyte };
}

const damage: SkillEffect = { kind: "damage", amount: 1 };
const heal: SkillEffect = { kind: "heal", amount: 5 };
const guardBuff: SkillEffect = { kind: "applyStatusEffect", statusEffectId: "guard", durationTurns: 2 };
const weakenDebuff: SkillEffect = { kind: "applyStatusEffect", statusEffectId: "weakened", durationTurns: 2 };

describe("unitId", () => {
  test("a summon is drawn as its owner; everyone else as themselves", () => {
    const { goblin, vanguard } = setup();
    const summon = { id: "s1", ownerId: vanguard.id } as unknown as Actor;
    expect(unitId(summon)).toBe(vanguard.id);
    expect(unitId(goblin)).toBe(goblin.id);
    expect(unitId(vanguard)).toBe(vanguard.id);
  });
});

describe("runInSession", () => {
  test("tags every entry logged by the body with one shared session whose id is the first tagged entry's index", () => {
    const { combat, vanguard } = setup();
    const before = combat.log.length;
    runInSession(combat, vanguard.id, () => {
      combat.log.push({ text: "a", kind: "info" });
      combat.log.push({ text: "b", kind: "info" });
    });
    const [a, b] = combat.log.slice(before);
    expect(a!.session).toBeDefined();
    expect(b!.session).toBe(a!.session);
    expect(a!.session!.actorId).toBe(vanguard.id);
    expect(a!.session!.id).toBe(before);
  });

  test("returns what the body returns", () => {
    const { combat, vanguard } = setup();
    expect(runInSession(combat, vanguard.id, () => 42)).toBe(42);
  });

  test("leaves no session behind when the body logs nothing, and clears the active session afterwards", () => {
    const { combat, vanguard } = setup();
    const before = combat.log.length;
    runInSession(combat, vanguard.id, () => {});
    expect(combat.log.length).toBe(before);
    expect(combat.activeSession).toBeUndefined();
  });

  test("clears the active session even when the body throws", () => {
    const { combat, vanguard } = setup();
    expect(() => runInSession(combat, vanguard.id, () => { throw new Error("boom"); })).toThrow("boom");
    expect(combat.activeSession).toBeUndefined();
  });

  test("a nested session keeps its own entries; the outer one does not overwrite them", () => {
    const { combat, vanguard, acolyte } = setup();
    runInSession(combat, vanguard.id, () => {
      combat.log.push({ text: "outer-1", kind: "info" });
      runInSession(combat, acolyte.id, () => combat.log.push({ text: "inner", kind: "info" }));
      combat.log.push({ text: "outer-2", kind: "info" });
    });
    const byText = (text: string) => combat.log.find((e) => e.text === text)!;
    expect(byText("outer-1").session!.actorId).toBe(vanguard.id);
    expect(byText("inner").session!.actorId).toBe(acolyte.id);
    expect(byText("outer-2").session!.actorId).toBe(vanguard.id);
    expect(byText("inner").session!.id).not.toBe(byText("outer-1").session!.id);
  });

  test("session ids stay distinct when the nested session logs before the outer one does", () => {
    const { combat, vanguard, acolyte } = setup();
    runInSession(combat, vanguard.id, () => {
      runInSession(combat, acolyte.id, () => combat.log.push({ text: "inner", kind: "info" }));
      combat.log.push({ text: "outer", kind: "info" });
    });
    const inner = combat.log.find((e) => e.text === "inner")!.session!;
    const outer = combat.log.find((e) => e.text === "outer")!.session!;
    expect(inner.id).not.toBe(outer.id);
    expect(outer.id).toBe(combat.log.findIndex((e) => e.text === "outer"));
  });

  test("an actor-less session carries the units it lights", () => {
    const { combat, goblin } = setup();
    runInSession(combat, null, () => combat.log.push({ text: "tick", kind: "info" }), { affectedIds: [goblin.id] });
    expect(combat.log.at(-1)!.session).toMatchObject({ actorId: null, affectedIds: [goblin.id] });
  });
});

describe("session snapshots and markers", () => {
  test("each run of a session carries the state as of its own end; a nested session does not leak into it", () => {
    const { combat, vanguard, acolyte } = setup();
    let hp = 100;
    const snapshot = () => [{ id: "x", hp, maxHp: 100, isAlive: true }];
    runInSession(
      combat,
      vanguard.id,
      () => {
        combat.log.push({ text: "outer-1", kind: "info" });
        hp = 90;
        runInSession(
          combat,
          acolyte.id,
          () => {
            combat.log.push({ text: "inner", kind: "info" });
            hp = 80;
          },
          { snapshot }
        );
        combat.log.push({ text: "outer-2", kind: "info" });
        hp = 70;
      },
      { snapshot }
    );
    const hpOf = (text: string) => combat.log.find((e) => e.text === text)!.snapshot![0]!.hp;
    expect(hpOf("outer-1")).toBe(90);
    expect(hpOf("inner")).toBe(80);
    expect(hpOf("outer-2")).toBe(70);
  });

  test("noteMiss records the missed target once, as its unit", () => {
    const { combat, goblin, vanguard } = setup();
    const summon = { id: "s1", ownerId: vanguard.id } as unknown as Actor;
    runInSession(combat, goblin.id, () => {
      noteMiss(combat, summon);
      noteMiss(combat, vanguard);
      combat.log.push({ text: "x", kind: "info" });
    });
    expect(combat.log.at(-1)!.session!.missedIds).toEqual([vanguard.id]);
  });

  test("an actor-less session carries its cause", () => {
    const { combat } = setup();
    runInSession(combat, null, () => combat.log.push({ text: "x", kind: "info" }), { cause: "dying" });
    expect(combat.log.at(-1)!.session!.cause).toBe("dying");
  });
});

describe("runTicksInSession", () => {
  test("one session for the whole block, lighting only the units whose tick logged", () => {
    const { combat, goblin, goblin2, vanguard } = setup();
    runTicksInSession(combat, [goblin, goblin2, vanguard], (actor) => {
      if (actor !== goblin2) combat.log.push({ text: `tick ${actor.id}`, kind: "info" });
    });
    const entries = combat.log.filter((e) => e.text.startsWith("tick "));
    expect(entries).toHaveLength(2);
    expect(entries[1]!.session).toBe(entries[0]!.session);
    expect(entries[0]!.session).toMatchObject({ actorId: null, affectedIds: [goblin.id, vanguard.id] });
  });

  test("a block where nothing logged leaves nothing behind", () => {
    const { combat, goblin } = setup();
    const before = combat.log.length;
    runTicksInSession(combat, [goblin], () => {});
    expect(combat.log.length).toBe(before);
  });
});

describe("noteAffected", () => {
  test("adds a summon's owner, once", () => {
    const { combat, vanguard } = setup();
    const summon = { id: "s1", ownerId: vanguard.id } as unknown as Actor;
    runInSession(combat, null, () => {
      noteAffected(combat, summon);
      noteAffected(combat, vanguard);
      combat.log.push({ text: "x", kind: "info" });
    });
    expect(combat.log.at(-1)!.session!.affectedIds).toEqual([vanguard.id]);
  });
});

describe("noteSkillTarget / noteBasicAttack", () => {
  function noted(effects: SkillEffect[], targetSide: "enemy" | "ally", skillDealsDamage = effects.some((e) => e.kind === "damage")) {
    const { combat, vanguard, acolyte, goblin } = setup();
    const target = targetSide === "enemy" ? goblin : acolyte;
    runInSession(combat, vanguard.id, () => {
      noteSkillTarget(combat, vanguard, target, effects, skillDealsDamage);
      combat.log.push({ text: "x", kind: "info" });
    });
    return { session: combat.log.at(-1)!.session!, target };
  }

  test("damage on an opponent is an attack", () => {
    const { session, target } = noted([damage], "enemy");
    expect(session.attackedIds).toEqual([target.id]);
    expect(session.debuffedIds).toEqual([]);
  });

  test("non-damage on an opponent, from a skill with no damage, is a debuff", () => {
    const { session, target } = noted([weakenDebuff], "enemy");
    expect(session.debuffedIds).toEqual([target.id]);
    expect(session.attackedIds).toEqual([]);
  });

  test("a debuff on an opponent from a skill that deals damage elsewhere still counts as an attack", () => {
    const { session, target } = noted([weakenDebuff], "enemy", true);
    expect(session.attackedIds).toEqual([target.id]);
    expect(session.debuffedIds).toEqual([]);
  });

  test("damage plus a debuff on the same opponent counts only as an attack", () => {
    const { session, target } = noted([damage, weakenDebuff], "enemy");
    expect(session.attackedIds).toEqual([target.id]);
    expect(session.debuffedIds).toEqual([]);
  });

  test("a heal on a same-side target is a heal; a helpful status is a buff", () => {
    expect(noted([heal], "ally").session.healedIds).toHaveLength(1);
    const buffed = noted([guardBuff], "ally");
    expect(buffed.session.buffedIds).toEqual([buffed.target.id]);
    expect(buffed.session.healedIds).toEqual([]);
  });

  test("a harmful effect on a same-side target (self-cost) earns no role, but the target is lit", () => {
    const { session, target } = noted([weakenDebuff, damage], "ally");
    expect(session.buffedIds).toEqual([]);
    expect(session.attackedIds).toEqual([]);
    expect(session.affectedIds).toEqual([target.id]);
  });

  test("an item that lowers an ally's aggro lights the ally without a buff icon", () => {
    const { session, target } = noted([{ kind: "modifyCombatStat", combatStat: "aggro", amount: -20 }], "ally");
    expect(session.buffedIds).toEqual([]);
    expect(session.affectedIds).toEqual([target.id]);
  });

  test("a helped ally is not also listed as merely affected", () => {
    expect(noted([guardBuff], "ally").session.affectedIds).toEqual([]);
  });

  test("a summon effect alone does not light its target", () => {
    expect(noted([{ kind: "summon" }], "ally").session.affectedIds).toEqual([]);
  });

  test("a negative combat-stat change on an opponent is a debuff, a positive one on an ally a buff", () => {
    expect(noted([{ kind: "modifyCombatStat", combatStat: "defense", amount: -5 }], "enemy").session.debuffedIds).toHaveLength(1);
    expect(noted([{ kind: "modifyCombatStat", combatStat: "attack", amount: 5 }], "ally").session.buffedIds).toHaveLength(1);
  });

  test("a summon effect alone names no one", () => {
    const { session } = noted([{ kind: "summon" }], "enemy", false);
    expect(session.debuffedIds).toEqual([]);
    expect(session.attackedIds).toEqual([]);
  });

  test("noteBasicAttack records an attack on the target", () => {
    const { combat, goblin, vanguard } = setup();
    runInSession(combat, goblin.id, () => {
      noteBasicAttack(combat, goblin, vanguard);
      combat.log.push({ text: "x", kind: "info" });
    });
    expect(combat.log.at(-1)!.session!.attackedIds).toEqual([vanguard.id]);
  });

  test("a summon target is recorded as its owner", () => {
    const { combat, goblin, vanguard } = setup();
    const summon = { id: "s1", ownerId: vanguard.id, hp: 5, name: "Totem" } as unknown as Actor;
    runInSession(combat, goblin.id, () => {
      noteBasicAttack(combat, goblin, summon);
      combat.log.push({ text: "x", kind: "info" });
    });
    expect(combat.log.at(-1)!.session!.attackedIds).toEqual([vanguard.id]);
  });

  test("notes outside any session are ignored", () => {
    const { combat, goblin, vanguard } = setup();
    expect(() => noteBasicAttack(combat, goblin, vanguard)).not.toThrow();
  });
});

function skill(partial: Pick<SkillDefinition, "target" | "effects"> & Partial<SkillDefinition>): SkillDefinition {
  return { id: "t-skill", name: "Test", description: "", mpCost: 0, slot: 1, unlockLevel: 1, isUltimate: true, ...partial };
}

describe("applySkillEffects notes its targets", () => {
  test("single-target attack", () => {
    const { ctx, combat, vanguard, goblin } = setup();
    runInSession(combat, vanguard.id, () => applySkillEffects(skill({ target: "singleEnemy", effects: [damage] }), vanguard, [goblin], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session).toMatchObject({ actorId: vanguard.id, attackedIds: [goblin.id], buffedIds: [], healedIds: [] });
  });

  test("a character hitting a monster gains no fear and notes none", () => {
    const { ctx, combat, vanguard, goblin } = setup();
    runInSession(combat, vanguard.id, () => applySkillEffects(skill({ target: "singleEnemy", effects: [damage] }), vanguard, [goblin], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session!.fearGainIds).toEqual([]);
    expect(vanguard.survival.fear).toBe(0);
  });

  test("area attack lists every enemy", () => {
    const { ctx, combat, vanguard, goblin, goblin2 } = setup();
    runInSession(combat, vanguard.id, () => applySkillEffects(skill({ target: "allEnemies", effects: [damage] }), vanguard, [goblin, goblin2], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session!.attackedIds).toEqual([goblin.id, goblin2.id]);
  });

  test("a missed attack still marks the target", () => {
    const { ctx, combat, vanguard, goblin } = setup();
    goblin.activeStatusEffects.push({ statusEffectId: "blinded", turnsRemaining: 2 });
    ctx.rng.next = () => 0; // every accuracy roll fails against blinded's 60% penalty
    runInSession(combat, goblin.id, () =>
      applySkillEffects(skill({ target: "singleEnemy", effects: [damage], isUltimate: false }), goblin, [vanguard], combat, ctx, combat.log)
    );
    const entry = combat.log.at(-1)!;
    expect(entry.text.toLowerCase()).toContain("miss");
    expect(entry.session!.attackedIds).toEqual([vanguard.id]);
    expect(entry.session!.missedIds).toEqual([vanguard.id]);
  });

  test("buff, heal and debuff-only", () => {
    const { ctx, combat, vanguard, acolyte, goblin } = setup();
    vanguard.hp = Math.max(1, vanguard.maxHp - 10);
    runInSession(combat, acolyte.id, () => applySkillEffects(skill({ target: "singleAlly", effects: [guardBuff] }), acolyte, [vanguard], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session).toMatchObject({ actorId: acolyte.id, buffedIds: [vanguard.id] });
    runInSession(combat, acolyte.id, () => applySkillEffects(skill({ target: "singleAlly", effects: [heal] }), acolyte, [vanguard], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session).toMatchObject({ healedIds: [vanguard.id], buffedIds: [] });
    runInSession(combat, acolyte.id, () => applySkillEffects(skill({ target: "singleEnemy", effects: [weakenDebuff] }), acolyte, [goblin], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session).toMatchObject({ debuffedIds: [goblin.id], attackedIds: [] });
  });

  test("a skill that damages one enemy and debuffs all of them is an attack on all of them", () => {
    const { ctx, combat, vanguard, goblin, goblin2 } = setup();
    const sweep = skill({ target: "singleEnemy", effects: [damage, { ...weakenDebuff, target: "allEnemies" }] });
    runInSession(combat, vanguard.id, () => applySkillEffects(sweep, vanguard, [goblin], combat, ctx, combat.log));
    const session = combat.log.at(-1)!.session!;
    expect(session.attackedIds).toEqual(expect.arrayContaining([goblin.id, goblin2.id]));
    expect(session.debuffedIds).toEqual([]);
  });

  test("a skill with relation-scoped effects splits heal and damage by side", () => {
    const { ctx, combat, acolyte, vanguard, goblin } = setup();
    vanguard.hp = Math.max(1, vanguard.maxHp - 10);
    const purify = skill({
      target: "allAlliesAndEnemies",
      effects: [
        { kind: "heal", amount: 5, appliesToRelation: "ally" },
        { kind: "damage", amount: 1, appliesToRelation: "enemy" },
      ],
    });
    runInSession(combat, acolyte.id, () => applySkillEffects(purify, acolyte, [vanguard, goblin], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session).toMatchObject({ healedIds: [vanguard.id], attackedIds: [goblin.id] });
  });

  test("a debuff the owner throws off keeps its icon when the same cast landed on its summon", () => {
    const { ctx } = makeCtx(3);
    const rat = spawnInto(ctx, "dungeon-rat");
    const started = startCombat("r1", [rat.id], ctx, false);
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    const clone = addClone(ninja, started, ctx);
    const debuff = [{ kind: "applyStatusEffect", statusEffectId: "weakened" } as SkillEffect];
    for (const [first, second, landsOnSummon] of [[clone, ninja, true], [ninja, null, false]] as const) {
      runInSession(started, rat.id, () => {
        noteSkillTarget(started, rat, first, debuff, false);
        if (second) noteSkillTarget(started, rat, second, debuff, false);
        noteResisted(started, ninja);
        started.log.push({ text: "x", kind: "info" });
      });
      const session = started.log.at(-1)!.session!;
      expect(session.debuffedIds).toEqual(landsOnSummon ? [ninja.id] : []);
      expect(session.missedIds).toEqual([ninja.id]);
    }
  });

  test("a debuff the target throws off is a miss, not a debuff; one that lands stays a debuff", () => {
    const { ctx, combat, goblin, vanguard } = setup();
    vanguard.equippedArtifactIds.push("bitter-root-charm");
    const resist = debuffResistPercent(vanguard);
    expect(resist).toBeGreaterThan(0);
    const weaken = skill({ target: "singleEnemy", effects: [weakenDebuff] });
    const cast = (roll: number) => {
      ctx.rng.next = () => roll;
      runInSession(combat, goblin.id, () => applySkillEffects(weaken, goblin, [vanguard], combat, ctx, combat.log));
      return combat.log.at(-1)!;
    };

    // Inside the resisted band: the roll would land without the resist, and misses with it.
    const thrownOff = cast(1 - resist / 200);
    expect(thrownOff.text).toContain("throws off");
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "weakened")).toBe(false);
    expect(thrownOff.session).toMatchObject({ debuffedIds: [], missedIds: [vanguard.id], affectedIds: [vanguard.id] });

    const landed = cast(0);
    expect(vanguard.activeStatusEffects.some((s) => s.statusEffectId === "weakened")).toBe(true);
    expect(landed.session).toMatchObject({ debuffedIds: [vanguard.id], missedIds: [] });
  });
});

describe("resolveRound tags what a round logs", () => {
  function fight(seed = 11) {
    const { ctx } = makeCtx(seed);
    const rats = [spawnInto(ctx, "dungeon-rat"), spawnInto(ctx, "dungeon-rat")];
    for (const r of rats) {
      r.maxHp = r.hp = 50000;
      r.attack = 0;
    }
    const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
    return { ctx, combat, rats };
  }

  test("a quiet round leaves no entry without a session (apart from combat start)", () => {
    const { ctx, combat } = fight();
    resolveRound(combat, ctx);
    expect(combat.phase).toBe("command");
    expect(combat.log.slice(1).filter((e) => !e.session)).toEqual([]);
  });

  test("a monster's basic attack is its own session naming exactly one party member", () => {
    const { ctx, combat, rats } = fight();
    for (const r of rats) r.attack = 30;
    resolveRound(combat, ctx);
    const attacks = combat.log.filter((e) => e.session && rats.some((r) => r.id === e.session!.actorId));
    expect(attacks.length).toBeGreaterThan(0);
    for (const e of attacks) expect(e.session!.attackedIds).toHaveLength(1);
  });

  test("end-of-round fear is one actor-less session carried by a single hidden entry", () => {
    const { ctx, combat } = fight();
    const fearBefore = ctx.party.map((c) => c.survival.fear);
    resolveRound(combat, ctx);
    const fearEntries = combat.log.filter((e) => e.session?.cause === "fear");
    expect(fearEntries).toHaveLength(1);
    expect(fearEntries[0]!.hidden).toBe(true);
    const living = ctx.party.filter((c) => c.isAlive).map((c) => c.id);
    expect(fearEntries[0]!.session!.fearGainIds).toEqual(living);
    expect(fearEntries[0]!.session!.affectedIds).toEqual(living);
    ctx.party.forEach((c, i) => expect(c.survival.fear).toBeGreaterThan(fearBefore[i]!));
    expect(fearEntries[0]!.snapshot!.find((snap) => snap.id === living[0])!.fear).toBe(ctx.party.find((c) => c.id === living[0])!.survival.fear);
  });

  test("a monster's hit that lands notes the struck character's fear gain in its own session", () => {
    const { ctx, combat, rats } = fight();
    for (const r of rats) r.attack = 30;
    resolveRound(combat, ctx);
    const attacks = combat.log.filter((e) => e.session && rats.some((r) => r.id === e.session!.actorId));
    const struck = attacks.flatMap((e) => e.session!.fearGainIds);
    expect(struck.length).toBeGreaterThan(0);
    for (const e of attacks) for (const id of e.session!.fearGainIds) expect(e.session!.attackedIds).toContain(id);
  });

  test("combat start and reward lines carry no session", () => {
    const game = new Game(102);
    const monster = spawnMonster("dungeon-rat", 1);
    monster.hp = monster.maxHp = 1;
    monster.attack = 0;
    const room = game.state.floor.rooms.find((r) => r.id === game.state.currentRoomId)!;
    room.monsterIds = [monster.id];
    game.ctx.monsters.push(monster);
    game.state.combat = startCombat(room.id, [monster.id], game.ctx, false);
    const attacker = game.state.party[0]!;
    game.queue({ kind: "character", id: attacker.id }, attacker.unlockedSkillIds[0]!, [{ kind: "monster", id: monster.id }]);
    game.resolve();
    const log = game.state.combat!.log;
    expect(log[0]!.session).toBeUndefined();
    expect(log.find((e) => e.text.includes("EXP"))!.session).toBeUndefined();
    const turn = log.filter((e) => e.session?.actorId === attacker.id);
    expect(turn.length).toBeGreaterThan(0);
    expect(new Set(turn.map((e) => e.session)).size).toBe(1);
    expect(turn[0]!.session!.attackedIds).toEqual([monster.id]);
  });

  test("a DoT tick is an actor-less session lighting the poisoned unit", () => {
    const { ctx } = makeCtx(8);
    const goblin = spawnInto(ctx, "goblin");
    goblin.activeStatusEffects.push({ statusEffectId: "poisoned", turnsRemaining: 2 });
    const combat = startCombat("r1", [goblin.id], ctx, false);
    const before = combat.log.length;
    resolveRound(combat, ctx);
    const tick = combat.log.slice(before).find((e) => e.session?.actorId === null);
    expect(tick).toBeDefined();
    expect(tick!.session!.affectedIds).toContain(goblin.id);
    expect(tick!.session!.cause).toBe("dot");
  });

  test("stat-mod expiries across several units share one actor-less session", () => {
    const { ctx, combat } = fight();
    const buffed = ctx.party.slice(0, 2);
    for (const c of buffed) c.activeStatusEffects.push({ statusEffectId: "guard", turnsRemaining: 1 });
    resolveRound(combat, ctx);
    const expiries = combat.log.filter((e) => e.text.includes("expires"));
    expect(expiries.length).toBeGreaterThanOrEqual(2);
    expect(new Set(expiries.map((e) => e.session)).size).toBe(1);
    expect(expiries[0]!.session!.actorId).toBeNull();
    expect(expiries[0]!.session!.affectedIds).toEqual(expect.arrayContaining(buffed.map((c) => c.id)));
  });

  test("dying damage is one actor-less session lighting the living party", () => {
    const { ctx, combat } = fight();
    resolveRound(combat, ctx, 1, 0);
    const tick = combat.log.find((e) => e.text.includes("from Dying"))!;
    expect(tick.session!.actorId).toBeNull();
    expect(tick.session!.cause).toBe("dying");
    expect(tick.session!.affectedIds).toHaveLength(ctx.party.length);
  });

  test("artifact auto-damage is one actor-less session lighting the bearer and its target", () => {
    const { ctx, combat } = fight();
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    mage.equippedArtifactIds.push("thunder-totem");
    resolveRound(combat, ctx);
    const hit = combat.log.find((e) => e.text.includes("Thunder Totem"))!;
    expect(hit.session).toMatchObject({ actorId: null, cause: "artifact", affectedIds: [mage.id] });
    expect(hit.session!.attackedIds).toHaveLength(1);
  });

  test("the stat-mod expiry session does not carry the Dying damage that follows it", () => {
    const { ctx, combat } = fight();
    const buffed = ctx.party[0]!;
    buffed.activeStatusEffects.push({ statusEffectId: "guard", turnsRemaining: 1 });
    resolveRound(combat, ctx, 1, 0);
    const hpIn = (text: string) => combat.log.find((e) => e.text.includes(text))!.snapshot!.find((c) => c.id === buffed.id)!.hp;
    expect(hpIn("from Dying")).toBeLessThan(hpIn("expires"));
  });

  test("an Overwatch shot is the watcher's own session, ahead of the monster's turn", () => {
    const { ctx, combat, rats } = fight();
    const archer = ctx.party.find((p) => p.classId === "archer")!;
    archer.activeStatusEffects.push({ statusEffectId: "overwatched", turnsRemaining: 2 });
    resolveRound(combat, ctx);
    const shot = combat.log.find((e) => e.text.includes("Overwatch"))!;
    expect(shot.session!.actorId).toBe(archer.id);
    expect(rats.map((r) => r.id)).toContain(shot.session!.attackedIds[0]!);
  });

  test("a summon faster than its owner acts right after the cast, in a session of its own", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    summoner.level = 75;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = rat.hp = 50000;
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };
    queueAction(combat, self, "summon-goblin", [self], ctx);
    resolveRound(combat, ctx);
    const goblin = ctx.summons.find((s) => s.archetypeId === "goblin-thrower")!;
    expect(goblin.speed).toBeGreaterThan(summoner.speed);
    expect(combat.log.slice(1).filter((e) => !e.session)).toEqual([]);

    const castSession = combat.log.find((e) => e.text === `${summoner.name} uses Summon Goblin.`)!.session!;
    const cast = combat.log.filter((e) => e.session === castSession);
    expect(cast.some((e) => e.text === `${summoner.name} summons ${goblin.name}.`)).toBe(true);
    expect(castSession).toMatchObject({ actorId: summoner.id, summonIds: [], attackedIds: [] });

    const goblinTurn = combat.log.filter((e) => e.text.startsWith(`${goblin.name} `));
    expect(goblinTurn.length).toBeGreaterThan(0);
    for (const e of goblinTurn) {
      expect(e.session).not.toBe(castSession);
      expect(e.session).toMatchObject({ actorId: summoner.id, summonIds: [summoner.id] });
    }
  });
});

/** A Shadow Clone owned by `owner`, put straight into the fight (the engine normally spawns it from a skill). */
function addClone(owner: Character, combat: CombatState, ctx: ReturnType<typeof makeCtx>["ctx"], extra: Partial<Summon> = {}): Summon {
  const clone: Summon = {
    id: `${owner.id}-clone-test`,
    ownerId: owner.id,
    archetypeId: "shadow-clone",
    name: "Shadow Clone",
    hp: 30,
    maxHp: 30,
    attack: 10,
    defense: 0,
    magicPower: 0,
    aggro: 0,
    speed: 99,
    activeStatusEffects: [],
    actionsTaken: 0,
    maxActions: 5,
    ...extra,
  };
  ctx.summons.push(clone);
  combat.combatants.push({ ref: { kind: "summon", id: clone.id }, speed: clone.speed });
  return clone;
}

describe("sessions for the less common paths", () => {
  function fight() {
    const { ctx } = makeCtx(11);
    const rats = [spawnInto(ctx, "dungeon-rat"), spawnInto(ctx, "dungeon-rat")];
    for (const r of rats) {
      r.maxHp = r.hp = 50000;
      r.attack = 0;
    }
    const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
    return { ctx, combat, rats };
  }

  test("a death burst is the owner's own session, attacking the monsters", () => {
    const { ctx, combat, rats } = fight();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    addClone(ninja, combat, ctx, { hp: 0, deathBurst: { amount: 5, offenseMultiplierPercent: 0, offensiveStatOverride: 0, statusEffectChance: 0 } });
    resolveRound(combat, ctx);
    const burst = combat.log.find((e) => e.text.includes("Shadow Clone") && e.kind === "attack")!;
    expect(burst.session!.actorId).toBe(ninja.id);
    expect(burst.session!.attackedIds).toEqual(expect.arrayContaining(rats.map((r) => r.id)));
    const damage = combat.log.filter((e) => e.session === burst.session && e.text.includes("takes"));
    expect(damage.length).toBeGreaterThan(0);
  });

  test("every entry of a round carries a snapshot", () => {
    const { ctx, combat } = fight();
    resolveRound(combat, ctx, 1, 0);
    expect(combat.log.slice(1).filter((e) => !e.snapshot)).toEqual([]);
  });

  test("a missed override effect is noted as a miss", () => {
    const { ctx, combat, rats } = fight();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.activeStatusEffects.push({ statusEffectId: "blinded", turnsRemaining: 2 });
    ctx.rng.next = () => 0;
    const sweep = skill({ target: "self", effects: [{ kind: "damage", amount: 1, target: "allEnemies" }], isUltimate: false });
    runInSession(combat, vanguard.id, () => {
      applySkillEffects(sweep, vanguard, [vanguard], combat, ctx, combat.log);
      combat.log.push({ text: "x", kind: "info" });
    });
    expect(combat.log.at(-1)!.session!.missedIds).toEqual(rats.map((r) => r.id));
  });

  test("a summon's missed basic attack is noted against its target, in the owner's session", () => {
    const { ctx, combat, rats } = fight();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    addClone(ninja, combat, ctx, { activeStatusEffects: [{ statusEffectId: "blinded", turnsRemaining: 3 }] });
    ctx.rng.next = () => 0;
    resolveRound(combat, ctx);
    const miss = combat.log.find((e) => e.text.startsWith("Shadow Clone misses"))!;
    expect(miss.session!.actorId).toBe(ninja.id);
    expect(rats.map((r) => r.id)).toContain(miss.session!.missedIds[0]!);
  });

  test("a monster's missed and dodged basic attacks are both noted as misses", () => {
    for (const setupMiss of ["blind", "dodge"] as const) {
      const { ctx, combat, rats } = fight();
      const rat = rats[0]!;
      const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
      for (const c of ctx.party) if (c !== vanguard) c.isAlive = false;
      if (setupMiss === "blind") rat.activeStatusEffects.push({ statusEffectId: "blinded", turnsRemaining: 2 });
      else vanguard.equippedArtifactIds.push("featherweight-boots");
      ctx.rng.next = () => 0;
      runInSession(combat, rat.id, () => runMonsterTurn({ kind: "monster", id: rat.id }, combat, ctx));
      const entry = combat.log.at(-1)!;
      expect(entry.text).toMatch(setupMiss === "blind" ? /misses/ : /dodge/i);
      expect(entry.session!.missedIds).toEqual([vanguard.id]);
    }
  });
});

describe("a summon that left the fight stays in the snapshots with the HP it left with", () => {
  function fightWithClone(extra: Partial<Summon>) {
    const { ctx } = makeCtx(11);
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = rat.hp = 50000;
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    const clone = addClone(ninja, combat, ctx, extra);
    return { ctx, combat, clone };
  }

  test("one that was killed leaves with 0, so the hit that killed it is a change", () => {
    const { ctx, combat, clone } = fightWithClone({ hp: 12, maxHp: 30 });
    const before = snapshotCombatants(combat, ctx);
    clone.hp = 0;
    resolveRound(combat, ctx);
    const after = snapshotCombatants(combat, ctx);
    expect(after.find((s) => s.id === clone.id)).toMatchObject({ hp: 0, isAlive: false });
    expect(hpDeltas(before, after).get(clone.id)).toBe(-12);
  });

  test("one that faded or was dismissed with HP left shows no change", () => {
    const { ctx, combat, clone } = fightWithClone({ hp: 30, maxHp: 30, actionsTaken: 5, maxActions: 5 });
    const before = snapshotCombatants(combat, ctx);
    resolveRound(combat, ctx);
    expect(combat.departedSummons).toEqual([{ id: clone.id, hp: 30, maxHp: 30 }]);
    expect(hpDeltas(before, snapshotCombatants(combat, ctx)).get(clone.id)).toBeUndefined();
  });
});

describe("a summon is told apart from its owner", () => {
  function fight() {
    const { ctx } = makeCtx(11);
    const rats = [spawnInto(ctx, "dungeon-rat"), spawnInto(ctx, "dungeon-rat")];
    for (const r of rats) {
      r.maxHp = r.hp = 50000;
      r.attack = 0;
    }
    const combat = startCombat("r1", rats.map((r) => r.id), ctx, false);
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    return { ctx, combat, rats, ninja };
  }

  test("the summon's own turn names its owner", () => {
    const { ctx, combat, ninja } = fight();
    addClone(ninja, combat, ctx);
    resolveRound(combat, ctx);
    const attack = combat.log.find((e) => e.text.startsWith("Shadow Clone") && e.kind === "attack")!;
    expect(attack.session!.actorId).toBe(ninja.id);
    expect(attack.session!.summonIds).toEqual([ninja.id]);
  });

  test("a summon that is attacked names its owner", () => {
    const { ctx, combat, rats, ninja } = fight();
    const clone = addClone(ninja, combat, ctx);
    runInSession(combat, rats[0]!.id, () => {
      noteBasicAttack(combat, rats[0]!, clone);
      combat.log.push({ text: "x", kind: "attack" });
    });
    expect(combat.log.at(-1)!.session!.summonIds).toEqual([ninja.id]);
  });

  test("a summon that is buffed, healed, misses a turn or ticks names its owner", () => {
    const { ctx, combat, ninja } = fight();
    const clone = addClone(ninja, combat, ctx);
    const noted = (note: () => void) => {
      runInSession(combat, null, () => {
        note();
        combat.log.push({ text: "x", kind: "info" });
      });
      return combat.log.at(-1)!.session!.summonIds;
    };
    expect(noted(() => noteSkillTarget(combat, ninja, clone, [{ kind: "heal", amount: 1 }], false))).toEqual([ninja.id]);
    expect(noted(() => noteSkillTarget(combat, ninja, clone, [{ kind: "applyStatusEffect", statusEffectId: "fortify" }], false))).toEqual([ninja.id]);
    expect(noted(() => noteMiss(combat, clone))).toEqual([ninja.id]);
    expect(noted(() => noteAffected(combat, clone))).toEqual([ninja.id]);
  });

  test("a buff that runs out on a summon names its owner", () => {
    const { ctx, combat, ninja } = fight();
    const clone = addClone(ninja, combat, ctx);
    runInSession(combat, null, () => expireStatusEffect(clone, { statusEffectId: "fortify", turnsRemaining: 0 }, { log: combat.log }));
    const session = combat.log.at(-1)!.session!;
    expect(session.buffLostIds).toEqual([ninja.id]);
    expect(session.summonIds).toEqual([ninja.id]);
  });

  test("a death burst belongs to the summon, so it counts as a summon session", () => {
    const { ctx, combat, ninja } = fight();
    addClone(ninja, combat, ctx, { hp: 0, deathBurst: { amount: 5, offenseMultiplierPercent: 0, offensiveStatOverride: 0, statusEffectChance: 0 } });
    resolveRound(combat, ctx);
    const burst = combat.log.find((e) => e.text.includes("Shadow Clone") && e.kind === "attack")!;
    expect(burst.session!.summonIds).toEqual([ninja.id]);
  });

  test("the owner's own actions never name a summon, nor does the cast that summons it", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    summoner.level = 75;
    summoner.unlockedSkillIds.push("totem-recall");
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = rat.hp = 50000;
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };
    queueAction(combat, self, "totem-recall", [self], ctx);
    resolveRound(combat, ctx);
    expect(ctx.summons.some((s) => s.archetypeId === "recall-totem")).toBe(true);
    const named = combat.log.flatMap((e) => (e.session ? e.session.summonIds : []));
    expect(named).toEqual([]);
  });
});

describe("lifesteal is recorded by the engine", () => {
  function hit(artifactId: string) {
    const { ctx } = makeCtx(5);
    const goblin = spawnInto(ctx, "goblin");
    goblin.hp = goblin.maxHp = 1;
    const combat = startCombat("r1", [goblin.id], ctx, false);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.equippedArtifactIds.push(artifactId);
    vanguard.hp = 10;
    runInSession(combat, vanguard.id, () => applySkillEffects(skill({ target: "singleEnemy", effects: [{ kind: "damage", amount: 50 }] }), vanguard, [goblin], combat, ctx, combat.log));
    return { session: combat.log.at(-1)!.session!, vanguard };
  }

  test("an artifact's lifesteal marks the attacker", () => {
    const { session, vanguard } = hit("vampiric-fang");
    expect(session.lifestealIds).toEqual([vanguard.id]);
  });

  test("a heal on kill is not lifesteal", () => {
    ARTIFACTS.push({ id: "test-heal-on-kill", name: "Test", description: "", rarity: "common", effects: [{ kind: "healOnKill", amount: 25 }] } as (typeof ARTIFACTS)[number]);
    try {
      const { session, vanguard } = hit("test-heal-on-kill");
      expect(vanguard.hp).toBeGreaterThan(10);
      expect(session.lifestealIds).toEqual([]);
    } finally {
      ARTIFACTS.pop();
    }
  });
});

describe("a monster skill's damage is read relative to the caster", () => {
  test("damage scoped to the player's side, cast by a monster, is an attack on the party", () => {
    const { ctx, combat, goblin, vanguard } = setup();
    const partyOnly = skill({ target: "singleEnemy", effects: [{ kind: "damage", amount: 1, appliesToRelation: "ally" }] });
    runInSession(combat, goblin.id, () => applySkillEffects(partyOnly, goblin, [vanguard], combat, ctx, combat.log));
    expect(combat.log.at(-1)!.session!.attackedIds).toEqual([vanguard.id]);
  });
});

describe("a leaving totem lights the allies whose buff it takes with it", () => {
  test("every ally that loses the linked buff is named by the session that logs the expiry", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    summoner.level = 75;
    summoner.unlockedSkillIds.push("totem-recall");
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = rat.hp = 50000;
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };
    queueAction(combat, self, "totem-recall", [self], ctx);
    resolveRound(combat, ctx);

    const buffed = ctx.party.filter((c) => c.activeStatusEffects.some((s) => s.statusEffectId === "totems-strength")).map((c) => c.id);
    expect(buffed.length).toBeGreaterThan(1);
    const totem = ctx.summons.find((s) => s.archetypeId === "recall-totem")!;
    totem.hp = 0;
    const before = combat.log.length;
    resolveRound(combat, ctx);

    const expiries = combat.log.slice(before).filter((e) => e.text.includes("expires"));
    expect(expiries.length).toBeGreaterThanOrEqual(buffed.length);
    const lit = new Set(expiries.flatMap((e) => e.session!.affectedIds));
    for (const id of buffed) expect(lit.has(id)).toBe(true);
    const lost = new Set(expiries.flatMap((e) => e.session!.buffLostIds));
    for (const id of buffed) expect(lost.has(id)).toBe(true);
  });
});

describe("a heal-over-time and a damage-over-time tick on one unit are both recorded", () => {
  function tickBlock(statuses: { statusEffectId: string; turnsRemaining: number; sourceMagicPower?: number }[]) {
    const { ctx } = makeCtx(21);
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = rat.hp = 50000;
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.hp = Math.floor(vanguard.maxHp / 2);
    vanguard.activeStatusEffects.push(...statuses);
    const before = combat.log.length;
    resolveRound(combat, ctx);
    const session = combat.log.slice(before).find((e) => e.session?.cause === "dot")!.session!;
    return { session, vanguard };
  }
  const mending = { statusEffectId: "mending", turnsRemaining: 2, sourceMagicPower: 100 };
  const poisoned = { statusEffectId: "poisoned", turnsRemaining: 2 };

  test("mending and poison on the same unit: it took damage and it was healed", () => {
    const { session, vanguard } = tickBlock([mending, poisoned]);
    expect(session.tickDamageIds).toContain(vanguard.id);
    expect(session.healedIds).toContain(vanguard.id);
  });

  test("mending alone: healed, not damaged", () => {
    const { session, vanguard } = tickBlock([mending]);
    expect(session.healedIds).toContain(vanguard.id);
    expect(session.tickDamageIds).not.toContain(vanguard.id);
  });

  test("poison alone: damaged, not healed", () => {
    const { session, vanguard } = tickBlock([poisoned]);
    expect(session.tickDamageIds).toContain(vanguard.id);
    expect(session.healedIds).not.toContain(vanguard.id);
  });

  test("a heal that changes nothing (full HP) is not recorded", () => {
    const { ctx } = makeCtx(22);
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = rat.hp = 50000;
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.hp = vanguard.maxHp;
    vanguard.activeStatusEffects.push(mending);
    resolveRound(combat, ctx);
    const dot = combat.log.find((e) => e.session?.cause === "dot");
    expect(dot?.session?.healedIds ?? []).not.toContain(vanguard.id);
  });
});

describe("a unit that loses a buff is recorded in the session that logs it", () => {
  function fight() {
    const { ctx } = makeCtx(31);
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = rat.hp = 50000;
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    return { ctx, combat };
  }

  test("a buff that runs out of turns", () => {
    const { ctx, combat } = fight();
    const [a, b] = ctx.party;
    for (const c of [a!, b!]) c.activeStatusEffects.push({ statusEffectId: "guard", turnsRemaining: 1 });
    resolveRound(combat, ctx);
    const expiries = combat.log.filter((e) => e.text.includes("expires"));
    expect(new Set(expiries.map((e) => e.session)).size).toBe(1);
    expect(expiries[0]!.session!.buffLostIds).toEqual(expect.arrayContaining([a!.id, b!.id]));
  });

  test("a heal-over-time wearing off is not a lost buff", () => {
    const { ctx, combat } = fight();
    const patient = ctx.party[0]!;
    patient.hp = Math.floor(patient.maxHp / 2);
    patient.activeStatusEffects.push({ statusEffectId: "mending", turnsRemaining: 1, sourceMagicPower: 100 });
    resolveRound(combat, ctx);
    const expiry = combat.log.find((e) => e.text.includes("expires"));
    expect(expiry).toBeDefined();
    expect(expiry!.session!.buffLostIds).not.toContain(patient.id);
    expect(expiry!.buffLostOf).toBeUndefined();
  });

  test("a status that heals over time and also raises a stat still counts as a buff", () => {
    const { ctx, combat } = fight();
    const patient = ctx.party[0]!;
    const def = getStatusEffect("guard");
    const before = def.perTurnEffects;
    (def as { perTurnEffects: typeof before }).perTurnEffects = [...before, { kind: "heal", amount: 1 }];
    try {
      expect(getStatusEffect("guard").perTurnEffects.some((e) => e.kind === "heal")).toBe(true); // the edit above took effect
      patient.activeStatusEffects.push({ statusEffectId: "guard", turnsRemaining: 1 });
      resolveRound(combat, ctx);
      const expiry = combat.log.find((e) => e.text.includes("expires"));
      expect(expiry!.session!.buffLostIds).toContain(patient.id);
    } finally {
      (def as { perTurnEffects: typeof before }).perTurnEffects = before;
    }
  });

  test("a debuff wearing off is not a lost buff", () => {
    const { ctx, combat } = fight();
    const victim = ctx.party[0]!;
    victim.activeStatusEffects.push({ statusEffectId: "poisoned", turnsRemaining: 1 });
    resolveRound(combat, ctx);
    const expiry = combat.log.find((e) => e.text.includes("expires"));
    expect(expiry).toBeDefined();
    expect(expiry!.session!.buffLostIds).not.toContain(victim.id);
  });

  test("a buff taken off by an effect", () => {
    const { ctx, combat } = fight();
    const [caster, target] = ctx.party;
    target!.activeStatusEffects.push({ statusEffectId: "guard", turnsRemaining: 3 });
    runInSession(combat, caster!.id, () =>
      applySkillEffects(skill({ target: "singleAlly", effects: [{ kind: "removeStatusEffect", statusEffectId: "guard" }] }), caster!, [target!], combat, ctx, combat.log)
    );
    expect(combat.log.at(-1)!.session!.buffLostIds).toContain(target!.id);
  });

  test("a stance spent by an Overwatch shot changes no stat, so it is not a lost buff", () => {
    const { ctx, combat } = fight();
    const archer = ctx.party.find((p) => p.classId === "archer")!;
    archer.activeStatusEffects.push({ statusEffectId: "overwatched", turnsRemaining: 2 });
    resolveRound(combat, ctx);
    const shot = combat.log.find((e) => e.text.includes("Overwatch"))!;
    expect(shot.session!.actorId).toBe(archer.id);
    expect(shot.session!.buffLostIds).not.toContain(archer.id);
  });

  test("stealth wearing off changes no stat either", () => {
    const { ctx, combat } = fight();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    ninja.activeStatusEffects.push({ statusEffectId: "stealthed", turnsRemaining: 1 });
    resolveRound(combat, ctx);
    const expiry = combat.log.find((e) => e.text.includes("expires"));
    expect(expiry).toBeDefined();
    expect(expiry!.session!.buffLostIds).not.toContain(ninja.id);
  });

  test("a stat debuff (enfeebled) wearing off is not a lost buff", () => {
    const { ctx, combat } = fight();
    const hero = ctx.party[0]!;
    hero.activeStatusEffects.push({ statusEffectId: "enfeebled", turnsRemaining: 1 });
    resolveRound(combat, ctx);
    const expiry = combat.log.find((e) => e.text.includes("expires"));
    expect(expiry).toBeDefined();
    expect(expiry!.session!.buffLostIds).not.toContain(hero.id);
  });

  test("a minion that loses a buff is recorded as its owner", () => {
    const { ctx, combat } = fight();
    const owner = ctx.party.find((p) => p.classId === "summoner")!;
    const minion = { id: "s1", ownerId: owner.id, name: "Golem", hp: 5, maxHp: 5, activeStatusEffects: [{ statusEffectId: "guard", turnsRemaining: 3 }] } as unknown as Summon;
    runInSession(combat, owner.id, () =>
      applySkillEffects(skill({ target: "singleAlly", effects: [{ kind: "removeStatusEffect", statusEffectId: "guard" }] }), owner, [minion], combat, ctx, combat.log)
    );
    expect(combat.log.at(-1)!.session!.buffLostIds).toEqual([owner.id]);
  });
});

describe("a unit that loses its turn is recorded in its own session", () => {
  function fight() {
    const { ctx } = makeCtx(41);
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = rat.hp = 50000;
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    return { ctx, combat, rat };
  }
  const lostTurn = (combat: CombatState, text: string) => combat.log.find((e) => e.text.includes(text))!.session!;

  test.each(["stunned", "stagger", "deafening-charges-din"])("a character stunned by %s", (statusEffectId) => {
    const { ctx, combat, rat } = fight();
    const hero = ctx.party.find((p) => p.classId === "vanguard")!;
    queueAction(combat, { kind: "character", id: hero.id }, hero.unlockedSkillIds[0]!, [{ kind: "monster", id: rat.id }], ctx);
    hero.activeStatusEffects.push({ statusEffectId, turnsRemaining: 3 });
    resolveRound(combat, ctx);
    const session = lostTurn(combat, "too dazed to act");
    expect(session.actorId).toBe(hero.id);
    expect(session.lostTurnIds).toEqual([hero.id]);
    expect(session.attackedIds).toEqual([]);
  });

  test("a stunned monster", () => {
    const { ctx, combat, rat } = fight();
    rat.activeStatusEffects.push({ statusEffectId: "stunned", turnsRemaining: 3 });
    resolveRound(combat, ctx);
    const session = lostTurn(combat, "too dazed to act");
    expect(session.actorId).toBe(rat.id);
    expect(session.lostTurnIds).toEqual([rat.id]);
  });

  test("a stunned minion loses its turn on its owner", () => {
    const { ctx } = makeCtx(42);
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    summoner.level = 75;
    summoner.unlockedSkillIds.push("totem-recall");
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.maxHp = rat.hp = 50000;
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };
    queueAction(combat, self, "totem-recall", [self], ctx);
    resolveRound(combat, ctx);
    const totem = ctx.summons.find((s) => s.archetypeId === "recall-totem")!;
    totem.activeStatusEffects.push({ statusEffectId: "stunned", turnsRemaining: 3 });
    resolveRound(combat, ctx);
    const session = lostTurn(combat, "too dazed to act");
    expect(session.lostTurnIds).toEqual([summoner.id]);
  });

  test("a character too afraid to act", () => {
    const { ctx, combat, rat } = fight();
    const hero = ctx.party.find((p) => p.classId === "vanguard")!;
    hero.survival.fear = 100;
    ctx.rng.next = () => 0; // every control roll fails
    queueAction(combat, { kind: "character", id: hero.id }, hero.unlockedSkillIds[0]!, [{ kind: "monster", id: rat.id }], ctx);
    resolveRound(combat, ctx);
    const session = lostTurn(combat, "too afraid to act");
    expect(session.actorId).toBe(hero.id);
    expect(session.lostTurnIds).toEqual([hero.id]);
  });

  test("a monster whose turn an Overwatch shot cancels", () => {
    const { ctx, combat, rat } = fight();
    const archer = ctx.party.find((p) => p.classId === "archer")!;
    archer.activeStatusEffects.push({ statusEffectId: "overwatched", turnsRemaining: 2 });
    ctx.rng.chance = () => true; // the interrupt roll succeeds
    resolveRound(combat, ctx);
    const session = lostTurn(combat, "interrupting");
    expect(session.actorId).toBe(archer.id);
    expect(session.lostTurnIds).toEqual([rat.id]);
  });

  test("a monster whose turn proceeds despite the shot loses nothing", () => {
    const { ctx, combat } = fight();
    const archer = ctx.party.find((p) => p.classId === "archer")!;
    archer.activeStatusEffects.push({ statusEffectId: "overwatched", turnsRemaining: 2 });
    ctx.rng.chance = () => false; // the interrupt roll fails
    resolveRound(combat, ctx);
    expect(lostTurn(combat, "its turn proceeds").lostTurnIds).toEqual([]);
  });

  test("a turn that is simply played loses nothing", () => {
    const { ctx, combat } = fight();
    resolveRound(combat, ctx);
    expect(combat.log.every((e) => (e.session?.lostTurnIds ?? []).length === 0)).toBe(true);
  });
});

describe("statusRole: only a stat change is a buff or a debuff", () => {
  const role = (id: string) => statusRole(getStatusEffect(id));
  test("stat modifiers are buffs or debuffs by the direction of the change", () => {
    for (const id of ["guard", "rallied", "fortify", "empower", "totems-strength", "whetstones-edge"]) expect(role(id)).toBe("buff");
    for (const id of ["weakened", "slowed", "corroded", "shredded", "distracted", "enfeebled"]) expect(role(id)).toBe("debuff");
  });
  test("a change expressed only through minPercent still has a direction", () => {
    const onlyPercent = (minPercent: number) => ({
      ...getStatusEffect("enfeebled"),
      perTurnEffects: [{ kind: "modifyCombatStat" as const, combatStat: "attack" as const, amount: 0, minPercent }],
    });
    expect(statusRole(onlyPercent(-15))).toBe("debuff");
    expect(statusRole(onlyPercent(15))).toBe("buff");
  });
  test("a stun and a blind are debuffs of their own, though they change no stat", () => {
    for (const id of ["stunned", "stagger", "deafening-charges-din", "blinded", "smoke-pellets-haze"]) expect(role(id)).toBe("debuff");
  });
  test("a status that also deals damage and cuts a stat is a debuff", () => {
    expect(role("agony")).toBe("debuff");
  });
  test("a heal-over-time is a heal, not a buff", () => {
    for (const id of ["mending", "mending-iii", "regeneration", "bandage-rolls-mend", "knitting-iii"]) expect(role(id)).toBe("heal");
  });
  test("damage over time, vulnerability, stealth and stances are neither", () => {
    for (const id of ["poisoned", "burning", "bleeding", "poison-vulnerable", "stealthed", "overwatched", "poison-coated", "storm-empowered"]) {
      expect(role(id)).toBeNull();
    }
  });
});

describe("noteSkillTarget reads statuses by what they change", () => {
  function noted(effects: SkillEffect[], side: "enemy" | "ally") {
    const { combat, vanguard, acolyte, goblin } = setup();
    const target = side === "enemy" ? goblin : acolyte;
    runInSession(combat, vanguard.id, () => {
      noteSkillTarget(combat, vanguard, target, effects, false);
      combat.log.push({ text: "x", kind: "info" });
    });
    return { session: combat.log.at(-1)!.session!, target };
  }
  const status = (statusEffectId: string): SkillEffect => ({ kind: "applyStatusEffect", statusEffectId, durationTurns: 2 });

  test("a heal-over-time on an ally is a heal", () => {
    const { session, target } = noted([status("mending")], "ally");
    expect(session.healedIds).toEqual([target.id]);
    expect(session.buffedIds).toEqual([]);
  });

  test("a stat buff on an ally is a buff", () => {
    expect(noted([status("rallied")], "ally").session.buffedIds).toHaveLength(1);
  });

  test("a stance on an ally changes no stat: the ally is lit and nothing more", () => {
    for (const id of ["overwatched", "stealthed", "poison-coated"]) {
      const { session, target } = noted([status(id)], "ally");
      expect(session.buffedIds).toEqual([]);
      expect(session.healedIds).toEqual([]);
      expect(session.affectedIds).toEqual([target.id]);
    }
  });

  test("a stat debuff on an enemy is a debuff, including one written through minPercent", () => {
    for (const id of ["weakened", "slowed", "enfeebled"]) expect(noted([status(id)], "enemy").session.debuffedIds).toHaveLength(1);
    expect(noted([{ kind: "modifyCombatStat", combatStat: "attack", amount: 0, minPercent: -15 }], "enemy").session.debuffedIds).toHaveLength(1);
  });

  test("a stun or a blind on an enemy is a debuff of its own", () => {
    for (const id of ["stunned", "stagger", "blinded"]) expect(noted([status(id)], "enemy").session.debuffedIds).toHaveLength(1);
  });

  test("poison or vulnerability on an enemy changes no stat: the enemy is lit and nothing more", () => {
    for (const id of ["poisoned", "burning", "poison-vulnerable"]) {
      const { session, target } = noted([status(id)], "enemy");
      expect(session.debuffedIds).toEqual([]);
      expect(session.affectedIds).toEqual([target.id]);
    }
  });
});
