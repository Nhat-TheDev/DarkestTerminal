import { describe, test, expect } from "bun:test";
import { startCombat } from "../src/engine/combat";
import { fillTelegraphMeter, runMonsterTurn } from "../src/engine/monsterAI";
import { applyArtifactReflectDamage } from "../src/engine/combatHooks";
import { resolveSkillEffect } from "../src/engine/resolver";
import { getArchetype, getBossTelegraph, getMonsterSkill, spawnMonster } from "../src/data/monsters";
import type { Character, Monster } from "../src/types";
import { makeCtx, withoutDamageRolls } from "./helpers";

withoutDamageRolls();

function founderFight() {
  const { ctx } = makeCtx(1);
  const founder = spawnMonster("the-founder", 1, { tier: "boss" });
  ctx.monsters.push(founder);
  for (const c of ctx.party) c.maxHp = c.hp = 1e9;
  const combat = startCombat("r1", [founder.id], ctx, true);
  const turn = () => {
    fillTelegraphMeter(founder, combat, ctx);
    runMonsterTurn({ kind: "monster", id: founder.id }, combat, ctx);
  };
  const strike = (amount: number) =>
    resolveSkillEffect({ kind: "damage", amount, ignoreDefensePercent: 100 }, ctx.party[0] as Character, founder, { log: combat.log, rollDamage: () => 0 });
  const empty = () => strike(founder.hp);
  return { ctx, founder, combat, turn, strike, empty };
}

const bars = () => getArchetype("the-founder").bars!;

describe("the Founder's three HP bars", () => {
  test("he opens on a first bar that is a share of his scaled max HP", () => {
    const founder = spawnMonster("the-founder", 1, { tier: "boss" });
    expect(founder.barBaseHp).toBeGreaterThan(0);
    expect(founder.maxHp).toBe(Math.round(founder.barBaseHp! * bars()[0]!.hpMultiplier));
    expect(founder.hp).toBe(founder.maxHp);
  });

  test("emptying bar 1 or 2 starts the next bar full, empties the meter and keeps his debuffs", () => {
    const { founder, empty, turn } = founderFight();
    founder.activeStatusEffects.push({ statusEffectId: "blinded", turnsRemaining: 3 });
    turn();
    expect(founder.telegraphMeter).toBe(1);
    for (const next of [1, 2]) {
      empty();
      expect(founder.hp).toBeGreaterThan(0);
      expect(founder.barIndex).toBe(next);
      expect(founder.maxHp).toBe(Math.round(founder.barBaseHp! * bars()[next]!.hpMultiplier));
      expect(founder.hp).toBe(founder.maxHp);
      expect(founder.telegraphMeter).toBe(0);
      expect(founder.activeStatusEffects.some((s) => s.statusEffectId === "blinded")).toBe(true);
    }
  });

  test("emptying bar 3 kills him", () => {
    const { founder, combat, empty } = founderFight();
    empty();
    empty();
    empty();
    expect(founder.hp).toBe(0);
    expect(combat.log.some((l) => l.kind === "death")).toBe(true);
  });

  test("each new bar opens with its own entry cast, once, and a meter that starts over", () => {
    const { founder, empty, turn } = founderFight();
    empty();
    turn();
    expect(founder.activeStatusEffects.some((s) => s.statusEffectId === "knitting-ii")).toBe(true);
    expect(founder.telegraphMeter).toBe(0);
    expect(founder.barEntryPending).toBe(false);
    turn();
    expect(founder.telegraphMeter).toBe(1);
    empty();
    const before = founder.activeStatusEffects.filter((s) => s.statusEffectId === "knitting-ii").length;
    turn();
    expect(founder.barEntryPending).toBe(false);
    expect(founder.activeStatusEffects.filter((s) => s.statusEffectId === "knitting-ii").length).toBe(before);
  });

  test("a bar emptied with a full meter still opens with its entry before any release", () => {
    const { founder, combat, ctx, empty, turn } = founderFight();
    empty();
    founder.telegraphMeter = 5;
    const mark = combat.log.length;
    turn();
    expect(combat.log.slice(mark).some((l) => l.text.includes("unleashes"))).toBe(false);
    expect(founder.telegraphMeter).toBe(0);
    expect(ctx.party.every((c) => c.hp === 1e9)).toBe(true);
  });

  test("bar 1 releases a single-target telegraph after its own meter length", () => {
    const { ctx, turn } = founderFight();
    const { skillId, meterLength } = getBossTelegraph(getArchetype("the-founder"), 0)!;
    expect(getMonsterSkill(skillId).target).toBe("singleEnemy");
    for (let i = 0; i < meterLength - 1; i++) turn();
    const before = ctx.party.map((c) => c.hp);
    turn();
    expect(ctx.party.filter((c, i) => c.hp < before[i]!)).toHaveLength(1);
  });

  function releaseOnBar(index: number) {
    const fight = founderFight();
    for (let i = 0; i < index; i++) fight.empty();
    fight.turn();
    const { skillId, meterLength } = getBossTelegraph(getArchetype("the-founder"), index)!;
    expect(fight.founder.telegraphMeter).toBe(0);
    const skill = getMonsterSkill(skillId);
    fight.founder.activeStatusEffects = [];
    fight.founder.telegraphMeter = meterLength;
    const mark = fight.combat.log.length;
    const before = fight.ctx.party.map((c) => c.hp);
    fight.turn();
    const hit = fight.ctx.party.filter((c, i) => c.hp < before[i]!);
    expect(fight.combat.log.slice(mark).some((l) => l.text.includes(`unleashes ${skill.name}`))).toBe(true);
    return { hit, party: fight.ctx.party };
  }

  test("bar 2 releases a telegraph that hits two or three distinct characters", () => {
    const { hit } = releaseOnBar(1);
    expect(hit.length).toBeGreaterThanOrEqual(2);
    expect(hit.length).toBeLessThanOrEqual(3);
  });

  test("bar 3 releases a telegraph that hits every living character", () => {
    const { hit, party } = releaseOnBar(2);
    expect(hit).toHaveLength(party.length);
  });

  test("telegraph meter lengths per bar stay in 3-5 and never shrink as the hit widens", () => {
    const lengths = bars().map((_, i) => getBossTelegraph(getArchetype("the-founder"), i)!.meterLength);
    for (const n of lengths) expect(n >= 3 && n <= 5).toBe(true);
    expect([...lengths].sort((a, b) => a - b)).toEqual(lengths);
  });

  test("an artifact reflect that would empty a bar moves him to the next bar instead of killing him", () => {
    const { ctx, founder } = founderFight();
    const bearer = ctx.party[0]!;
    bearer.equippedArtifactIds = ["thorned-armor"];
    applyArtifactReflectDamage(bearer, founder, 1e9, []);
    expect(founder.hp).toBeGreaterThan(0);
    expect(founder.barIndex).toBe(1);
    expect(founder.hp).toBe(founder.maxHp);
  });

  test("an archetype without bars is untouched: its HP is the whole bar and it dies at 0", () => {
    const { ctx } = makeCtx(1);
    const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });
    expect(boss.barBaseHp).toBeUndefined();
    ctx.monsters.push(boss);
    const combat = startCombat("r1", [boss.id], ctx, true);
    resolveSkillEffect({ kind: "damage", amount: boss.hp, ignoreDefensePercent: 100 }, ctx.party[0] as Character, boss as Monster, { log: combat.log, rollDamage: () => 0 });
    expect(boss.hp).toBe(0);
  });
});
