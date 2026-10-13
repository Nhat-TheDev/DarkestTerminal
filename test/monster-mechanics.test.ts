import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, resolveRound, livingCharacterRefs, dismissOrphanedMonsterSummons, type EngineContext } from "../src/engine/combat";
import { MONSTER_SKILLS, MONSTER_ARCHETYPES, spawnMonster } from "../src/data/monsters";
import { BALANCE } from "../src/data/balanceConfig";
import { runMonsterTurn } from "../src/engine/monsterAI";
import { makeCtx, pickAnyAction } from "./helpers";

const sk = (id: string, over: object = {}) => ({ id, name: id, description: "x", mpCost: 0, target: "singleEnemy", effects: [{ kind: "damage", amount: 1 }], slot: 0, unlockLevel: 1, ...over });

function withFixture(skills: any[], archetypeOver: any, body: () => void) {
  const base = structuredClone(MONSTER_ARCHETYPES.find((a) => a.id === "giant-spider")!);
  const archetype = { ...base, id: "fixture-boss", skillIds: skills.map((x) => x.id), ...archetypeOver };
  MONSTER_SKILLS.push(...skills);
  MONSTER_ARCHETYPES.push(archetype);
  try {
    body();
  } finally {
    for (const x of skills) MONSTER_SKILLS.splice(MONSTER_SKILLS.findIndex((y) => y.id === x.id), 1);
    MONSTER_ARCHETYPES.splice(MONSTER_ARCHETYPES.findIndex((a) => a.id === "fixture-boss"), 1);
  }
}

function bossFight(seed = 1) {
  const { ctx } = makeCtx(seed);
  const boss = spawnMonster("fixture-boss", 1, { tier: "boss" });
  boss.maxHp = 100000;
  boss.hp = 100000;
  ctx.monsters.push(boss);
  for (const c of ctx.party) {
    c.maxHp = 1e9;
    c.hp = 1e9;
  }
  const roomMonsterIds = [boss.id];
  const combat = startCombat("r1", roomMonsterIds, ctx, true);
  const turn = () => runMonsterTurn({ kind: "monster", id: boss.id }, combat, ctx);
  const addsOf = () => ctx.monsters.filter((m) => m.summonerId === boss.id);
  const round = () => {
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
  };
  return { ctx, boss, combat, turn, addsOf, round, roomMonsterIds };
}

const summonGoblins = (count: number) => sk("fx-summon", { target: "self", effects: [{ kind: "summonMonster", monsterArchetypeId: "goblin", count }] });
const summonKit = { actionWeights: { boss: { "fx-summon": 100 } } };

describe("summonMonster", () => {
  test("spawns adds up to the per-summoner cap, registered in the fight, rewarding nothing", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { ctx, boss, combat, turn, addsOf, roomMonsterIds } = bossFight();
      turn();
      const adds = addsOf();
      expect(adds.length).toBe(BALANCE.combat.maxSummonedMonsters);
      for (const add of adds) {
        expect(add.archetypeId).toBe("goblin");
        expect(add.tier).toBe("normal");
        expect(add.summonerId).toBe(boss.id);
        expect(add.expReward).toBe(0);
        expect(combat.combatants.some((c) => c.ref.kind === "monster" && c.ref.id === add.id)).toBe(true);
        expect(roomMonsterIds).not.toContain(add.id);
      }
      expect(new Set(ctx.monsters.map((m) => m.id)).size).toBe(ctx.monsters.length);
      expect(combat.log.filter((l) => l.text.includes("calls up")).length).toBe(adds.length);
    });
  });

  test("casting again at the cap adds nothing", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { combat, turn, addsOf } = bossFight();
      turn();
      const first = addsOf().length;
      turn();
      expect(addsOf().length).toBe(first);
      expect(combat.log.filter((l) => l.text.includes("calls up")).length).toBe(first);
    });
  });

  test("an add that falls frees room under the cap for the next cast", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { ctx, turn, addsOf } = bossFight();
      turn();
      addsOf()[0]!.hp = 0;
      turn();
      expect(addsOf().filter((m) => m.hp > 0).length).toBe(BALANCE.combat.maxSummonedMonsters);
      expect(new Set(ctx.monsters.map((m) => m.id)).size).toBe(ctx.monsters.length);
    });
  });

  test("adds are in the next round's turn order", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { combat, turn, addsOf, round } = bossFight();
      turn();
      round();
      for (const add of addsOf()) expect(combat.turnQueue.some((r) => r.kind === "monster" && r.id === add.id)).toBe(true);
    });
  });

  test("adds fall when their summoner does, one log line each", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { ctx, boss, combat, turn, addsOf } = bossFight();
      turn();
      boss.hp = 0;
      dismissOrphanedMonsterSummons(combat, ctx, combat.log);
      for (const add of addsOf()) expect(add.hp).toBe(0);
      expect(combat.log.filter((l) => l.text.includes("comes apart")).length).toBe(addsOf().length);
    });
  });

  test("killing the summoner with adds alive wins the fight in that same round", () => {
    withFixture([summonGoblins(3)], summonKit, () => {
      const { boss, combat, turn, addsOf, round } = bossFight();
      turn();
      expect(addsOf().some((a) => a.hp > 0)).toBe(true);
      boss.hp = 1;
      round();
      expect(combat.outcome).toBe("victory");
      expect(addsOf().every((a) => a.hp === 0)).toBe(true);
    });
  });
});
