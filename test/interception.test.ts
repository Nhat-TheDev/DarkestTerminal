import { describe, test, expect } from "bun:test";
import { startCombat, queueAction, applySkillEffects } from "../src/engine/combat";
import { runMonsterTurn } from "../src/engine/monsterAI";
import { getSkill, getEffectiveSkill } from "../src/data/classes";
import { spawnMonster } from "../src/data/monsters";
import type { Character, CombatState, CombatantRef, Monster } from "../src/types";
import type { EngineContext } from "../src/engine/combat";
import { makeCtx, sk, withFixture, withoutDamageRolls } from "./helpers";

withoutDamageRolls();

const ref = (c: Character): CombatantRef => ({ kind: "character", id: c.id });

interface Scene {
  ctx: EngineContext;
  boss: Monster;
  knight: Character;
  mage: Character;
  combat: CombatState;
  turn: () => void;
}

/** A fixture boss against only the Knight and the mage; every blow lands, and every single-target pick goes to the mage. */
function fight(skills: object[], weights: Record<string, number>, interposed: boolean, body: (s: Scene) => void): void {
  withFixture(skills, { actionWeights: { boss: weights } }, () => {
    const { ctx } = makeCtx(1);
    const knight = ctx.party.find((c) => c.classId === "knight")!;
    const mage = ctx.party.find((c) => c.classId === "mage")!;
    knight.level = 15;
    for (const c of ctx.party) {
      if (c === knight || c === mage) continue;
      c.hp = 0;
      c.isAlive = false;
    }
    for (const c of [knight, mage]) c.maxHp = c.hp = 1e9;
    const boss = spawnMonster("fixture-boss", 1, { tier: "boss" });
    boss.attack = 300;
    boss.maxHp = boss.hp = 1e9;
    ctx.monsters.push(boss);
    const combat = startCombat("r1", [boss.id], ctx, true);
    ctx.rng.next = () => 0;
    const towardMage = <T extends { id?: string }>(items: T[]): T => items.find((i) => i.id === mage.id) ?? items[0]!;
    ctx.rng.weightedPick = ((items: any[]) => towardMage(items)) as typeof ctx.rng.weightedPick;
    ctx.rng.pick = ((items: any[]) => towardMage(items)) as typeof ctx.rng.pick;
    if (interposed) applySkillEffects(getEffectiveSkill(getSkill("interpose"), 15), knight, [mage], combat, ctx, combat.log);
    body({ ctx, boss, knight, mage, combat, turn: () => runMonsterTurn({ kind: "monster", id: boss.id }, combat, ctx) });
  });
}

const lost = (c: Character) => 1e9 - c.hp;

describe("Interpose", () => {
  test("a basic attack aimed at an interposed ally hits the Knight instead", () => {
    fight([], { basicAttack: 100 }, true, ({ knight, mage, turn }) => {
      turn();
      expect(lost(mage)).toBe(0);
      expect(lost(knight)).toBeGreaterThan(0);
    });
  });

  test("the redirected hit is rolled against the Knight's defense", () => {
    let mageTakes = 0;
    fight([], { basicAttack: 100 }, false, ({ mage, turn }) => {
      turn();
      mageTakes = lost(mage);
    });
    fight([], { basicAttack: 100 }, true, ({ knight, turn }) => {
      turn();
      expect(lost(knight)).toBeGreaterThan(0);
      expect(lost(knight)).toBeLessThan(mageTakes);
    });
  });

  test("an area attack is not redirected", () => {
    const area = sk("fx-area", { target: "allEnemies" });
    let knightBaseline = 0;
    fight([area], { "fx-area": 100 }, false, ({ knight, turn }) => {
      turn();
      knightBaseline = lost(knight);
    });
    fight([area], { "fx-area": 100 }, true, ({ knight, mage, turn }) => {
      turn();
      expect(lost(mage)).toBeGreaterThan(0);
      expect(lost(knight)).toBe(knightBaseline);
    });
  });

  test("a status-only single-target skill still lands on the ally", () => {
    const hex = sk("fx-hex", { effects: [{ kind: "applyStatusEffect", statusEffectId: "weakened", durationTurns: 2 }] });
    fight([hex], { "fx-hex": 100 }, true, ({ knight, mage, turn }) => {
      turn();
      expect(mage.activeStatusEffects.some((s) => s.statusEffectId === "weakened")).toBe(true);
      expect(knight.activeStatusEffects.some((s) => s.statusEffectId === "weakened")).toBe(false);
    });
  });

  test("a multi-target cast that already includes the Knight does not hit the Knight twice", () => {
    const volley = sk("fx-volley", { targetCount: { min: 2, max: 2 } });
    let knightBaseline = 0;
    let mageBaseline = 0;
    fight([volley], { "fx-volley": 100 }, false, ({ knight, mage, turn }) => {
      turn();
      knightBaseline = lost(knight);
      mageBaseline = lost(mage);
    });
    fight([volley], { "fx-volley": 100 }, true, ({ knight, mage, turn }) => {
      turn();
      expect(lost(knight)).toBe(knightBaseline);
      expect(lost(mage)).toBe(mageBaseline);
    });
  });

  test("a confused monster's blow on another monster is never intercepted", () => {
    const hit = sk("fx-hit");
    fight([hit], { "fx-hit": 100 }, true, ({ ctx, boss, knight, mage, combat, turn }) => {
      const rat = spawnMonster("dungeon-rat", 1);
      rat.maxHp = rat.hp = 1e9;
      ctx.monsters.push(rat);
      combat.combatants.push({ ref: { kind: "monster", id: rat.id } } as never);
      boss.activeStatusEffects.push({ statusEffectId: "confused", turnsRemaining: 2 });
      ctx.rng.chance = () => true;
      turn();
      expect(rat.hp).toBeLessThan(rat.maxHp);
      expect(lost(knight)).toBe(0);
      expect(lost(mage)).toBe(0);
    });
  });

  test("while the Knight is stunned or dead the ally takes the hit, and the guard resumes after", () => {
    fight([], { basicAttack: 100 }, true, ({ knight, mage, turn }) => {
      knight.activeStatusEffects.push({ statusEffectId: "stunned", turnsRemaining: 1 });
      turn();
      expect(lost(mage)).toBeGreaterThan(0);
      expect(lost(knight)).toBe(0);

      knight.activeStatusEffects = knight.activeStatusEffects.filter((s) => s.statusEffectId !== "stunned");
      const mageAfterStun = lost(mage);
      turn();
      expect(lost(mage)).toBe(mageAfterStun);
      expect(lost(knight)).toBeGreaterThan(0);

      knight.hp = 0;
      knight.isAlive = false;
      turn();
      expect(lost(mage)).toBeGreaterThan(mageAfterStun);
    });
  });

  test("Interpose cannot target the Knight itself", () => {
    fight([], { basicAttack: 100 }, false, ({ ctx, knight, combat }) => {
      expect(queueAction(combat, ref(knight), "interpose", [ref(knight)], ctx)).not.toBeNull();
    });
  });
});

