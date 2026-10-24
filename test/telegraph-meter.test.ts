import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, resolveRound, livingCharacterRefs, applySkillEffects } from "../src/engine/combat";
import { fillTelegraphMeter, runMonsterTurn, finishMonsterTurn } from "../src/engine/monsterAI";
import { getBossTelegraph, getArchetype, spawnMonster, MONSTER_SKILLS } from "../src/data/monsters";
import { getSkill, getEffectiveSkill } from "../src/data/classes";
import { makeCtx, pickAnyAction, withoutDamageRolls } from "./helpers";

withoutDamageRolls();

/** A boss against the default party with huge HP on both sides; `turn` is what a round does for the boss: fill, then act. */
function bossFight(archetypeId: string, seed = 1) {
  const { ctx } = makeCtx(seed);
  const boss = spawnMonster(archetypeId, 1, { tier: "boss" });
  boss.maxHp = boss.hp = 1e9;
  ctx.monsters.push(boss);
  for (const c of ctx.party) c.maxHp = c.hp = 1e9;
  const combat = startCombat("r1", [boss.id], ctx, true);
  const skill = MONSTER_SKILLS.find((s) => s.id === getBossTelegraph(getArchetype(archetypeId))!.skillId)!;
  const released = () => combat.log.filter((l) => l.text.includes(`unleashes ${skill.name}`)).length;
  const turn = () => {
    fillTelegraphMeter(boss, combat, ctx);
    runMonsterTurn({ kind: "monster", id: boss.id }, combat, ctx);
  };
  const stunnedTurn = () => {
    boss.activeStatusEffects.push({ statusEffectId: "stunned", turnsRemaining: 1 });
    turn();
    boss.activeStatusEffects = boss.activeStatusEffects.filter((s) => s.statusEffectId !== "stunned");
  };
  return { ctx, boss, combat, skill, released, turn, stunnedTurn };
}

