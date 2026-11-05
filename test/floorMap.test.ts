import { describe, test, expect } from "bun:test";
import { Game } from "../src/engine/game";
import { CLASSES } from "../src/data/classes";
import { BALANCE } from "../src/data/balanceConfig";
import { pathChoiceLine } from "../src/ui/screens/room";
import type { Room } from "../src/types";

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
