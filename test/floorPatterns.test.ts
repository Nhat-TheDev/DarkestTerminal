import { describe, test, expect } from "bun:test";
import {
  generateFloorLayout,
  validateGeneratedStages,
  roomTypeForTag,
  MIN_PATH_ROOMS,
  MAX_PATH_ROOMS,
  MAX_BRANCHES,
  MIN_BRANCH_START_STAGE,
  MIN_BRANCH_SPACING,
  MAX_EVENT_ROOMS_PER_PATH,
  MIN_REST_ROOMS_PER_PATH,
  MAX_REST_ROOMS_PER_PATH,
} from "../src/data/floorPatterns";
import { buildFloorFromStages } from "../src/data/floor";
import { connectedRooms } from "../src/engine/dungeon";
import { Rng } from "../src/engine/rng";

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 37 + 1);

function bfsReachable(floor: ReturnType<typeof buildFloorFromStages>["floor"]): Set<string> {
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

describe("generateFloorLayout", () => {
  for (const seed of SEEDS) {
    describe(`seed ${seed}`, () => {
      const stages = generateFloorLayout(new Rng(seed));

      test("validates without throwing", () => {
        expect(() => validateGeneratedStages(stages)).not.toThrow();
      });

      test(`path length is ${MIN_PATH_ROOMS}-${MAX_PATH_ROOMS} rooms (including start + boss)`, () => {
        expect(stages.length).toBeGreaterThanOrEqual(MIN_PATH_ROOMS);
        expect(stages.length).toBeLessThanOrEqual(MAX_PATH_ROOMS);
      });

      test("stage 0 is exactly 1 combat room, final stage is exactly 1 boss room", () => {
        expect(stages[0]).toEqual([{ stage: 0, roomId: stages[0]![0]!.roomId, tag: "" }]);
        const last = stages[stages.length - 1]!;
        expect(last).toHaveLength(1);
        expect(last[0]!.tag).toBe("boss");
      });

      test(`at most ${MAX_BRANCHES} branch stages, none before stage ${MIN_BRANCH_START_STAGE}, spaced >= ${MIN_BRANCH_SPACING} apart`, () => {
        const branchStages = stages.map((s, i) => ({ s, i })).filter(({ s }) => s.length > 1);
        expect(branchStages.length).toBeLessThanOrEqual(MAX_BRANCHES);
        for (const { i } of branchStages) expect(i).toBeGreaterThanOrEqual(MIN_BRANCH_START_STAGE);
        for (let k = 1; k < branchStages.length; k++) {
          expect(branchStages[k]!.i - branchStages[k - 1]!.i).toBeGreaterThanOrEqual(MIN_BRANCH_SPACING);
        }
      });

      test("every branch stage offers exactly 1 combat room + 1 event room", () => {
        for (const stage of stages) {
          if (stage.length <= 1) continue;
          const tags = stage.map((r) => r.tag).sort();
          expect(tags).toEqual(["", "event"]);
        }
      });

      test("2 event rooms are never adjacent", () => {
        const eventStages = stages.map((s, i) => ({ s, i })).filter(({ s }) => s.some((r) => r.tag === "event")).map(({ i }) => i);
        for (let k = 1; k < eventStages.length; k++) {
          expect(eventStages[k]! - eventStages[k - 1]!).toBeGreaterThan(1);
        }
      });

      test(`every path has at most ${MAX_EVENT_ROOMS_PER_PATH} event rooms`, () => {
        const eventStageCount = stages.filter((s) => s.some((r) => r.tag === "event")).length;
        expect(eventStageCount).toBeLessThanOrEqual(MAX_EVENT_ROOMS_PER_PATH);
      });

      test(`every path has ${MIN_REST_ROOMS_PER_PATH}-${MAX_REST_ROOMS_PER_PATH} rest rooms, never on a branch stage`, () => {
        const restStages = stages.map((s, i) => ({ s, i })).filter(({ s }) => s.length === 1 && s[0]!.tag === "free");
        expect(restStages.length).toBeGreaterThanOrEqual(MIN_REST_ROOMS_PER_PATH);
        expect(restStages.length).toBeLessThanOrEqual(MAX_REST_ROOMS_PER_PATH);
      });

      test("every roomId is unique", () => {
        const ids = stages.flat().map((r) => r.roomId);
        expect(new Set(ids).size).toBe(ids.length);
      });

      test("every room is reachable from entry, and every room can reach the boss (no dead ends)", () => {
        const { floor } = buildFloorFromStages(stages, new Rng(seed));
        const reachableFromEntry = bfsReachable(floor);
        expect(reachableFromEntry.size).toBe(floor.rooms.length);

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
    });
  }
});

describe("roomTypeForTag", () => {
  test("maps tags to RoomType", () => {
    expect(roomTypeForTag("")).toBe("combat");
    expect(roomTypeForTag("free")).toBe("rest");
    expect(roomTypeForTag("boss")).toBe("boss");
    expect(roomTypeForTag("event")).toBe("event");
  });

  test("throws on an unknown tag", () => {
    expect(() => roomTypeForTag("nonsense")).toThrow();
  });
});

describe("validateGeneratedStages rejects layouts that break the rules", () => {
  function stage(entries: Array<[number, string]>, s: number) {
    return entries.map(([roomId, tag]) => ({ stage: s, roomId, tag }));
  }

  test("rejects too few stages", () => {
    const bad = [stage([[1, ""]], 0), stage([[2, "boss"]], 1)];
    expect(() => validateGeneratedStages(bad)).toThrow(/stages/);
  });

  test("rejects more than 1 room in the entry stage", () => {
    const bad = [
      stage(
        [
          [1, ""],
          [2, ""],
        ],
        0,
      ),
      ...Array.from({ length: 5 }, (_, i) => stage([[10 + i, ""]], i + 1)),
      stage([[20, "boss"]], 6),
    ];
    expect(() => validateGeneratedStages(bad)).toThrow(/start/);
  });

  test("rejects a non-boss final stage", () => {
    const bad = Array.from({ length: 7 }, (_, i) => stage([[i + 1, ""]], i));
    expect(() => validateGeneratedStages(bad)).toThrow(/boss/);
  });

  test("rejects a branch stage before MIN_BRANCH_START_STAGE", () => {
    const bad = [
      stage([[1, ""]], 0),
      stage(
        [
          [2, ""],
          [3, "event"],
        ],
        1,
      ),
      ...Array.from({ length: 4 }, (_, i) => stage([[10 + i, ""]], i + 2)),
      stage([[20, "boss"]], 6),
    ];
    expect(() => validateGeneratedStages(bad)).toThrow(/branch stage/);
  });

  test("rejects a branch stage that isn't 1 combat + 1 event", () => {
    const bad = [
      stage([[1, ""]], 0),
      stage([[2, ""]], 1),
      stage(
        [
          [3, ""],
          [4, ""],
        ],
        2,
      ),
      ...Array.from({ length: 3 }, (_, i) => stage([[10 + i, ""]], i + 3)),
      stage([[20, "boss"]], 6),
    ];
    expect(() => validateGeneratedStages(bad)).toThrow(/combat \+ 1 event/);
  });

  test("rejects duplicate room ids", () => {
    const layout = [
      stage([[1, ""]], 0),
      stage([[1, "free"]], 1),
      stage([[3, ""]], 2),
      stage([[4, ""]], 3),
      stage([[5, ""]], 4),
      stage([[6, ""]], 5),
      stage([[7, "boss"]], 6),
    ];
    expect(() => validateGeneratedStages(layout)).toThrow(/unique/);
  });

  test("rejects a path with no rest rooms", () => {
    const layout = Array.from({ length: 6 }, (_, i) => stage([[i + 1, ""]], i)).concat([stage([[7, "boss"]], 6)]);
    expect(() => validateGeneratedStages(layout)).toThrow(/rest rooms/);
  });

  test("rejects a path with more than the maximum rest rooms", () => {
    const layout = [
      stage([[1, ""]], 0),
      stage([[2, "free"]], 1),
      stage([[3, "free"]], 2),
      stage([[4, "free"]], 3),
      stage([[5, ""]], 4),
      stage([[6, ""]], 5),
      stage([[7, "boss"]], 6),
    ];
    expect(() => validateGeneratedStages(layout)).toThrow(/rest rooms/);
  });
});
