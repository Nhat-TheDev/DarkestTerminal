import { describe, test, expect } from "bun:test";
import { generateFloorLayout, validateFloorLayout, fallbackLayout, unknownRoomsMean, lanesSideBySide, type LayoutRoom } from "../src/data/floorPatterns";
import { buildFloorFromLayout, createFloor } from "../src/data/floor";
import { FloorGraph } from "../src/engine/floorGraph";
import { BALANCE } from "../src/data/balanceConfig";
import { Rng } from "../src/engine/rng";

const CONFIG = BALANCE.floorGeneration;
const SEEDS = Array.from({ length: 150 }, (_, i) => i * 37 + 1);
const DEPTHS = [1, 5, 20, 60, 100, 140];

function layoutsAt(depth: number): LayoutRoom[][] {
  return SEEDS.map((seed) => generateFloorLayout(new Rng(seed * 101 + depth), depth));
}

describe("generateFloorLayout", () => {
  for (const depth of DEPTHS) {
    test(`every floor at depth ${depth} meets every route, lane and unknown-room rule`, () => {
      for (const layout of layoutsAt(depth)) expect(() => validateFloorLayout(layout)).not.toThrow();
    });
  }

  test("is deterministic for a seed", () => {
    expect(generateFloorLayout(new Rng(42), 30)).toEqual(generateFloorLayout(new Rng(42), 30));
  });

  test("most floors split, and some run 4 lanes side by side", () => {
    const widths = layoutsAt(10).map(lanesSideBySide);
    expect(widths.filter((w) => w > 1).length).toBeGreaterThan(SEEDS.length * 0.8);
    expect(widths).toContain(CONFIG.maxParallelLanes);
  });

  test("a split opens at most 3 lanes, and some floors open exactly 3", () => {
    const widest = layoutsAt(10).map((l) => Math.max(...l.map((r) => r.next.length)));
    expect(Math.max(...widest)).toBe(CONFIG.maxLanesPerSplit);
  });

  // Rooms are numbered as they are made, and a cross branch is made after the room it merges into.
  const hasCrossBranch = (l: LayoutRoom[]) => l.some((r) => r.next.some((n) => Number(n.slice(1)) < Number(r.id.slice(1))));

  test("some floors have a branch that merges into the lane below", () => {
    expect(layoutsAt(10).filter(hasCrossBranch).length).toBeGreaterThan(SEEDS.length * 0.05);
  });

  test("routes on one floor differ in length", () => {
    const differing = layoutsAt(10).filter((l) => {
      const { rooms } = new FloorGraph(l, l[0]!.id).routeBounds(l[0]!.id);
      return rooms.min < rooms.max;
    });
    expect(differing.length).toBeGreaterThan(SEEDS.length / 2);
  });

  test("routes with 5 or 6 events are rare", () => {
    const many = layoutsAt(10).filter((l) => new FloorGraph(l, l[0]!.id).routeBounds(l[0]!.id).event.max > CONFIG.commonMaxEventRoomsPerRoute);
    expect(many.length).toBeLessThan(SEEDS.length * 0.1);
  });

  test("unknown rooms are rare on the first floors and grow with depth", () => {
    const meanHidden = (depth: number) => layoutsAt(depth).reduce((sum, l) => sum + l.filter((r) => r.hidden).length, 0) / SEEDS.length;
    expect(meanHidden(1)).toBeLessThan(1.5);
    expect(meanHidden(50)).toBeGreaterThan(meanHidden(1) + 2);
    expect(meanHidden(100)).toBeGreaterThan(meanHidden(50));
  });

  test("the unknown-room mean stops growing past its cap depth", () => {
    expect(unknownRoomsMean(CONFIG.unknownRoomsMeanCapDepth + 50)).toBe(unknownRoomsMean(CONFIG.unknownRoomsMeanCapDepth));
    expect(unknownRoomsMean(1)).toBeGreaterThanOrEqual(0);
  });

  test("the fallback layout passes every rule", () => {
    expect(() => validateFloorLayout(fallbackLayout())).not.toThrow();
  });
});

describe("buildFloorFromLayout", () => {
  test("keeps the graph, the hidden flags and an entrance with every room reachable", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const layout = generateFloorLayout(new Rng(seed), 80);
      const { floor } = buildFloorFromLayout(layout, new Rng(seed));
      expect(floor.entryRoomId).toBe(layout[0]!.id);
      expect(floor.rooms.map((r) => [r.id, r.type, r.connectedRoomIds, r.hidden === true])).toEqual(layout.map((r) => [r.id, r.type, r.next, r.hidden]));
    }
  });

  test("only combat and guard rooms hold monsters", () => {
    const { floor } = createFloor(new Rng(7), 12);
    for (const room of floor.rooms) {
      const fights = room.type === "combat" || room.type === "boss";
      expect(room.monsterIds.length > 0).toBe(fights);
    }
  });
});

