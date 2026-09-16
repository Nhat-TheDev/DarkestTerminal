import { describe, test, expect } from "bun:test";
import { applySkillEffects, startCombat, spawnAdditionalSummon } from "../src/engine/combat";
import { getSkill } from "../src/data/classes";
import { spawnMonster } from "../src/data/monsters";
import { makeCtx } from "./helpers";

function aliveNinjaClones(ctx: ReturnType<typeof makeCtx>["ctx"], ownerId: string) {
  return ctx.summons.filter((s) => s.ownerId === ownerId && s.archetypeId === "ninja-clone" && s.hp > 0);
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
      spawnAdditionalSummon({ kind: "summon", summonCastId: "ninja-shadow-clone" }, ninja, combat, ctx, []); // seed 1 existing clone
      const target = spawnMonster("goblin", 1);
      target.hp = 1_000_000;
      applySkillEffects(getSkill("ninja-kunai-strike"), ninja, [target], combat, ctx, []);
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
    spawnAdditionalSummon({ kind: "summon", summonCastId: "ninja-shadow-clone" }, ninja, combat, ctx, []);
    spawnAdditionalSummon({ kind: "summon", summonCastId: "ninja-shadow-clone" }, ninja, combat, ctx, []);
    expect(aliveNinjaClones(ctx, ninja.id).length).toBe(2);

    const target = spawnMonster("goblin", 1);
    target.hp = 1_000_000;
    const attackSkill = getSkill("ninja-kunai-strike");
    for (let i = 0; i < 50; i++) applySkillEffects(attackSkill, ninja, [target], combat, ctx, []);
    expect(aliveNinjaClones(ctx, ninja.id).length).toBe(2);
  });
});
