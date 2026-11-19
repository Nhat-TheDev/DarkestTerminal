import { describe, expect, test } from "bun:test";
import { createFloor } from "../src/data/floor";
import { Rng } from "../src/engine/rng";
import { MONSTER_ARCHETYPES } from "../src/data/monsters";
import { CONFIGURED_TEMPLE_CHANCE, withTempleChance } from "./setup";
import { RELIGIONS } from "../src/data/religions";

const religionIds = RELIGIONS.map((r) => r.id);

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

describe("temple placement", () => {
  const SEEDS = Array.from({ length: 2000 }, (_, i) => i + 1);

  test("temple rolls at the configured chance", () => {
    const hits = withTempleChance(CONFIGURED_TEMPLE_CHANCE, () => SEEDS.filter((seed) => createFloor(new Rng(seed), 1).floor.rooms[0]!.type === "temple").length);
    expect(Math.abs(hits / SEEDS.length - CONFIGURED_TEMPLE_CHANCE)).toBeLessThan(0.03);
  });

  test("temple entry leads to the old visible combat entrance", () => {
    let temples = 0;
    for (const seed of SEEDS.slice(0, 200)) {
      const { floor } = withTempleChance(CONFIGURED_TEMPLE_CHANCE, () => createFloor(new Rng(seed), 1 + (seed % 9)));
      const first = floor.rooms[0]!;
      if (first.type !== "temple") continue;
      temples++;
      expect(floor.entryRoomId).toBe(first.id);
      expect(first.connectedRoomIds).toHaveLength(1);
      expect(first.hidden).toBeUndefined();
      expect(first.monsterIds).toEqual([]);
      const next = floor.rooms.find((r) => r.id === first.connectedRoomIds[0])!;
      expect(next.type).toBe("combat");
      expect(next.hidden).toBeUndefined();
      expect(religionIds).toContain(first.templeReligionId!);
    }
    expect(temples).toBeGreaterThan(0);
  });

  test("layout and monsters unchanged by the temple", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const withTemple = withTempleChance(1, () => createFloor(new Rng(seed), 3));
      const without = createFloor(new Rng(seed), 3);
      const shape = (r: { floor: { rooms: unknown[] }; monsters: unknown[] }) => JSON.parse(JSON.stringify({ rooms: r.floor.rooms, monsters: r.monsters }).replace(/-\d+"/g, '"'));
      expect(shape({ floor: { rooms: withTemple.floor.rooms.slice(1) }, monsters: withTemple.monsters })).toEqual(shape(without));
      expect(without.floor.entryRoomId).toBe(withTemple.floor.rooms[1]!.id);
    }
  });
});
