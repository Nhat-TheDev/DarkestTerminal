import { describe, test, expect } from "bun:test";
import { parseArgs, resolveRoomId } from "../tools/dev-save-dump/args";
import type { Floor } from "../src/types";

describe("dev-save-dump parseArgs", () => {
  test("parses --key value pairs", () => {
    expect(parseArgs(["--level", "50", "--room", "boss"])).toEqual({ level: "50", room: "boss" });
  });

  test("ignores stray tokens that aren't --flags", () => {
    expect(parseArgs(["noise", "--level", "50"])).toEqual({ level: "50" });
  });

  test("throws when a flag is missing its value", () => {
    expect(() => parseArgs(["--level"])).toThrow();
    expect(() => parseArgs(["--level", "--room", "boss"])).toThrow();
  });
});

function floor(): Floor {
  return {
    depth: 3,
    entryRoomId: "r1",
    rooms: [
      { id: "r1", name: "Entry", type: "combat", connectedRoomIds: ["r2"], monsterIds: [], cleared: false },
      { id: "r2", name: "Rest Stop", type: "rest", connectedRoomIds: ["r3"], monsterIds: [], cleared: false },
      { id: "r3", name: "Throne", type: "boss", connectedRoomIds: [], monsterIds: [], cleared: false },
    ],
  };
}

describe("dev-save-dump resolveRoomId", () => {
  test('"entry" resolves to the floor\'s entryRoomId', () => {
    expect(resolveRoomId(floor(), "entry")).toBe("r1");
  });

  test("an exact room id resolves to itself", () => {
    expect(resolveRoomId(floor(), "r2")).toBe("r2");
  });

  test("a room type resolves to the first room of that type", () => {
    expect(resolveRoomId(floor(), "boss")).toBe("r3");
    expect(resolveRoomId(floor(), "rest")).toBe("r2");
  });

  test("a room type absent from this floor throws, naming the floor's actual rooms", () => {
    expect(() => resolveRoomId(floor(), "event")).toThrow(/No "event" room on floor 3/);
  });

  test("an unrecognized identifier throws", () => {
    expect(() => resolveRoomId(floor(), "not-a-room")).toThrow(/Unknown --room/);
  });
});