describe("boss telegraph meter", () => {
  test("the meter starts empty when the fight starts", () => {
    const { boss } = bossFight("skeleton-guard");
    expect(boss.telegraphMeter ?? 0).toBe(0);
  });

  test("a boss with meter N releases its telegraph on its N-th turn and the meter is empty after", () => {
    const { boss, turn, released } = bossFight("skeleton-guard");
    expect(getBossTelegraph(getArchetype("skeleton-guard"))!.meterLength).toBe(5);
    for (let i = 1; i <= 4; i++) {
      turn();
      expect(released()).toBe(0);
      expect(boss.telegraphMeter).toBe(i);
    }
    turn();
    expect(released()).toBe(1);
    expect(boss.telegraphMeter).toBe(0);
    turn();
    expect(boss.telegraphMeter).toBe(1);
  });

  test("a stunned turn still fills an icon and moves the release to the next turn", () => {
    const { boss, turn, stunnedTurn, released } = bossFight("skeleton-guard");
    for (let i = 0; i < 4; i++) turn();
    stunnedTurn();
    expect(released()).toBe(0);
    expect(boss.telegraphMeter).toBe(5);
    turn();
    expect(released()).toBe(1);
    expect(boss.telegraphMeter).toBe(0);
  });

  test("the meter never exceeds its length across consecutive stuns", () => {
    const { boss, turn, stunnedTurn, released } = bossFight("skeleton-guard");
    for (let i = 0; i < 4; i++) turn();
    for (let i = 0; i < 4; i++) {
      stunnedTurn();
      expect(boss.telegraphMeter).toBe(5);
    }
    turn();
    expect(released()).toBe(1);
  });

  test("a full turn lost to an interrupt fills nothing more and delays the release", () => {
    const { ctx, boss, combat, turn, released } = bossFight("skeleton-guard");
    for (let i = 0; i < 4; i++) turn();
    fillTelegraphMeter(boss, combat, ctx);
    finishMonsterTurn(boss, combat, ctx);
    expect(boss.telegraphMeter).toBe(5);
    fillTelegraphMeter(boss, combat, ctx);
    finishMonsterTurn(boss, combat, ctx);
    expect(boss.telegraphMeter).toBe(5);
    expect(released()).toBe(0);
    turn();
    expect(released()).toBe(1);
  });

  test("an Overwatch interrupt in a real round still fills the icon", () => {
    const { ctx, boss, combat } = bossFight("skeleton-guard");
    const archer = ctx.party.find((c) => c.classId === "archer")!;
    archer.activeStatusEffects.push({ statusEffectId: "overwatched", turnsRemaining: 3 });
    ctx.rng.next = () => 0;
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    expect(boss.telegraphMeter).toBe(1);
  });

  test("a silenced boss with a full meter basic-attacks and releases on its next unsilenced turn", () => {
    const { boss, combat, turn, released } = bossFight("skeleton-guard");
    for (let i = 0; i < 4; i++) turn();
    boss.activeStatusEffects.push({ statusEffectId: "silenced", turnsRemaining: 3 });
    const before = combat.log.length;
    turn();
    expect(released()).toBe(0);
    expect(boss.telegraphMeter).toBe(5);
    expect(combat.log.slice(before).some((l) => l.text.includes("attacks"))).toBe(true);
    boss.activeStatusEffects = [];
    turn();
    expect(released()).toBe(1);
    expect(boss.telegraphMeter).toBe(0);
  });

  test("a provoked boss releases its single-target telegraph on whoever provoked it", () => {
    const { ctx, boss, combat, turn, released } = bossFight("skeleton-guard");
    const provoker = ctx.party[2]!;
    boss.activeStatusEffects.push({ statusEffectId: "provoked", turnsRemaining: 5, sourceId: provoker.id });
    for (let i = 0; i < 4; i++) turn();
    const before = ctx.party.map((c) => c.hp);
    const mark = combat.log.length;
    turn();
    expect(released()).toBe(1);
    expect(combat.log.slice(mark).some((l) => l.text.includes("unleashes"))).toBe(true);
    const hit = ctx.party.filter((c, i) => c.hp < before[i]!);
    expect(hit.map((c) => c.id)).toEqual([provoker.id]);
  });

  test("Interpose takes the release for its ward", () => {
    const { ctx, boss, combat, turn, released } = bossFight("skeleton-guard");
    const knight = ctx.party.find((c) => c.classId === "knight")!;
    const ward = ctx.party.find((c) => c.classId === "mage")!;
    knight.level = 15;
    for (const c of ctx.party) if (c !== knight && c !== ward) c.isAlive = false, (c.hp = 0);
    applySkillEffects(getEffectiveSkill(getSkill("interpose"), 15), knight, [ward], combat, ctx, combat.log);
    boss.activeStatusEffects.push({ statusEffectId: "provoked", turnsRemaining: 9, sourceId: ward.id });
    for (let i = 0; i < 4; i++) turn();
    ward.hp = knight.hp = 1e9;
    turn();
    expect(released()).toBe(1);
    expect(ward.hp).toBe(1e9);
    expect(knight.hp).toBeLessThan(1e9);
  });

  test("Dark Knight releases on the challenged character when one exists", () => {
    const { ctx, boss, turn, released } = bossFight("dark-knight");
    const target = ctx.party[3]!;
    target.activeStatusEffects.push({ statusEffectId: "challenged", turnsRemaining: 9 });
    for (let i = 0; i < 2; i++) turn();
    const before = ctx.party.map((c) => c.hp);
    turn();
    expect(released()).toBe(1);
    const hit = ctx.party.filter((c, i) => c.hp < before[i]!);
    expect(hit.map((c) => c.id)).toEqual([target.id]);
    expect(boss.telegraphMeter).toBe(0);
  });

  test("Dark Knight with nobody challenged releases on a target chosen by normal targeting", () => {
    const hitCounts = (pulled: boolean) => {
      const counts = new Map<string, number>();
      for (let seed = 1; seed <= 40; seed++) {
        const { ctx, boss, turn, released } = bossFight("dark-knight", seed);
        const puller = ctx.party[0]!;
        if (pulled) puller.activeStatusEffects.push({ statusEffectId: "challenge", turnsRemaining: 9 });
        boss.telegraphMeter = 2;
        const before = ctx.party.map((c) => c.hp);
        turn();
        expect(released()).toBe(1);
        const hit = ctx.party.filter((c, i) => c.hp < before[i]!);
        expect(hit.length).toBe(1);
        counts.set(hit[0]!.id, (counts.get(hit[0]!.id) ?? 0) + 1);
      }
      return counts;
    };
    const plain = hitCounts(false);
    expect(plain.size).toBeGreaterThan(1);
    const pulledCounts = hitCounts(true);
    expect(pulledCounts.get("p1") ?? 0).toBeGreaterThan(plain.get("p1") ?? 0);
  });

  test("Dragon is airborne from the turn before its release through the release", () => {
    const { ctx, boss, combat, released } = bossFight("dragon");
    const airborne = () => boss.activeStatusEffects.some((s) => s.statusEffectId === "airborne");
    const round = () => {
      for (const ref of livingCharacterRefs(combat, ctx)) {
        const { skillId, targets } = pickAnyAction(ctx, combat, ref);
        queueAction(combat, ref, skillId, targets, ctx);
      }
      resolveRound(combat, ctx);
    };
    for (let i = 0; i < 2; i++) round();
    expect(airborne()).toBe(false);
    round();
    expect(boss.telegraphMeter).toBe(3);
    expect(airborne()).toBe(true);
    round();
    expect(released()).toBe(1);
    expect(boss.telegraphMeter).toBe(0);
    expect(combat.log.some((l) => l.text.includes("Airborne effect expires"))).toBe(true);
    expect(combat.log.findIndex((l) => l.text.includes("unleashes Inferno"))).toBeLessThan(combat.log.findIndex((l) => l.text.includes("Airborne effect expires")));
  });

  test("a confused boss's release is never turned onto its own side", () => {
    const { ctx, boss, turn, released } = bossFight("skeleton-guard");
    const ally = spawnMonster("skeleton-guard", 1);
    ctx.monsters.push(ally);
    boss.activeStatusEffects.push({ statusEffectId: "confused", turnsRemaining: 9 });
    boss.telegraphMeter = 4;
    const allyHp = ally.hp;
    const before = ctx.party.map((c) => c.hp);
    turn();
    expect(released()).toBe(1);
    expect(ally.hp).toBe(allyHp);
    expect(ctx.party.some((c, i) => c.hp < before[i]!)).toBe(true);
  });
});
