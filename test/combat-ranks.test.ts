import { describe, test, expect } from "bun:test";
import { Rng } from "../src/engine/rng";
import { getActorByRef, startCombat, queueAction, resolveRound, livingMonsterRefs, livingCharacterRefs, isCombatOver } from "../src/engine/combat";
import type { CombatantRef } from "../src/types";
import { makeCtx, spawnInto, pickAnyAction } from "./helpers";

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

  test("isBuff skills get +20 speed for this round's turn order only", () => {
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

  test("MP is deducted at resolution, not at queue time", () => {
    const { ctx } = makeCtx();
    const combat = startCombat("r1", [ctx.monsters[0]!.id], ctx, false);
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    const mpBefore = mage.mp;
    const enemy = livingMonsterRefs(combat, ctx)[0]!;
    queueAction(combat, { kind: "character", id: mage.id }, "mage-fireball", [enemy], ctx);
    expect(mage.mp).toBe(mpBefore);
    resolveRound(combat, ctx);
    expect(mage.mp).toBe(mpBefore - 5);
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

