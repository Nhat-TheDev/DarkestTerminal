import { describe, expect, test } from "bun:test";
import { spawnMonster, MONSTER_ARCHETYPES, MONSTER_TYPE_MULTIPLIER } from "../src/data/monsters";
import { growthBonusForDepth, monsterDepthBuffPercent, MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS } from "../src/data/levelGrowth";
import { resolveRaceProfile } from "../src/data/monsterRaces";

describe("spawnMonster applies race statBuff", () => {
  test("slime and dragon carry their race/subRace/traitIds", () => {
    const slime = spawnMonster("slime", 1);
    expect(slime.race).toBe("slime");
    expect(slime.subRace).toBe("ooze");

    const dragon = spawnMonster("dragon", 1, { tier: "boss" });
    expect(dragon.race).toBe("beast");
    expect(dragon.subRace).toBe("draconic");
    expect(dragon.traitIds).toEqual(["flying"]);
  });

  test("ancient-golem and lesser-golem never spawn with speed <= 0 (negative-speed regression)", () => {
    const ancientGolem = spawnMonster("ancient-golem", 1, { tier: "boss" });
    const lesserGolem = spawnMonster("lesser-golem", 1);
    expect(ancientGolem.speed).toBeGreaterThanOrEqual(1);
    expect(lesserGolem.speed).toBeGreaterThanOrEqual(1);
  });
});

describe("minFloor validation", () => {
  test("every non-finalBoss archetype has a minFloor that is a non-negative multiple of 10", () => {
    for (const a of MONSTER_ARCHETYPES) {
      if (a.finalBoss) continue;
      expect(a.minFloor).toBeDefined();
      expect(a.minFloor).toBeGreaterThanOrEqual(0);
      expect(a.minFloor! % 10).toBe(0);
    }
  });

  test("the finalBoss archetype has no minFloor", () => {
    const founder = MONSTER_ARCHETYPES.find((a) => a.finalBoss)!;
    expect(founder.minFloor).toBeUndefined();
  });

  test("crash-safety invariant: weak tier has at least 1 archetype at minFloor 0", () => {
    const weakAtZero = MONSTER_ARCHETYPES.filter((a) => a.powerTier === "weak" && (a.minFloor ?? 0) === 0);
    expect(weakAtZero.length).toBeGreaterThanOrEqual(1);
  });

  test("crash-safety invariant: medium tier has at least 1 archetype at minFloor 0", () => {
    const mediumAtZero = MONSTER_ARCHETYPES.filter((a) => a.powerTier === "medium" && (a.minFloor ?? 0) === 0);
    expect(mediumAtZero.length).toBeGreaterThanOrEqual(1);
  });

  test("crash-safety invariant: the guard-room pool has at least 1 archetype at minFloor 0", () => {
    const guardEligible = MONSTER_ARCHETYPES.filter((a) => a.roles.includes("elite") && a.roles.includes("boss"));
    const guardAtZero = guardEligible.filter((a) => (a.minFloor ?? 0) === 0);
    expect(guardAtZero.length).toBeGreaterThanOrEqual(1);
  });
});

describe("minFloor values match the design spec", () => {
  function minFloorOf(id: string): number | undefined {
    return MONSTER_ARCHETYPES.find((a) => a.id === id)!.minFloor;
  }

  test("weak tier is all 0", () => {
    for (const id of ["dungeon-rat", "black-bat", "slime", "goblin", "cultist-initiate", "ghoulish-crawler", "vampire-bat", "toxic-toad"]) {
      expect(minFloorOf(id)).toBe(0);
    }
  });

  test("spot-check medium tier", () => {
    expect(minFloorOf("skeleton")).toBe(0);
    expect(minFloorOf("ghost")).toBe(30);
    expect(minFloorOf("gargoyle")).toBe(30);
  });

  test("spot-check strong tier", () => {
    expect(minFloorOf("skeleton-guard")).toBe(0);
    expect(minFloorOf("mimic")).toBe(40);
  });

  test("guard-room pool ascends from 20 to 100, Dragon last", () => {
    expect(minFloorOf("giant-spider")).toBe(20);
    expect(minFloorOf("zombie-knight")).toBe(30);
    expect(minFloorOf("orc-chieftain")).toBe(40);
    expect(minFloorOf("vampire-lord")).toBe(50);
    expect(minFloorOf("dark-knight")).toBe(60);
    expect(minFloorOf("void-amalgamation")).toBe(70);
    expect(minFloorOf("lich")).toBe(80);
    expect(minFloorOf("ancient-golem")).toBe(90);
    expect(minFloorOf("dragon")).toBe(100);
  });

  test("the-founder has no minFloor", () => {
    expect(minFloorOf("the-founder")).toBeUndefined();
  });
});

