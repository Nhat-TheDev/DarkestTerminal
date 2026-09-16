import { describe, expect, test } from "bun:test";
import type { MonsterArchetype, RaceDefinition, SubRaceDefinition, TraitDefinition } from "../src/types";
import racesJson from "../data/monster-races.json";
import traitsJson from "../data/monster-traits.json";
import { getRace, getTrait, resolveRaceProfile } from "../src/data/monsterRaces";
import { MONSTER_ARCHETYPES, spawnMonster } from "../src/data/monsters";
import { resolveSkillEffect, type Actor } from "../src/engine/resolver";
import { makeCtx } from "./helpers";

describe("race/subRace/trait types", () => {
  test("a RaceDefinition can be constructed with the expected shape", () => {
    const race: RaceDefinition = {
      id: "test-race",
      name: "Test Race",
      profile: { resistPercent: { poison: 50 }, weakPercent: { fire: 20 }, statBuff: { maxHpPercent: 10 } },
      subRaces: [],
    };
    expect(race.id).toBe("test-race");
  });

  test("a SubRaceDefinition and TraitDefinition share the RaceProfile shape", () => {
    const sub: SubRaceDefinition = { id: "test-sub", name: "Test Sub", profile: { resistPercent: { bleed: 100 } } };
    const trait: TraitDefinition = { id: "test-trait", name: "Test Trait", profile: { statBuff: { speedFlat: 4 } } };
    expect(sub.profile.resistPercent?.bleed).toBe(100);
    expect(trait.profile.statBuff?.speedFlat).toBe(4);
  });

  test("MonsterArchetype requires race, allows optional subRace and traitIds", () => {
    const archetype: Partial<MonsterArchetype> = { race: "beast", subRace: "predator", traitIds: ["flying"] };
    expect(archetype.race).toBe("beast");
  });
});

describe("monster-races.json / monster-traits.json", () => {
  const races = racesJson as unknown as RaceDefinition[];
  const traits = traitsJson as unknown as TraitDefinition[];

  test("exactly 8 races, each with 1-3 subRaces", () => {
    expect(races.length).toBe(8);
    for (const race of races) {
      expect(race.subRaces.length).toBeGreaterThanOrEqual(1);
      expect(race.subRaces.length).toBeLessThanOrEqual(3);
    }
  });

  test("exactly 5 traits", () => {
    expect(traits.length).toBe(5);
  });

  test("undead race has the expected resist/weak profile", () => {
    const undead = races.find((r) => r.id === "undead")!;
    expect(undead.profile.resistPercent).toEqual({ poison: 20, bleed: 60 });
    expect(undead.profile.weakPercent).toEqual({ fire: 20, magic: 20, holy: 40 });
    const skeletal = undead.subRaces.find((s) => s.id === "skeletal")!;
    expect(skeletal.profile.resistPercent?.bleed).toBe(100);
    expect(skeletal.profile.weakPercent?.physical).toBe(30);
  });

  test("golem race statBuff matches the design spec exactly", () => {
    const golem = races.find((r) => r.id === "golem")!;
    expect(golem.profile.statBuff).toEqual({ speedFlat: -5, maxHpPercent: 7, defensePercent: 7 });
  });

  test("plated trait is not named 'armored' (would collide with MonsterType)", () => {
    expect(traits.find((t) => t.id === "armored")).toBeUndefined();
    expect(traits.find((t) => t.id === "plated")).toBeDefined();
  });
});

describe("resolveRaceProfile", () => {
  test("race only (Beast has no race-level profile, Predator subRace adds attackPercent)", () => {
    const profile = resolveRaceProfile("beast", "predator", []);
    expect(profile.statBuff.attackPercent).toBe(8);
    expect(profile.resistPercent.poison).toBe(0);
  });

  test("subRace overrides a specific resistPercent key, race-level keys not mentioned by subRace are inherited", () => {
    const profile = resolveRaceProfile("undead", "skeletal", []);
    expect(profile.resistPercent.bleed).toBe(100);
    expect(profile.resistPercent.poison).toBe(20);
    expect(profile.weakPercent.physical).toBe(30);
    expect(profile.weakPercent.fire).toBe(20);
  });

  test("subRace statBuff fields ADD to the race's, not override", () => {
    const profile = resolveRaceProfile("slime", "toxic-ooze", []);
    expect(profile.statBuff.maxHpPercent).toBe(10);
    expect(profile.statBuff.attackPercent).toBe(-5);
    expect(profile.statBuff.defensePercent).toBe(5);
    expect(profile.resistPercent.poison).toBe(100);
  });

  test("traits ADD on top of the resolved race+subRace profile (sum, not override)", () => {
    const profile = resolveRaceProfile("beast", "vermin", ["venomous"]);
    expect(profile.resistPercent.poison).toBe(70);
  });

  test("clamping: resolved resistPercent/weakPercent never exceed 100", () => {
    const profile = resolveRaceProfile("shadow-creature", "wraithkin", []);
    expect(profile.resistPercent.poison).toBe(100);
  });

  test("getRace throws on an unknown id", () => {
    expect(() => getRace("not-a-real-race")).toThrow();
  });

  test("getTrait throws on an unknown id", () => {
    expect(() => getTrait("not-a-real-trait")).toThrow();
  });
});

