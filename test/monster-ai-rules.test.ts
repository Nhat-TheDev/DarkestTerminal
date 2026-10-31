import { describe, test, expect } from "bun:test";
import { predicateHolds, scoreWeight, type AiView } from "../src/engine/monsterAiRules";
import { spawnMonster } from "../src/data/monsters";
import { makeCtx } from "./helpers";

function view(): AiView {
  const { ctx } = makeCtx(1);
  const self = spawnMonster("skeleton-guard", 1, { tier: "boss" });
  return { self, enemies: ctx.party.slice(0, 4), allies: [] };
}
const status = (id: string) => ({ statusEffectId: id, turnsRemaining: 2 });

describe("predicateHolds", () => {
  test("selfHpBelowPercent", () => {
    const v = view();
    v.self.hp = v.self.maxHp * 0.6;
    expect(predicateHolds({ selfHpBelowPercent: 50 }, v)).toBe(false);
    v.self.hp = v.self.maxHp * 0.4;
    expect(predicateHolds({ selfHpBelowPercent: 50 }, v)).toBe(true);
  });
  test("self status, matching the rank family", () => {
    const v = view();
    expect(predicateHolds({ selfHasStatusId: "poisoned" }, v)).toBe(false);
    v.self.activeStatusEffects.push(status("poisoned-iii"));
    expect(predicateHolds({ selfHasStatusId: "poisoned" }, v)).toBe(true);
    expect(predicateHolds({ selfLacksStatusId: "poisoned" }, v)).toBe(false);
  });
  test("target status: candidate vs any enemy", () => {
    const v = view();
    v.enemies[2]!.activeStatusEffects.push(status("bleeding"));
    expect(predicateHolds({ targetHasStatusId: "bleeding" }, v)).toBe(true);
    expect(predicateHolds({ targetHasStatusId: "bleeding" }, v, v.enemies[0])).toBe(false);
    expect(predicateHolds({ targetHasStatusId: "bleeding" }, v, v.enemies[2])).toBe(true);
    expect(predicateHolds({ targetLacksStatusId: "bleeding" }, v, v.enemies[2])).toBe(false);
  });
  test("targetHpBelowPercent and targetsBelowHpPercent/atLeast", () => {
    const v = view();
    v.enemies[0]!.hp = v.enemies[0]!.maxHp * 0.3;
    expect(predicateHolds({ targetHpBelowPercent: 40 }, v, v.enemies[0])).toBe(true);
    expect(predicateHolds({ targetHpBelowPercent: 40 }, v, v.enemies[1])).toBe(false);
    expect(predicateHolds({ targetsBelowHpPercent: 50, atLeast: 2 }, v)).toBe(false);
    v.enemies[1]!.hp = v.enemies[1]!.maxHp * 0.3;
    expect(predicateHolds({ targetsBelowHpPercent: 50, atLeast: 2 }, v)).toBe(true);
  });
  test("alliesFewerThan", () => {
    const v = view();
    expect(predicateHolds({ alliesFewerThan: 1 }, v)).toBe(true);
    v.allies.push(spawnMonster("goblin", 1));
    expect(predicateHolds({ alliesFewerThan: 1 }, v)).toBe(false);
  });
  test("every field must hold", () => {
    const v = view();
    v.self.hp = v.self.maxHp * 0.4;
    expect(predicateHolds({ selfHpBelowPercent: 50, selfHasStatusId: "guard" }, v)).toBe(false);
  });
});

describe("scoreWeight", () => {
  test("multiplies every matching rule and ignores the rest", () => {
    const v = view();
    v.self.hp = v.self.maxHp * 0.4;
    const rules = [
      { if: { selfHpBelowPercent: 50 }, weightMultiplier: 3 },
      { if: { selfHasStatusId: "guard" }, weightMultiplier: 0.5 },
      { if: {}, weightMultiplier: 2 },
    ];
    expect(scoreWeight(10, rules, v)).toBe(60);
    expect(scoreWeight(10, undefined, v)).toBe(10);
  });
});