describe("Watchful", () => {
  const weaken = (c: Character) => {
    c.hp = 5e8;
  };

  test("takes a hit aimed at the lowest-HP-percent ally when its chance rolls", () => {
    fight([], { basicAttack: 100 }, false, ({ ctx, knight, mage, turn }) => {
      weaken(mage);
      ctx.rng.chance = () => true;
      turn();
      expect(mage.hp).toBe(5e8);
      expect(lost(knight)).toBeGreaterThan(0);
    });
  });

  test("does nothing when the chance fails", () => {
    fight([], { basicAttack: 100 }, false, ({ ctx, knight, mage, turn }) => {
      weaken(mage);
      ctx.rng.chance = () => false;
      turn();
      expect(mage.hp).toBeLessThan(5e8);
      expect(lost(knight)).toBe(0);
    });
  });

  test("fires at most once per round", () => {
    fight([], { basicAttack: 100 }, false, ({ ctx, knight, mage, turn }) => {
      weaken(mage);
      ctx.rng.chance = () => true;
      turn();
      expect(mage.hp).toBe(5e8);
      turn();
      expect(mage.hp).toBeLessThan(5e8);
      expect(lost(knight)).toBeGreaterThan(0);
    });
  });

  test("fires again in the next round", () => {
    fight([], { basicAttack: 100 }, false, ({ ctx, knight, mage, combat, turn }) => {
      weaken(mage);
      ctx.rng.chance = () => true;
      turn();
      combat.roundNumber++;
      const knightAfterFirst = lost(knight);
      turn();
      expect(mage.hp).toBe(5e8);
      expect(lost(knight)).toBeGreaterThan(knightAfterFirst);
    });
  });

  test("ignores an ally who is not the lowest HP percent", () => {
    fight([], { basicAttack: 100 }, false, ({ ctx, knight, mage, turn }) => {
      knight.hp = 5e8;
      ctx.rng.chance = () => true;
      turn();
      expect(mage.hp).toBeLessThan(1e9);
      expect(knight.hp).toBe(5e8);
    });
  });

  test("never fires when the Knight itself is the lowest", () => {
    fight([], { basicAttack: 100 }, false, ({ ctx, knight, mage, turn }) => {
      knight.hp = 5e8;
      ctx.rng.chance = () => true;
      turn();
      expect(knight.hp).toBe(5e8);
      expect(lost(mage)).toBeGreaterThan(0);
    });
  });

  test("does nothing below level 5", () => {
    fight([], { basicAttack: 100 }, false, ({ ctx, knight, mage, turn }) => {
      knight.level = 4;
      weaken(mage);
      ctx.rng.chance = () => true;
      turn();
      expect(mage.hp).toBeLessThan(5e8);
      expect(lost(knight)).toBe(0);
    });
  });

  test("does not override an Interpose redirect", () => {
    fight([], { basicAttack: 100 }, true, ({ ctx, knight, mage, combat, turn }) => {
      weaken(mage);
      ctx.rng.chance = () => true;
      turn();
      expect(combat.watchfulRound?.[knight.id]).toBeUndefined();
      expect(mage.hp).toBe(5e8);
      expect(lost(knight)).toBeGreaterThan(0);
    });
  });
});
