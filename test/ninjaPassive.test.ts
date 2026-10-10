import { describe, test, expect } from "bun:test";
import { applySkillEffects, startCombat, spawnAdditionalSummon } from "../src/engine/combat";
import { getSkill } from "../src/data/classes";
import { spawnMonster } from "../src/data/monsters";
import { makeCtx } from "./helpers";
import type { LogEntry } from "../src/types";

function aliveNinjaClones(ctx: ReturnType<typeof makeCtx>["ctx"], ownerId: string) {
  return ctx.summons.filter((s) => s.ownerId === ownerId && s.archetypeId === "shadow-clone" && s.hp > 0);
}

describe("Ninja passive: 2nd clone on hit", () => {
  test("a Ninja attack landing has a chance to spawn a 2nd shadow clone", () => {
    const trials = 300;
    let spawned = 0;
    for (let i = 0; i < trials; i++) {
      const { ctx } = makeCtx(i + 1);
      const ninja = ctx.party.find((p) => p.classId === "ninja")!;
      ninja.level = 35; // rank 3: 30% chance
      const combat = startCombat("test-room", [], ctx, false);
      spawnAdditionalSummon({ kind: "summon", summonCastId: "shadow-clone" }, ninja, combat, ctx, []); // seed 1 existing clone
      const target = spawnMonster("goblin", 1);
      target.hp = 1_000_000;
      applySkillEffects(getSkill("kunai-strike"), ninja, [target], combat, ctx, []);
      if (aliveNinjaClones(ctx, ninja.id).length === 2) spawned++;
    }
    const rate = spawned / trials;
    // Expected 30%; wide tolerance keeps this test stable across rng seed changes.
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.4);
  });

  test("the 2nd-clone chance is a no-op while 2 clones are already alive", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    ninja.level = 35;
    const combat = startCombat("test-room", [], ctx, false);
    spawnAdditionalSummon({ kind: "summon", summonCastId: "shadow-clone" }, ninja, combat, ctx, []);
    spawnAdditionalSummon({ kind: "summon", summonCastId: "shadow-clone" }, ninja, combat, ctx, []);
    expect(aliveNinjaClones(ctx, ninja.id).length).toBe(2);

    const target = spawnMonster("goblin", 1);
    target.hp = 1_000_000;
    const attackSkill = getSkill("kunai-strike");
    for (let i = 0; i < 50; i++) applySkillEffects(attackSkill, ninja, [target], combat, ctx, []);
    expect(aliveNinjaClones(ctx, ninja.id).length).toBe(2);
  });

  function dummy() {
    const target = spawnMonster("goblin", 1);
    target.hp = 1_000_000;
    return target;
  }

  /** Lands Kunai Strike until the passive clone appears (rank 3: 30% a hit). */
  function procPassiveClone(ctx: ReturnType<typeof makeCtx>["ctx"], ninja: ReturnType<typeof makeCtx>["ctx"]["party"][number], combat: ReturnType<typeof startCombat>, log: LogEntry[] = []) {
    const target = dummy();
    for (let i = 0; i < 100 && !ctx.summons.some((s) => s.fromPassive && s.hp > 0); i++) applySkillEffects(getSkill("kunai-strike"), ninja, [target], combat, ctx, log);
    return target;
  }

  test("the passive's clone is named Shadow Clone II and flagged as the passive's", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    ninja.level = 35;
    const combat = startCombat("test-room", [], ctx, false);
    applySkillEffects(getSkill("shadow-strike"), ninja, [dummy()], combat, ctx, []);
    const log: LogEntry[] = [];
    procPassiveClone(ctx, ninja, combat, log);

    const texts = log.map((l) => l.text);
    expect(texts).toContain(`A second shadow stands up behind ${ninja.name}: Shadow Clone II.`);
    expect(texts).not.toContain(`${ninja.name} summons Shadow Clone II.`);
    const clones = aliveNinjaClones(ctx, ninja.id);
    expect(clones.map((s) => s.name).sort()).toEqual(["Shadow Clone", "Shadow Clone II"]);
    expect(clones.find((s) => s.name === "Shadow Clone II")!.fromPassive).toBe(true);
    expect(clones.find((s) => s.name === "Shadow Clone")!.fromPassive).toBeUndefined();
  });

  test("no 2nd passive clone spawns while Shadow Clone II is alive, even after the cast clone is gone", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    ninja.level = 35;
    const combat = startCombat("test-room", [], ctx, false);
    applySkillEffects(getSkill("shadow-strike"), ninja, [dummy()], combat, ctx, []);
    const target = procPassiveClone(ctx, ninja, combat);
    ctx.summons.find((s) => !s.fromPassive)!.hp = 0;

    for (let i = 0; i < 50; i++) applySkillEffects(getSkill("kunai-strike"), ninja, [target], combat, ctx, []);
    expect(aliveNinjaClones(ctx, ninja.id).map((s) => s.name)).toEqual(["Shadow Clone II"]);
  });

  test("recasting Shadow Clone replaces only the cast clone and keeps Shadow Clone II", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    ninja.level = 35;
    const combat = startCombat("test-room", [], ctx, false);
    applySkillEffects(getSkill("shadow-strike"), ninja, [dummy()], combat, ctx, []);
    procPassiveClone(ctx, ninja, combat);
    const passiveClone = ctx.summons.find((s) => s.fromPassive)!;
    const castClone = ctx.summons.find((s) => !s.fromPassive)!;

    applySkillEffects(getSkill("shadow-strike"), ninja, [dummy()], combat, ctx, []);
    expect(castClone.hp).toBe(0);
    expect(passiveClone.hp).toBeGreaterThan(0);
    expect(aliveNinjaClones(ctx, ninja.id).map((s) => s.name).sort()).toEqual(["Shadow Clone", "Shadow Clone II"]);

    // With only II alive, a recast adds a cast clone beside it instead of replacing it.
    for (const s of ctx.summons) if (!s.fromPassive) s.hp = 0;
    applySkillEffects(getSkill("shadow-strike"), ninja, [dummy()], combat, ctx, []);
    expect(passiveClone.hp).toBeGreaterThan(0);
    expect(aliveNinjaClones(ctx, ninja.id).map((s) => s.name).sort()).toEqual(["Shadow Clone", "Shadow Clone II"]);
  });
});
