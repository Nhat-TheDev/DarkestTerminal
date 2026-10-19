import { describe, expect, test } from "bun:test";
import { computeDamage, levelByDepthFloorSeed, simulateLevelByDepth } from "../tools/game-editor/calc";
import { BALANCE } from "../src/data/balanceConfig";
import { createFloor } from "../src/data/floor";
import { Rng } from "../src/engine/rng";
import type { Room } from "../src/types";

describe("game-editor computeDamage: the range of one swing", () => {
  const hit = () => {
    const result = computeDamage({ offense: 100, defense: 20, amount: 30 });
    if ("error" in result) throw new Error(result.error);
    return result;
  };

  test("brackets the unvaried damage by combat.damageVariancePercent", () => {
    const { rawTotal, finalDamage, finalDamageMin, finalDamageMax } = hit();
    const p = BALANCE.combat.damageVariancePercent / 100;
    expect(finalDamageMin).toBe(Math.max(1, Math.floor(rawTotal * (1 - p))));
    expect(finalDamageMax).toBe(Math.max(1, Math.ceil(rawTotal * (1 + p))));
    expect(finalDamageMin).toBeLessThanOrEqual(finalDamage);
    expect(finalDamageMax).toBeGreaterThanOrEqual(finalDamage);
  });

  test("is never below 1, whatever the variance", () => {
    const result = computeDamage({ offense: 0, defense: 500, amount: 0 });
    if ("error" in result) throw new Error(result.error);
    expect(result.finalDamageMin).toBeGreaterThanOrEqual(1);
  });
});

describe("game-editor simulateLevelByDepth: one path per floor", () => {
  const floorExp = (seed: number) => {
    const { floor, monsters } = createFloor(new Rng(levelByDepthFloorSeed(seed)), 1);
    const roomsById = new Map(floor.rooms.map((r) => [r.id, r]));
    const expById = new Map(monsters.map((m) => [m.id, m.expReward]));
    const roomExp = (room: Room) => room.monsterIds.reduce((sum, id) => sum + (expById.get(id) ?? 0), 0);
    const pathBound = (room: Room, pick: (...xs: number[]) => number): number =>
      roomExp(room) + (room.connectedRoomIds.length === 0 ? 0 : pick(...room.connectedRoomIds.map((id) => pathBound(roomsById.get(id)!, pick))));
    const entry = roomsById.get(floor.entryRoomId)!;
    return {
      minPath: pathBound(entry, Math.min),
      maxPath: pathBound(entry, Math.max),
      everyRoom: floor.rooms.reduce((sum, r) => sum + roomExp(r), 0),
    };
  };

  test("counts the EXP of one entry-to-guard path", () => {
    const { minPath, maxPath } = floorExp(0);
    const [row] = simulateLevelByDepth(1, 1);
    expect(row!.avgPartyExp).toBeGreaterThanOrEqual(minPath);
    expect(row!.avgPartyExp).toBeLessThanOrEqual(maxPath);
  });

  test("leaves out the branch rooms off that path", () => {
    const seeds = 20;
    let everyRoom = 0;
    for (let seed = 0; seed < seeds; seed++) everyRoom += floorExp(seed).everyRoom;
    const [row] = simulateLevelByDepth(seeds, 1);
    expect(row!.avgPartyExp).toBeLessThan(everyRoom / seeds);
  });

  test("returns one row per depth with EXP that never drops", () => {
    const rows = simulateLevelByDepth(3, 10);
    expect(rows.map((r) => r.depth)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.avgPartyExp).toBeGreaterThanOrEqual(rows[i - 1]!.avgPartyExp);
  });
});
