import { describe, test, expect } from "bun:test";
import {
  MONSTER_ARCHETYPES,
  COMBAT_ROOM_ARCHETYPES,
  GUARD_ROOM_ARCHETYPES,
  FINAL_BOSS_ARCHETYPE,
  assertMonsterDataConsistent,
  getArchetype,
  spawnMonster,
} from "../src/data/monsters";
import { createFloor } from "../src/data/floor";
import { spriteForMonster } from "../src/ui/sprites";
import { Rng } from "../src/engine/rng";

describe("monster roles: normal / elite-boss / triple / final-boss", () => {
  test("shipped catalog passes validation", () => {
    expect(() => assertMonsterDataConsistent(MONSTER_ARCHETYPES)).not.toThrow();
  });

  test("roles match actionWeights keys exactly", () => {
    for (const a of MONSTER_ARCHETYPES) {
      expect(new Set(a.roles)).toEqual(new Set(Object.keys(a.actionWeights ?? {}) as never));
    }
  });

  test("powerTier is set exactly for normal-role archetypes", () => {
    for (const a of MONSTER_ARCHETYPES) {
      if (a.roles.includes("normal")) expect(a.powerTier).toBeDefined();
      else expect(a.powerTier).toBeUndefined();
    }
  });

  test("exactly 1 final boss with roles [boss]", () => {
    expect(FINAL_BOSS_ARCHETYPE.id).toBe("the-founder");
    expect(FINAL_BOSS_ARCHETYPE.roles).toEqual(["boss"]);
    expect(MONSTER_ARCHETYPES.filter((a) => a.finalBoss).length).toBe(1);
  });

  test("every archetype has one of the four documented role shapes; room pools are non-empty and exclude the final boss", () => {
    const shapes = new Set(["normal", "normal,elite,boss", "elite,boss", "boss"]);
    for (const a of MONSTER_ARCHETYPES) expect(shapes.has(a.roles.join(","))).toBe(true);
    expect(COMBAT_ROOM_ARCHETYPES.length).toBeGreaterThan(0);
    expect(GUARD_ROOM_ARCHETYPES.length).toBeGreaterThan(0);
    expect(COMBAT_ROOM_ARCHETYPES.every((a) => a.roles.includes("normal") && !a.finalBoss)).toBe(true);
    expect(GUARD_ROOM_ARCHETYPES.every((a) => a.roles.includes("elite") && a.roles.includes("boss") && !a.finalBoss)).toBe(true);
  });

  test("skeleton-guard is the only triple-role: spawns as all 3 tiers", () => {
    for (const tier of ["normal", "elite", "boss"] as const) {
      const m = spawnMonster("skeleton-guard", 3, tier === "normal" ? undefined : { tier });
      expect(m.tier).toBe(tier);
    }
  });

  test("guard-only ids refuse normal spawn; trash ids refuse elite/boss spawn", () => {
    expect(() => spawnMonster("dragon", 1)).toThrow(/roles are \[elite,boss\]/);
    expect(() => spawnMonster("dragon", 1, { tier: "elite" })).not.toThrow();
    expect(() => spawnMonster("dragon", 1, { tier: "boss" })).not.toThrow();
    expect(() => spawnMonster("dungeon-rat", 1, { tier: "elite" })).toThrow(/roles are \[normal\]/);
    expect(() => spawnMonster("dungeon-rat", 1, { tier: "boss" })).toThrow(/roles are \[normal\]/);
    expect(() => spawnMonster("the-founder", 1)).toThrow(/roles are \[boss\]/);
    expect(() => spawnMonster("the-founder", 1, { tier: "elite" })).toThrow(/roles are \[boss\]/);
  });

  test("rolled floors never contain guard-only or final-boss as trash, never contain final boss at all", () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const depth of [1, 2, 3, 4, 5, 10]) {
        const { floor, monsters } = createFloor(new Rng(seed), depth);
        const byId = new Map(monsters.map((m) => [m.id, m]));
        for (const room of floor.rooms) {
          for (const mid of room.monsterIds) {
            const m = byId.get(mid)!;
            if (room.type === "combat") {
              expect(m.tier).toBe("normal");
              expect(getArchetype(m.archetypeId).roles.includes("normal")).toBe(true);
              expect(m.archetypeId).not.toBe("the-founder");
            }
            if (room.type === "boss") {
              expect(m.archetypeId).not.toBe("the-founder");
              expect(getArchetype(m.archetypeId).roles.includes(m.tier)).toBe(true);
            }
          }
        }
      }
    }
  });

  test("guard-only archetypes have elite+boss sprites and no normal sprite", () => {
    for (const a of GUARD_ROOM_ARCHETYPES) {
      if (a.id === "skeleton-guard") continue;
      expect(() => spriteForMonster(a.id, "elite")).not.toThrow();
      expect(() => spriteForMonster(a.id, "boss")).not.toThrow();
      expect(() => spriteForMonster(a.id, "normal")).toThrow();
    }
  });

  test("validator rejects mismatched roles/weights, missing powerTier, and duplicate final boss", () => {
    const base = getArchetype("dungeon-rat");
    const mismatched = { ...base, roles: ["normal", "elite"] as const };
    expect(() => assertMonsterDataConsistent([mismatched as never])).toThrow(/must match actionWeights keys/);
    const noPower = { ...base, powerTier: undefined };
    expect(() => assertMonsterDataConsistent([noPower as never])).toThrow(/needs a "powerTier"/);
    const strayPower = { ...getArchetype("dragon"), powerTier: "strong" as const };
    expect(() => assertMonsterDataConsistent([strayPower as never])).toThrow(/must not set "powerTier"/);
    const founderBase = getArchetype("the-founder");
    const twoFinals = [...MONSTER_ARCHETYPES, { ...founderBase, id: "fake-final" }];
    expect(() => assertMonsterDataConsistent(twoFinals as never)).toThrow(/exactly 1 finalBoss/);
  });
});