describe("every monster archetype has race/subRace/traitIds assigned", () => {
  test("every archetype's race resolves without throwing", () => {
    for (const a of MONSTER_ARCHETYPES) {
      expect(() => resolveRaceProfile(a.race, a.subRace, a.traitIds ?? [])).not.toThrow();
    }
  });

  test("spot-check a few archetypes against the design spec's taxonomy", () => {
    const dragon = MONSTER_ARCHETYPES.find((a) => a.id === "dragon")!;
    expect(dragon.race).toBe("beast");
    expect(dragon.subRace).toBe("draconic");
    expect(dragon.traitIds).toEqual(["flying"]);

    const ancientGolem = MONSTER_ARCHETYPES.find((a) => a.id === "ancient-golem")!;
    expect(ancientGolem.race).toBe("golem");
    expect(ancientGolem.subRace).toBe("stone-golem");
    expect(ancientGolem.traitIds).toEqual(["massive"]);

    const skeletonGuard = MONSTER_ARCHETYPES.find((a) => a.id === "skeleton-guard")!;
    expect(skeletonGuard.race).toBe("undead");
    expect(skeletonGuard.subRace).toBe("skeletal");
    expect(skeletonGuard.traitIds).toEqual(["plated"]);

    const theFounder = MONSTER_ARCHETYPES.find((a) => a.id === "the-founder")!;
    expect(theFounder.race).toBe("undead");
    expect(theFounder.subRace).toBe("rotting");
  });
});

describe("end-to-end: character skill -> damageType -> race resist/weak -> final damage", () => {
  test("a bleed tick against a skeleton deals exactly 0 (Skeletal is 100% bleed-resistant)", () => {
    const skeleton = spawnMonster("skeleton", 1);
    const bleedingTickEffect = { kind: "damage" as const, amount: 5, damageType: "bleed" as const };
    const dealt = resolveSkillEffect(bleedingTickEffect, skeleton as unknown as Actor, skeleton as unknown as Actor, { log: [] });
    expect(dealt).toBe(0);
  });

  test("fire damage against a dragon (40% fire resist) deals reduced but nonzero damage", () => {
    const dragon = spawnMonster("dragon", 50, { tier: "boss" });
    const attacker = { attack: 50, magicPower: 40 } as unknown as Actor;
    const fireEffect = { kind: "damage" as const, amount: 20, damageType: "fire" as const };
    const dealt = resolveSkillEffect(fireEffect, attacker, dragon as unknown as Actor, { log: [], isMagic: true });
    expect(dealt).toBeGreaterThan(0);
  });

  test("a poisoned tick against slime (50% poison resist) deals less than against a goblin (no poison resist)", () => {
    const slime = spawnMonster("slime", 1);
    const goblin = spawnMonster("goblin", 1);
    const poisonTick = { kind: "damage" as const, amount: 4, damageType: "poison" as const };
    const dealtToSlime = resolveSkillEffect(poisonTick, slime as unknown as Actor, slime as unknown as Actor, { log: [] });
    const dealtToGoblin = resolveSkillEffect(poisonTick, goblin as unknown as Actor, goblin as unknown as Actor, { log: [] });
    expect(dealtToSlime).toBeLessThan(dealtToGoblin);
  });

  test("the same poisoned tick against swamp-slime (100% poison resist) deals exactly 0", () => {
    const swampSlime = spawnMonster("swamp-slime", 1);
    const poisonTick = { kind: "damage" as const, amount: 4, damageType: "poison" as const };
    const dealt = resolveSkillEffect(poisonTick, swampSlime as unknown as Actor, swampSlime as unknown as Actor, { log: [] });
    expect(dealt).toBe(0);
  });

  test("race resist/weak never touches a Character target, even with a typed damage effect", () => {
    const { ctx } = makeCtx();
    const source = spawnMonster("skeleton", 1);
    const target = ctx.party[0]!;
    const before = target.hp;
    const dealt = resolveSkillEffect({ kind: "damage", amount: 10, damageType: "bleed" }, source as unknown as Actor, target, { log: [] });
    expect(dealt).toBeGreaterThan(0);
    expect(target.hp).toBeLessThan(before);
  });
});