describe("validateFloorLayout rejects layouts that break the rules", () => {
  const line = (types: LayoutRoom["type"][]): LayoutRoom[] =>
    types.map((type, i) => ({ id: `r${i + 1}`, type, next: i === types.length - 1 ? [] : [`r${i + 2}`], hidden: false }));
  const valid = () => line(["combat", "event", "combat", "event", "combat", "rest", "combat", "combat", "combat", "boss"]);

  test("a valid line passes", () => {
    expect(() => validateFloorLayout(valid())).not.toThrow();
  });

  test("a route that is too short", () => {
    expect(() => validateFloorLayout(line(["combat", "event", "combat", "event", "rest", "boss"]))).toThrow(/rooms, expected/);
  });

  test("a route with no rest room", () => {
    expect(() => validateFloorLayout(line(["combat", "event", "combat", "event", "combat", "combat", "combat", "combat", "combat", "boss"]))).toThrow(/rest rooms/);
  });

  test("too few events", () => {
    expect(() => validateFloorLayout(line(["combat", "event", "combat", "rest", "combat", "combat", "combat", "combat", "combat", "boss"]))).toThrow(/event rooms/);
  });

  test("two events in a row", () => {
    expect(() => validateFloorLayout(line(["combat", "event", "event", "combat", "combat", "rest", "combat", "combat", "combat", "boss"]))).toThrow(/adjacent/);
  });

  test("two unknown rooms in a row", () => {
    const layout = valid();
    layout[2]!.hidden = true;
    layout[3]!.hidden = true;
    expect(() => validateFloorLayout(layout)).toThrow(/unknown rooms/);
  });

  test("a hidden entrance or guard", () => {
    const entrance = valid();
    entrance[0]!.hidden = true;
    expect(() => validateFloorLayout(entrance)).toThrow(/entrance/);
    const guard = valid();
    guard.at(-1)!.hidden = true;
    expect(() => validateFloorLayout(guard)).toThrow(/boss/);
  });

  test("a dead end", () => {
    const layout = valid();
    layout[3]!.next.push("r11");
    layout.splice(10, 0, { id: "r11", type: "combat", next: [], hidden: false });
    expect(() => validateFloorLayout(layout)).toThrow(/dead ends/);
  });

  test("a lane of 1 room", () => {
    const layout = valid();
    layout.push({ id: "r11", type: "combat", next: ["r4"], hidden: false });
    layout[1]!.next.push("r11");
    expect(() => validateFloorLayout(layout)).toThrow(/lane holds 1 rooms/);
  });

  const lateEvent = () => line(["combat", "event", "combat", "combat", "combat", "rest", "event", "combat", "combat", "boss"]);

  test("4 lanes from one split", () => {
    const layout = lateEvent();
    for (const lane of ["a", "b", "c"]) {
      layout.push({ id: `${lane}1`, type: "combat", next: [`${lane}2`], hidden: false }, { id: `${lane}2`, type: "combat", next: ["r5"], hidden: false });
      layout[1]!.next.push(`${lane}1`);
    }
    layout[3]!.next = ["r5"];
    expect(() => validateFloorLayout(layout)).toThrow(/splits into 4 lanes/);
  });

  test("a branch of 1 room that merges into the lane below", () => {
    const layout = lateEvent();
    layout.push({ id: "p1", type: "combat", next: ["p2"], hidden: false }, { id: "p2", type: "combat", next: ["r5"], hidden: false });
    layout[1]!.next.push("p1");
    layout.push({ id: "x1", type: "combat", next: ["p2"], hidden: false });
    layout[2]!.next.push("x1");
    expect(() => validateFloorLayout(layout)).toThrow(/lane holds 1 rooms/);
  });

  test("5 lanes side by side", () => {
    const layout = line(["combat", "event", "combat", "combat", "combat", "rest", "event", "combat", "combat", "combat", "combat", "boss"]);
    for (let lane = 0; lane < 4; lane++) {
      const a = `a${lane}`;
      const b = `b${lane}`;
      layout.push({ id: a, type: "combat", next: [b], hidden: false }, { id: b, type: "combat", next: ["r5"], hidden: false });
      layout[1]!.next.push(a);
    }
    layout[1]!.next = ["r3", ...layout[1]!.next.filter((id) => id !== "r3")];
    layout[2]!.next = ["r4"];
    expect(() => validateFloorLayout(layout)).toThrow(/lanes run side by side/);
  });
});

describe("validateFloorLayout with a temple entry", () => {
  const withTemple = (layout: LayoutRoom[]): LayoutRoom[] => [{ id: "temple", type: "temple", next: [layout[0]!.id], hidden: false }, ...layout];

  test("accepts a temple entry in front of the visible combat entrance across many floors", () => {
    for (const depth of DEPTHS) for (const layout of layoutsAt(depth).slice(0, 30)) expect(() => validateFloorLayout(withTemple(layout))).not.toThrow();
  });

  test("rejects a temple that is hidden, forks, or leads anywhere but a visible combat room", () => {
    const layout = generateFloorLayout(new Rng(5), 5);
    const hidden = withTemple(layout);
    hidden[0]!.hidden = true;
    expect(() => validateFloorLayout(hidden)).toThrow(/temple/);
    const fork = withTemple(layout);
    fork[0]!.next = [layout[0]!.id, layout[1]!.id];
    expect(() => validateFloorLayout(fork)).toThrow(/temple/);
    const toEvent = withTemple(layout);
    toEvent[1]!.type = "event";
    expect(() => validateFloorLayout(toEvent)).toThrow(/temple/);
  });
});
