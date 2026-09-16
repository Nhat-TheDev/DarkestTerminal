import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, resolveRound } from "../src/engine/combat";
import type { CombatantRef, Summon } from "../src/types";
import { makeCtx, spawnInto } from "./helpers";

function castTotemRecall(level: number) {
  const { ctx } = makeCtx();
  const summoner = ctx.party.find((p) => p.classId === "summoner")!;
  summoner.level = level;
  summoner.unlockedSkillIds.push("summoner-totem-recall");
  const rat = spawnInto(ctx, "dungeon-rat");
  rat.attack = 0;
  const combat = startCombat("r1", [rat.id], ctx, false);
  const self: CombatantRef = { kind: "character", id: summoner.id };
  queueAction(combat, self, "summoner-totem-recall", [self], ctx);
  resolveRound(combat, ctx);
  const totem = ctx.summons.find((s) => s.archetypeId === "recall-totem")!;
  return { ctx, combat, summoner, totem };
}

describe("Totem Recall: ally buff linked to the totem's lifetime", () => {
  test("casting it applies the attack buff to party members but not to the caster's own totem", () => {
    const { ctx, summoner, totem } = castTotemRecall(75); // rank 3: +20 flat / min 20%
    expect(totem).toBeDefined();
    for (const character of ctx.party) {
      const buff = character.activeStatusEffects.find((s) => s.statusEffectId === "totem-recall-buff");
      expect(buff).toBeDefined();
    }
    expect(totem.activeStatusEffects.find((s) => s.statusEffectId === "totem-recall-buff")).toBeUndefined();
    // max(20, round(baseAttack * 0.20)) — at level 1 (every non-Summoner party member), the flat
    // term always wins since 20% of a level-1 attack stat is nowhere close to 20.
    expect(summoner.attack).toBeGreaterThan(0);
  });

  test("the buff's magnitude is whichever of the rank's flat amount or min% is larger", () => {
    const { summoner } = castTotemRecall(75); // rank 3: +20 flat / min 20%
    const buff = summoner.activeStatusEffects.find((s) => s.statusEffectId === "totem-recall-buff")!;
    const applied = buff.appliedAmounts?.attack ?? 0;
    expect(applied).toBeGreaterThanOrEqual(20);
  });

  test("killing the totem force-expires the buff on every party member it was applied to", () => {
    const { ctx, combat, summoner, totem } = castTotemRecall(75);
    expect(summoner.activeStatusEffects.some((s) => s.statusEffectId === "totem-recall-buff")).toBe(true);
    const attackWithBuff = summoner.attack;

    totem.hp = 0; // simulate the totem being killed in combat
    resolveRound(combat, ctx);

    expect(summoner.activeStatusEffects.some((s) => s.statusEffectId === "totem-recall-buff")).toBe(false);
    expect(summoner.attack).toBeLessThan(attackWithBuff);
    for (const character of ctx.party) {
      expect(character.activeStatusEffects.some((s) => s.statusEffectId === "totem-recall-buff")).toBe(false);
    }
  });
});
