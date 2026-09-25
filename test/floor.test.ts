import { describe, expect, test } from "bun:test";
import { createFloor } from "../src/data/floor";
import { Rng } from "../src/engine/rng";
import { MONSTER_ARCHETYPES } from "../src/data/monsters";

function archetypeFor(monsterId: string) {
  const archetypeId = monsterId.replace(/-\d+$/, ""); // spawnMonster ids are "${archetypeId}-${counter}"
  return MONSTER_ARCHETYPES.find((a) => a.id === archetypeId)!;
}

describe("floor generation respects minFloor", () => {
  test("floor 1 never spawns an archetype whose minFloor is above 1, across many generated floors", () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = new Rng(seed);
      const { monsters } = createFloor(rng, 1);
      for (const m of monsters) {
        const archetype = archetypeFor(m.id);
        expect(archetype.minFloor ?? 0).toBeLessThanOrEqual(1);
      }
    }
  });

  test("floor 19 never spawns giant-spider (minFloor 20), floor 20 can", () => {
    let sawAtFloor20 = false;
    for (let seed = 0; seed < 300; seed++) {
      const rngAt19 = new Rng(seed);
      const { monsters: monstersAt19 } = createFloor(rngAt19, 19);
      expect(monstersAt19.some((m) => archetypeFor(m.id).id === "giant-spider")).toBe(false);

      const rngAt20 = new Rng(seed);
      const { monsters: monstersAt20 } = createFloor(rngAt20, 20);
      if (monstersAt20.some((m) => archetypeFor(m.id).id === "giant-spider")) sawAtFloor20 = true;
    }
    expect(sawAtFloor20).toBe(true);
  });

  test("floor 1's only possible 'strong'-tier pick is skeleton-guard (the one strong-tier archetype with minFloor 0, by design)", () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = new Rng(seed);
      const { monsters } = createFloor(rng, 1);
      for (const m of monsters) {
        const archetype = archetypeFor(m.id);
        if (archetype.powerTier === "strong") expect(archetype.id).toBe("skeleton-guard");
      }
    }
  });
});
