import { describe, test, expect } from "bun:test";
import { getClass } from "../src/data/classes";
import { createFloor } from "../src/data/floor";
import { createCharacter } from "../src/engine/party";
import { Rng } from "../src/engine/rng";
import { connectedRooms } from "../src/engine/dungeon";

describe("floor layout (random pattern pick — see test/floorPatterns.test.ts for per-pattern structural rules)", () => {
  test("every room is reachable from the entry room, across many random seeds", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { floor } = createFloor(new Rng(seed));
      const visited = new Set<string>([floor.entryRoomId]);
      const queue = [floor.entryRoomId];
      while (queue.length > 0) {
        const id = queue.shift()!;
        for (const next of connectedRooms(floor, id)) {
          if (!visited.has(next.id)) {
            visited.add(next.id);
            queue.push(next.id);
          }
        }
      }
      expect(visited.size).toBe(floor.rooms.length);
    }
  });

  test("exactly 1 boss room, and its monster is flagged elite/boss (guard tier)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { floor, monsters } = createFloor(new Rng(seed));
      const bossRooms = floor.rooms.filter((r) => r.type === "boss");
      expect(bossRooms).toHaveLength(1);
      const guardMonsters = bossRooms[0]!.monsterIds.map((id) => monsters.find((m) => m.id === id)!);
      expect(guardMonsters.every((m) => m.tier !== "normal")).toBe(true);
    }
  });

  test("every combat room has at least 1 monster, rest/boss rooms don't double up", () => {
    const { floor, monsters } = createFloor(new Rng(3));
    for (const room of floor.rooms) {
      if (room.type === "combat") expect(room.monsterIds.length).toBeGreaterThan(0);
      if (room.type === "rest") expect(room.monsterIds).toHaveLength(0);
    }
    expect(monsters.length).toBeGreaterThan(0);
  });
});


describe("character creation", () => {
  test("level-1 character only has slot 0-2 skills unlocked (basic attack + 2 own skills)", () => {
    const cls = getClass("vanguard");
    const c = createCharacter("c1", "Test", cls);
    expect(c.unlockedSkillIds).toEqual(["vanguard-slash", "vanguard-shield-guard", "vanguard-shield-throw"]);
    expect(c.hp).toBe(cls.baseMaxHp);
    expect(c.survival).toEqual({ hunger: 100, thirst: 100, fear: 0 });
  });
});