describe("spawnMonster applies the floor-depth buff", () => {
  test("floor 10 vs floor 11: attack/defense/maxHp jump at the bracket boundary", () => {
    const atFloor10 = spawnMonster("goblin", 10);
    const atFloor11 = spawnMonster("goblin", 11);
    expect(atFloor11.attack).toBeGreaterThan(atFloor10.attack);
    expect(atFloor11.defense).toBeGreaterThan(atFloor10.defense);
    expect(atFloor11.maxHp).toBeGreaterThan(atFloor10.maxHp);
  });

  test("floor 100 vs floor 101: still increases (not yet at the 111 plateau)", () => {
    const atFloor100 = spawnMonster("goblin", 100);
    const atFloor101 = spawnMonster("goblin", 101);
    expect(atFloor101.attack).toBeGreaterThanOrEqual(atFloor100.attack);
  });

  test("the depth-buff term alone (isolated from base growth/race) contributes more to maxHp than attack, and more to attack than defense", () => {
    // The per-stat coefficient (1.5/1/0.75) only multiplies the depth-bonus TERM, not the whole
    // stat — comparing raw before/after ratios on a real archetype is numerically unstable for any
    // stat with a small base value (e.g. goblin's baseDefense: 1 makes any ratio involving it
    // enormous and meaningless). Isolate the depth-bonus multiplier itself instead.
    const depthBonus = monsterDepthBuffPercent(20);
    const hpMultiplier = 1 + (depthBonus * MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS.maxHp) / 100;
    const attackMultiplier = 1 + (depthBonus * MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS.attack) / 100;
    const defenseMultiplier = 1 + (depthBonus * MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS.defense) / 100;
    expect(hpMultiplier).toBeGreaterThan(attackMultiplier);
    expect(attackMultiplier).toBeGreaterThan(defenseMultiplier);
  });

  test("spawnMonster's maxHp/attack/defense match the full formula exactly at a specific floor", () => {
    const archetype = MONSTER_ARCHETYPES.find((a) => a.id === "goblin")!;
    const depth = 25;
    const depthBonus = monsterDepthBuffPercent(depth);
    const growthMaxHp = archetype.baseHp + growthBonusForDepth("maxHp", depth);
    const growthAttack = archetype.baseAttack + growthBonusForDepth("attack", depth);
    const growthDefense = archetype.baseDefense + growthBonusForDepth("defense", depth);
    const typeMultiplier = MONSTER_TYPE_MULTIPLIER[archetype.monsterType];
    const race = resolveRaceProfile(archetype.race, archetype.subRace, archetype.traitIds ?? []);

    const expectedMaxHp = Math.round(
      growthMaxHp * typeMultiplier.maxHp * (1 + (depthBonus * MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS.maxHp) / 100) * (1 + race.statBuff.maxHpPercent / 100)
    );
    const expectedAttack = Math.round(
      growthAttack * typeMultiplier.attack * (1 + (depthBonus * MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS.attack) / 100) * (1 + race.statBuff.attackPercent / 100)
    );
    const expectedDefense = Math.round(
      growthDefense * typeMultiplier.defense * (1 + (depthBonus * MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS.defense) / 100) * (1 + race.statBuff.defensePercent / 100)
    );

    const goblin = spawnMonster("goblin", depth);
    expect(goblin.maxHp).toBe(expectedMaxHp);
    expect(goblin.attack).toBe(expectedAttack);
    expect(goblin.defense).toBe(expectedDefense);
  });
});
