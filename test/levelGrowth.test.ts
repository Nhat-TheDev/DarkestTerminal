import { describe, test, expect } from "bun:test";
import { growthBonus, ELITE_MULTIPLIER, MAX_LEVEL } from "../src/data/levelGrowth";
import { spawnMonster } from "../src/data/monsters";
import { getClass, CLASSES } from "../src/data/classes";
import { createCharacter } from "../src/engine/party";

// Milestone values from docs/gameplay-decisions.md §6.4.
const MILESTONES: Record<number, { attack: number; defense: number; maxHp: number; maxMp: number }> = {
  1: { attack: 0, defense: 0, maxHp: 0, maxMp: 0 },
  10: { attack: 27, defense: 18, maxHp: 126, maxMp: 54 },
  25: { attack: 57, defense: 33, maxHp: 276, maxMp: 114 },
  50: { attack: 82, defense: 45, maxHp: 451, maxMp: 189 },
  75: { attack: 94, defense: 53, maxHp: 576, maxMp: 239 },
  100: { attack: 102, defense: 60, maxHp: 651, maxMp: 264 },
};

describe("growthBonus matches the docs/gameplay-decisions.md §6.4 milestone table", () => {
  for (const [levelStr, expected] of Object.entries(MILESTONES)) {
    const level = Number(levelStr);
    test(`level ${level}`, () => {
      expect(growthBonus("attack", level)).toBe(expected.attack);
      expect(growthBonus("defense", level)).toBe(expected.defense);
      expect(growthBonus("maxHp", level)).toBe(expected.maxHp);
      expect(growthBonus("maxMp", level)).toBe(expected.maxMp);
    });
  }
});

describe("growthBonus general properties", () => {
  test("is 0 at level 1 for every stat", () => {
    for (const stat of ["attack", "defense", "maxHp", "maxMp"] as const) {
      expect(growthBonus(stat, 1)).toBe(0);
    }
  });

  test("is monotonically non-decreasing as level increases", () => {
    for (const stat of ["attack", "defense", "maxHp", "maxMp"] as const) {
      let prev = 0;
      for (let level = 1; level <= MAX_LEVEL; level++) {
        const value = growthBonus(stat, level);
        expect(value).toBeGreaterThanOrEqual(prev);
        prev = value;
      }
    }
  });

  test("clamps levels above MAX_LEVEL to the level-100 value", () => {
    expect(growthBonus("attack", 150)).toBe(growthBonus("attack", 100));
  });
});

describe("createCharacter applies growth for its level (regression: used to ignore the level param entirely)", () => {
  test("a level-50 character has higher stats than a level-1 character of the same class", () => {
    const cls = getClass("vanguard");
    const lvl1 = createCharacter("a", "A", cls, 1);
    const lvl50 = createCharacter("b", "B", cls, 50);
    expect(lvl50.attack).toBeGreaterThan(lvl1.attack);
    expect(lvl50.defense).toBeGreaterThan(lvl1.defense);
    expect(lvl50.maxHp).toBeGreaterThan(lvl1.maxHp);
    expect(lvl50.maxMp).toBeGreaterThan(lvl1.maxMp);
    expect(lvl50.hp).toBe(lvl50.maxHp); // spawns at full health
  });

  test("aggro/speed never scale with level (§5: fixed role/tempo identifiers)", () => {
    const cls = getClass("rogue");
    const lvl1 = createCharacter("a", "A", cls, 1);
    const lvl100 = createCharacter("b", "B", cls, 100);
    expect(lvl100.aggro).toBe(lvl1.aggro);
    expect(lvl100.speed).toBe(lvl1.speed);
  });
});

