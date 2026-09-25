import { describe, test, expect } from "bun:test";
import { applySkillEffects, startCombat } from "../src/engine/combat";
import { spawnMonster } from "../src/data/monsters";
import { makeCtx } from "./helpers";
import type { LogEntry, SkillDefinition } from "../src/types";

function attackSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: "test-viking-attack",
    name: "Test Attack",
    description: "",
    target: "singleEnemy",
    effects: [{ kind: "damage", amount: 5 }],
    slot: 1,
    unlockLevel: 1,
    mpCost: 0,
    ...overrides,
  };
}

describe("Viking passive: low-HP damage buff with self-cost", () => {
  test("below the HP threshold, outgoing damage is boosted by the rank's percent", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.level = 35; // rank 3: threshold 50%, bonus 40%
    const combat = startCombat("test-room", [], ctx, false);

    viking.hp = viking.maxHp;
    const targetAbove = spawnMonster("goblin", 1);
    applySkillEffects(attackSkill(), viking, [targetAbove], combat, ctx, []);
    const dealtAbove = targetAbove.maxHp - targetAbove.hp;

    viking.hp = Math.round(viking.maxHp * 0.4); // below the 50% threshold
    const targetBelow = spawnMonster("goblin", 1);
    applySkillEffects(attackSkill(), viking, [targetBelow], combat, ctx, []);
    const dealtBelow = targetBelow.maxHp - targetBelow.hp;

    expect(dealtBelow).toBeGreaterThan(dealtAbove);
  });

  test("above the HP threshold, no bonus applies and no self-damage occurs", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.level = 35;
    viking.hp = viking.maxHp;
    const combat = startCombat("test-room", [], ctx, false);
    const target = spawnMonster("goblin", 1);
    applySkillEffects(attackSkill(), viking, [target], combat, ctx, []);
    expect(viking.hp).toBe(viking.maxHp);
  });

  test("landing an attack while under the threshold costs the Viking 3% of maxHp, regardless of rank", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.level = 5; // rank 1: threshold 40%, bonus 20% — different rank than the other tests
    viking.hp = Math.round(viking.maxHp * 0.3); // below the 40% threshold
    const before = viking.hp;
    const combat = startCombat("test-room", [], ctx, false);
    const target = spawnMonster("goblin", 1);
    applySkillEffects(attackSkill(), viking, [target], combat, ctx, []);
    expect(before - viking.hp).toBe(Math.round(viking.maxHp * 0.03));
  });

  test("a buff-only skill (isBuff: true) never triggers the bonus or the self-damage", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.level = 35;
    viking.hp = Math.round(viking.maxHp * 0.4); // below threshold
    const before = viking.hp;
    const combat = startCombat("test-room", [], ctx, false);
    const target = spawnMonster("goblin", 1);
    const log: LogEntry[] = [];
    applySkillEffects(attackSkill({ isBuff: true }), viking, [target], combat, ctx, log);
    expect(viking.hp).toBe(before);

    const targetBaseline = spawnMonster("goblin", 1);
    applySkillEffects(attackSkill({ isBuff: true }), viking, [targetBaseline], combat, ctx, []);
    const dealtAsBuff = targetBaseline.maxHp - targetBaseline.hp;

    viking.hp = viking.maxHp; // above threshold, so the passive would never fire anyway
    const targetControl = spawnMonster("goblin", 1);
    applySkillEffects(attackSkill({ isBuff: true }), viking, [targetControl], combat, ctx, []);
    const dealtControl = targetControl.maxHp - targetControl.hp;
    expect(dealtAsBuff).toBe(dealtControl);
  });

  test("self-damage from this can never drop the Viking below 1 HP", () => {
    const { ctx } = makeCtx();
    const viking = ctx.party.find((p) => p.classId === "viking")!;
    viking.level = 35;
    viking.hp = 1;
    const combat = startCombat("test-room", [], ctx, false);
    const target = spawnMonster("goblin", 1);
    applySkillEffects(attackSkill(), viking, [target], combat, ctx, []);
    expect(viking.hp).toBe(1);
  });
});
