import { describe, test, expect } from "bun:test";
import {
  FLOOR_PATTERNS,
  parsePatternLayout,
  validatePattern,
  roomTypeForTag,
  pathRoomBounds,
  MIN_COMBAT_ROOMS_PER_PATH,
  MIN_REST_ROOMS_PER_PATH,
  MAX_REST_ROOMS_PER_PATH,
  type FloorPatternDef,
} from "../src/data/floorPatterns";
import { buildFloorFromPattern } from "../src/data/floor";
import { connectedRooms } from "../src/engine/dungeon";
import { Rng } from "../src/engine/rng";

function bfsReachable(floor: ReturnType<typeof buildFloorFromPattern>["floor"]): Set<string> {
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
  return visited;
}

describe("data/floor-patterns.json — every pattern obeys the design rules", () => {
  test("the library isn't empty", () => {
    expect(FLOOR_PATTERNS.length).toBeGreaterThan(0);
  });

  for (const pattern of FLOOR_PATTERNS) {
    describe(`pattern "${pattern.id}"`, () => {
      test("parses and validates without throwing", () => {
        expect(() => validatePattern(pattern)).not.toThrow();
      });

      test("has at most 2 branch stages (stages with >1 room)", () => {
        const stages = validatePattern(pattern);
        const branchStages = stages.filter((s) => s.length > 1).length;
        expect(branchStages).toBeLessThanOrEqual(2);
      });

      test("every room is reachable from the entry, and every room can reach the boss (no dead ends)", () => {
        const { floor } = buildFloorFromPattern(pattern, new Rng(42));
        const reachableFromEntry = bfsReachable(floor);
        expect(reachableFromEntry.size).toBe(floor.rooms.length);

        // Forward-only DAG: walking connectedRoomIds from ANY room must eventually hit the boss room.
        const bossId = floor.rooms.find((r) => r.type === "boss")!.id;
        for (const room of floor.rooms) {
          let frontier = [room.id];
          const seen = new Set(frontier);
          let reachedBoss = room.id === bossId;
          while (frontier.length > 0 && !reachedBoss) {
            const next: string[] = [];
            for (const id of frontier) {
              for (const n of connectedRooms(floor, id)) {
                if (n.id === bossId) reachedBoss = true;
                if (!seen.has(n.id)) {
                  seen.add(n.id);
                  next.push(n.id);
                }
              }
            }
            frontier = next;
          }
          expect(reachedBoss).toBe(true);
        }
      });

      test("exactly 1 rest room and exactly 1 boss room", () => {
        const { floor } = buildFloorFromPattern(pattern, new Rng(7));
        expect(floor.rooms.filter((r) => r.type === "boss")).toHaveLength(1);
        expect(floor.rooms.filter((r) => r.type === "rest").length).toBeGreaterThanOrEqual(1);
      });

      test(`every path to boss has >=${MIN_COMBAT_ROOMS_PER_PATH} combat rooms and ${MIN_REST_ROOMS_PER_PATH}-${MAX_REST_ROOMS_PER_PATH} rest rooms`, () => {
        const stages = validatePattern(pattern);
        const bounds = pathRoomBounds(stages);
        expect(bounds.combat.min).toBeGreaterThanOrEqual(MIN_COMBAT_ROOMS_PER_PATH);
        expect(bounds.rest.min).toBeGreaterThanOrEqual(MIN_REST_ROOMS_PER_PATH);
        expect(bounds.rest.max).toBeLessThanOrEqual(MAX_REST_ROOMS_PER_PATH);
      });

      test("room count is stable across different rng seeds (structure is fixed by the pattern, not randomized)", () => {
        const countA = buildFloorFromPattern(pattern, new Rng(1)).floor.rooms.length;
        const countB = buildFloorFromPattern(pattern, new Rng(999)).floor.rooms.length;
        expect(countA).toBe(countB);
      });
    });
  }
});

describe("parsePatternLayout", () => {
  test("splits stages on '-' and rooms within a stage on ','", () => {
    const stages = parsePatternLayout("0.1[]-1.2[],1.3[free]-2.4[boss]");
    expect(stages).toEqual([
      [{ stage: 0, roomId: 1, tag: "" }],
      [
        { stage: 1, roomId: 2, tag: "" },
        { stage: 1, roomId: 3, tag: "free" },
      ],
      [{ stage: 2, roomId: 4, tag: "boss" }],
    ]);
  });

  test("throws on a malformed token", () => {
    expect(() => parsePatternLayout("0.1[]-not-a-token")).toThrow();
  });

  test("throws when a token's declared stage doesn't match its position", () => {
    expect(() => parsePatternLayout("0.1[]-5.2[]")).toThrow();
  });
});

describe("roomTypeForTag", () => {
  test("maps tags to RoomType", () => {
    expect(roomTypeForTag("")).toBe("combat");
    expect(roomTypeForTag("free")).toBe("rest");
    expect(roomTypeForTag("boss")).toBe("boss");
  });

  test("throws on an unknown tag", () => {
    expect(() => roomTypeForTag("nonsense")).toThrow();
  });
});

describe("validatePattern rejects patterns that break the rules", () => {
  function pattern(layout: string): FloorPatternDef {
    return { id: "test", description: "", layout };
  }

  test("rejects more than 2 branch stages", () => {
    const bad = pattern("0.1[]-1.2[],1.3[]-2.4[],2.5[]-3.6[],3.7[]-4.8[boss]");
    expect(() => validatePattern(bad)).toThrow(/branch/);
  });

  test("rejects a non-boss final stage", () => {
    const bad = pattern("0.1[]-1.2[]");
    expect(() => validatePattern(bad)).toThrow(/boss/);
  });

  test("rejects [boss] appearing outside the final stage", () => {
    const bad = pattern("0.1[boss]-1.2[boss]");
    expect(() => validatePattern(bad)).toThrow(/boss/);
  });

  test("rejects more than 1 room in the entry stage", () => {
    const bad = pattern("0.1[],0.2[]-1.3[boss]");
    expect(() => validatePattern(bad)).toThrow(/entry/);
  });

  test("rejects duplicate room ids", () => {
    const bad = pattern("0.1[]-1.1[boss]");
    expect(() => validatePattern(bad)).toThrow(/unique/);
  });

  test("rejects a path with fewer than the minimum combat rooms", () => {
    const bad = pattern("0.1[]-1.2[free]-2.3[boss]");
    expect(() => validatePattern(bad)).toThrow(/combat rooms/);
  });

  test("rejects a path with no rest rooms", () => {
    const bad = pattern("0.1[]-1.2[]-2.3[]-3.4[]-4.5[]-5.6[boss]");
    expect(() => validatePattern(bad)).toThrow(/rest rooms/);
  });

  test("rejects a path with more than the maximum rest rooms", () => {
    const bad = pattern("0.1[]-1.2[]-2.3[]-3.4[]-4.5[]-5.6[free]-6.7[free]-7.8[free]-8.9[boss]");
    expect(() => validatePattern(bad)).toThrow(/rest rooms/);
  });
});
