import { describe, test, expect } from "bun:test";
import { getClass } from "../src/data/classes";
import { createFloor } from "../src/data/floor";
import { createCharacter } from "../src/engine/party";
import { Rng } from "../src/engine/rng";
import { connectedRooms } from "../src/engine/dungeon";
import { STRINGS, t } from "../src/data/strings";

describe("floor layout", () => {
  test("every room is reachable from the entry room", () => {
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

  test("has exactly 1 boss room with an elite/boss monster", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { floor, monsters } = createFloor(new Rng(seed));
      const bossRooms = floor.rooms.filter((r) => r.type === "boss");
      expect(bossRooms).toHaveLength(1);
      const guardMonsters = bossRooms[0]!.monsterIds.map((id) => monsters.find((m) => m.id === id)!);
      expect(guardMonsters.every((m) => m.tier !== "normal")).toBe(true);
    }
  });

  test("combat rooms have monsters, rest rooms don't", () => {
    const { floor, monsters } = createFloor(new Rng(3));
    for (const room of floor.rooms) {
      if (room.type === "combat") expect(room.monsterIds.length).toBeGreaterThan(0);
      if (room.type === "rest") expect(room.monsterIds).toHaveLength(0);
    }
    expect(monsters.length).toBeGreaterThan(0);
  });
});


describe("character creation", () => {
  test("level-1 character has only starting skills unlocked", () => {
    const cls = getClass("knight");
    const c = createCharacter("c1", "Test", cls);
    expect(c.unlockedSkillIds).toEqual(["slash", "interpose", "breach"]);
    expect(c.hp).toBe(cls.baseMaxHp);
    expect(c.survival).toEqual({ fear: 0 });
  });
});

describe("strings", () => {
  test("{{n|one|many}} picks the singular form only for exactly 1", () => {
    expect(t("errors.skillOnCooldown", { turns: 1 })).toBe("Still on cooldown (1 turn left).");
    expect(t("errors.skillOnCooldown", { turns: 2 })).toBe("Still on cooldown (2 turns left).");
    expect(t("game.coinsEarned", { amount: 1 })).toBe("The party earns 1 coin.");
    expect(t("game.coinsEarned", { amount: 0 })).toBe("The party earns 0 coins.");
  });

  test("no string writes a count straight before a plural noun without the plural form", () => {
    const bare = /\{\{(?!actor\}\})\w+\}\} (turns|coins|stacks|uses|rooms|minions|actions|counters|hits|dice)\b/;
    expect(Object.entries(STRINGS).filter(([, text]) => bare.test(text)).map(([key]) => key)).toEqual([]);
  });
});