describe("growth is class-dependent (§6.8): weights reinforce each class's identity instead of converging", () => {
  test("growthWeights sum to the 4.0 budget for every class (no class gets strictly more total growth)", () => {
    for (const cls of CLASSES) {
      const sum = cls.growthWeights.attack + cls.growthWeights.defense + cls.growthWeights.maxHp + cls.growthWeights.maxMp;
      expect(sum).toBeCloseTo(4.0, 5);
    }
  });

  test("Vanguard (tank) gains more defense+maxHp per level than Mage (glass cannon)", () => {
    const vanguard50 = createCharacter("v", "V", getClass("vanguard"), 50);
    const mage50 = createCharacter("m", "M", getClass("mage"), 50);
    expect(vanguard50.defense - getClass("vanguard").baseDefense).toBeGreaterThan(mage50.defense - getClass("mage").baseDefense);
    expect(vanguard50.maxHp - getClass("vanguard").baseMaxHp).toBeGreaterThan(mage50.maxHp - getClass("mage").baseMaxHp);
  });

  test("Mage gains more maxMp per level than Vanguard", () => {
    const vanguard50 = createCharacter("v", "V", getClass("vanguard"), 50);
    const mage50 = createCharacter("m", "M", getClass("mage"), 50);
    expect(mage50.maxMp - getClass("mage").baseMaxMp).toBeGreaterThan(vanguard50.maxMp - getClass("vanguard").baseMaxMp);
  });
});

describe("spawnMonster: elite guard stays killable at deep floors (regression for the uniform x2 defense-stacking bug)", () => {
  test("every class with a damage skill in its kit clears the skill's own amount at floor depth 50 (attack > elite defense, not just barely floored at 1)", () => {
    const elite = spawnMonster("skeleton-guard", 50, { tier: "elite" });
    const basicSkillAmount = 10; // e.g. Ném Khiên (Cận Vệ)
    // Chaplain is intentionally pure-support (§6.8: lowest attack weight) —
    // its paid skills only deal damage situationally (Thanh Tẩy/Thần Giáng
    // when aimed at an enemy), not via a reliable amount-10-tier skill like
    // the other 3 classes, so it's excluded here. Its attack stat trailing an
    // elite's defense is by design, not the bug this test guards.
    const damageDealers = CLASSES.filter((c) => c.id !== "chaplain");
    for (const cls of damageDealers) {
      const character = createCharacter("c", cls.name, cls, 50);
      const damage = Math.max(1, basicSkillAmount + character.attack - elite.defense);
      // The bug this guards against: uniform x2 elite scaling let elite.defense
      // approach total offense, flooring damage to ~1 (near-unkillable) even
      // for the game's highest-attack classes.
      expect(damage).toBeGreaterThan(basicSkillAmount);
    }
  });

  test("elite multiplier is asymmetric: heavy on HP, light on defense", () => {
    expect(ELITE_MULTIPLIER.maxHp).toBeGreaterThan(ELITE_MULTIPLIER.attack);
    expect(ELITE_MULTIPLIER.attack).toBeGreaterThan(ELITE_MULTIPLIER.defense);
    expect(ELITE_MULTIPLIER.defense).toBeLessThan(1.5); // never more than a mild bump over a normal monster's defense
  });

  test("an elite is always tankier (more HP) than a normal monster of the same archetype and depth", () => {
    for (const depth of [1, 25, 50, 100]) {
      const normal = spawnMonster("skeleton-guard", depth);
      const elite = spawnMonster("skeleton-guard", depth, { tier: "elite" });
      expect(elite.maxHp).toBeGreaterThan(normal.maxHp);
    }
  });

  test("a boss (§6.11) is always tankier and hits harder than an elite of the same archetype and depth", () => {
    for (const depth of [5, 25, 50, 100]) {
      const elite = spawnMonster("skeleton-guard", depth, { tier: "elite" });
      const boss = spawnMonster("skeleton-guard", depth, { tier: "boss" });
      expect(boss.maxHp).toBeGreaterThan(elite.maxHp);
      expect(boss.attack).toBeGreaterThan(elite.attack);
      expect(boss.defense).toBeGreaterThan(elite.defense);
    }
  });
});
