import { describe, expect, test } from "bun:test";
import { startCombat } from "../src/engine/combat";
import { noteAffected, noteBasicAttack, noteSkillTarget, runInSession, runTicksInSession, unitId } from "../src/engine/logSession";
import type { Actor } from "../src/engine/resolver";
import type { SkillEffect } from "../src/types";
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
    runInSession(combat, null, () => combat.log.push({ text: "tick", kind: "info" }), [goblin.id]);
    expect(combat.log.at(-1)!.session).toMatchObject({ actorId: null, affectedIds: [goblin.id] });
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

  test("a harmful effect on a same-side target (self-cost) is not noted", () => {
    const { session } = noted([weakenDebuff, damage], "ally");
    expect(session.buffedIds).toEqual([]);
    expect(session.attackedIds).toEqual([]);
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
