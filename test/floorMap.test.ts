import { describe, test, expect } from "bun:test";
import { Game } from "../src/engine/game";
import { CLASSES } from "../src/data/classes";
import { BALANCE } from "../src/data/balanceConfig";
import { pathChoiceLine } from "../src/ui/screens/room";
import type { Floor, Id, Room, RoomType } from "../src/types";
import { renderFloorMap } from "../src/ui/floorMap";
import { createFloor } from "../src/data/floor";
import { FloorGraph } from "../src/engine/floorGraph";
import { Rng } from "../src/engine/rng";
import { withTempleChance } from "./setup";
import { BATTLEFIELD_CONTENT_WIDTH, UNIT_BLOCK_HEIGHT } from "../src/ui/layout";

const PARTY = CLASSES.slice(0, BALANCE.party.size).map((c) => c.id);

describe("unknown rooms", () => {
  test("the Paths list names an unknown room without its name or type", () => {
    const room: Room = { id: "r2", name: "Ossuary", type: "rest", connectedRoomIds: [], monsterIds: [], cleared: false, hidden: true };
    expect(pathChoiceLine(1, room)).toBe("  [1] ??? (unknown)");
    expect(pathChoiceLine(1, { ...room, hidden: undefined })).toBe("  [1] Ossuary (rest)");
  });

  test("entering an unknown room reveals it for the rest of the floor", () => {
    const game = new Game(1, PARTY, undefined, undefined, true);
    game.answerGatekeeper("paid");
    game.enterDungeon();
    game.state.combat = null;
    const next = game.connectedRoomChoices()[0]!;
    next.hidden = true;
    game.move(next.id);
    expect(game.state.currentRoomId).toBe(next.id);
    expect(next.hidden).toBeUndefined();
  });
});

const EXAMPLE_ROOMS: [Id, RoomType, Id[], boolean?][] = [
  ["e", "combat", ["cur"]],
  ["cur", "combat", ["a1", "d1", "f1"]],
  ["a1", "combat", ["b1", "c1"]],
  ["b1", "rest", ["b2"]],
  ["b2", "combat", ["a2"]],
  ["c1", "event", ["c2"]],
  ["c2", "combat", ["a2"]],
  ["a2", "combat", ["g1", "h1"]],
  ["d1", "event", ["d2"]],
  ["d2", "combat", ["g1", "h1"]],
  ["f1", "combat", ["f2"]],
  ["f2", "combat", ["f3"], true],
  ["f3", "combat", ["g1", "h1"]],
  ["g1", "event", ["g2"]],
  ["g2", "combat", ["i1"]],
  ["h1", "combat", ["h2"]],
  ["h2", "event", ["h3"]],
  ["h3", "rest", ["i1"], true],
  ["i1", "combat", ["i2"]],
  ["i2", "rest", ["i3"]],
  ["i3", "combat", ["i4"]],
  ["i4", "event", ["guard"]],
  ["guard", "boss", []],
];

function exampleFloor(): Floor {
  const rooms: Room[] = EXAMPLE_ROOMS.map(([id, type, next, hidden]) => ({ id, name: id, type, connectedRoomIds: next, monsterIds: [], cleared: false, ...(hidden ? { hidden } : {}) }));
  return { depth: 3, rooms, entryRoomId: "e" };
}

const text = (rows: { text: string }[][]) => rows.map((row) => row.map((c) => c.text).join("").trimEnd());

describe("the floor map", () => {
  test("draws the spec's example floor exactly", () => {
    const { rows } = renderFloorMap(exampleFloor(), ["e", "cur"], "cur");
    expect(text(rows)).toEqual([
      "Floor 3",
      "",
      "[ · ]━━[ ■ ]┳━[1 ·]┳━[ △ ]━━[ · ]┳━[ · ]┳━[ ○ ]━━[ · ]━━━━━━━┳━[ · ]━━[ △ ]━━[ · ]━━[ ○ ]━━[ ☠ ]",
      "            ┃      ┃             ┃      ┃                    ┃",
      "            ┃      ┗━[ ○ ]━━[ · ]┛      ┣━[ · ]━━[ ○ ]━━[ ? ]┛",
      "            ┃                           ┃",
      "            ┣━[2 ○]━━[ · ]━━━━━━━━━━━━━━┫",
      "            ┃                           ┃",
      "            ┗━[3 ·]━━[ ? ]━━[ · ]━━━━━━━┛",
      "",
      "■ you    · fight    ○ event    △ rest    † temple    ? unknown    ☠ guard",
    ]);
  });

  test("a temple entry draws its own glyph in front of the entrance", () => {
    const stage = (id: Id, type: RoomType, next: Id[]): Room => ({ id, name: id, type, connectedRoomIds: next, monsterIds: [], cleared: false });
    const floor: Floor = { depth: 1, entryRoomId: "temple", rooms: [stage("temple", "temple", ["r1"]), stage("r1", "combat", ["r2"]), stage("r2", "boss", [])] };
    expect(text(renderFloorMap(floor, ["temple"], "temple").rows)).toEqual([
      "Floor 1",
      "",
      "[ ■ ]━━[1 ·]━━[ ☠ ]",
      "",
      "■ you    · fight    ○ event    △ rest    † temple    ? unknown    ☠ guard",
    ]);
  });

  test("rooms in one column share an x position", () => {
    const floor = createFloor(new Rng(11), 40).floor;
    const graph = new FloorGraph(floor.rooms.map((r) => ({ id: r.id, type: r.type, next: r.connectedRoomIds })), floor.entryRoomId);
    const lines = text(renderFloorMap(floor, [floor.entryRoomId], floor.entryRoomId).rows).slice(2);
    const cellStarts = new Set<number>();
    for (const line of lines) for (const m of line.matchAll(/\[/g)) cellStarts.add(m.index!);
    const columns = new Set(graph.columns().values());
    expect([...cellStarts].every((x) => x % 7 === 0)).toBe(true);
    expect(cellStarts.size).toBe(columns.size);
  });

  test("the widest generated floor fits in the Battlefield at the smallest terminal", () => {
    for (let seed = 1; seed < 200; seed++) {
      const { floor } = withTempleChance(1, () => createFloor(new Rng(seed), 1 + (seed % 120)));
      const { width, rows } = renderFloorMap(floor, [floor.entryRoomId], floor.entryRoomId);
      expect(width).toBeLessThanOrEqual(BATTLEFIELD_CONTENT_WIDTH);
      expect(rows.length).toBeLessThanOrEqual(UNIT_BLOCK_HEIGHT);
    }
  });

  test("a floor from the old stage generator still draws", () => {
    const stage = (ids: Id[], next: Id[], type: RoomType = "combat"): Room[] => ids.map((id) => ({ id, name: id, type, connectedRoomIds: next, monsterIds: [], cleared: false }));
    const floor: Floor = {
      depth: 2,
      entryRoomId: "r1",
      rooms: [...stage(["r1"], ["r2"]), ...stage(["r2"], ["r3", "r4"]), ...stage(["r3"], ["r5"]), ...stage(["r4"], ["r5"], "event"), ...stage(["r5"], ["r6"], "rest"), ...stage(["r6"], [], "boss")],
    };
    expect(text(renderFloorMap(floor, ["r1", "r2"], "r2").rows).slice(0, 5)).toEqual([
      "Floor 2",
      "",
      "[ · ]━━[ ■ ]┳━[1 ·]┳━[ △ ]━━[ ☠ ]",
      "            ┃      ┃",
      "            ┗━[2 ○]┛",
    ]);
  });

  test("an unknown room shows its type once entered", () => {
    const floor = exampleFloor();
    const f2 = floor.rooms.find((r) => r.id === "f2")!;
    delete f2.hidden;
    const lines = text(renderFloorMap(floor, ["e", "cur", "f1", "f2"], "f2").rows);
    expect(lines.at(-3)).toBe("            ┗━[ · ]━━[ ■ ]━━[1 ·]━━━━━━━┛");
    expect(lines.some((line) => /rooms?\b/.test(line))).toBe(false);
  });
});

describe("a branch that merges into the lane below", () => {
  const ROOMS: [Id, RoomType, Id[]][] = [
    ["e", "combat", ["u"]],
    ["u", "combat", ["a", "p", "m"]],
    ["a", "combat", ["b", "s1"]],
    ["b", "combat", ["c"]],
    ["c", "combat", ["d"]],
    ["d", "combat", ["j"]],
    ["s1", "event", ["s2"]],
    ["s2", "combat", ["x"]],
    ["p", "combat", ["q"]],
    ["q", "rest", ["x"]],
    ["x", "combat", ["y"]],
    ["y", "combat", ["j"]],
    ["m", "event", ["n"]],
    ["n", "combat", ["o"]],
    ["o", "combat", ["w"]],
    ["w", "combat", ["j"]],
    ["j", "combat", ["guard"]],
    ["guard", "boss", []],
  ];

  test("draws the branch between the two lanes and turns it down into the lower one", () => {
    const rooms: Room[] = ROOMS.map(([id, type, next]) => ({ id, name: id, type, connectedRoomIds: next, monsterIds: [], cleared: false }));
    const { rows } = renderFloorMap({ depth: 4, rooms, entryRoomId: "e" }, ["e", "u"], "u");
    expect(text(rows).slice(0, 9)).toEqual([
      "Floor 4",
      "",
      "[ · ]━━[ ■ ]┳━[1 ·]┳━[ · ]━━[ · ]━━[ · ]━━━━━━━┳━[ · ]━━[ ☠ ]",
      "            ┃      ┃                           ┃",
      "            ┃      ┗━[ ○ ]━━[ · ]┓             ┃",
      "            ┃                    ┃             ┃",
      "            ┣━[2 ·]━━[ △ ]━━━━━━━┻━[ · ]━━[ · ]┫",
      "            ┃                                  ┃",
      "            ┗━[3 ○]━━[ · ]━━[ · ]━━[ · ]━━━━━━━┛",
    ]);
  });

  test("generated maps never cross two lines", () => {
    for (let seed = 1; seed < 300; seed++) {
      const { floor } = createFloor(new Rng(seed), 1 + (seed % 120));
      expect(text(renderFloorMap(floor, [floor.entryRoomId], floor.entryRoomId).rows).join("\n")).not.toContain("╋");
    }
  });
});
