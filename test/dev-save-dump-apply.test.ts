import { describe, test, expect } from "bun:test";
import { Game } from "../src/engine/game";
import { applyDump } from "../tools/dev-save-dump/applyDump";
import { BALANCE } from "../src/data/balanceConfig";
import { ENDING_CHECKPOINT_FLOOR_DEPTH, FOUNDER_FLOOR_DEPTH } from "../src/data/endings";

const PARTY = ["vanguard", "mage", "rogue", "acolyte"];

describe("dev-save-dump applyDump", () => {
  test("sets the requested level, refilling hp/mp to the new max", () => {
    const game = new Game(1, PARTY);
    applyDump(game, { level: 50, floorDepth: 50, roomArg: "entry" });
    for (const c of game.state.party) {
      expect(c.level).toBe(50);
      expect(c.hp).toBe(c.maxHp);
      expect(c.mp).toBe(c.maxMp);
    }
  });

  test("jumps straight to the requested floor depth", () => {
    const game = new Game(2, PARTY);
    applyDump(game, { level: 1, floorDepth: 77, roomArg: "entry" });
    expect(game.state.floor.depth).toBe(77);
  });

  // Regression: the Game constructor's own entry-room ambush check already ran against floor 1's
  // monsters before applyDump replaces the floor — a rest/event room on the new floor must not be
  // left holding that stale combat state (it used to reference monster ids that no longer exist).
  test("landing in a non-combat room leaves no stale combat state from the original floor-1 entry", () => {
    const game = new Game(3, PARTY);
    const room = applyDump(game, { level: 10, floorDepth: 20, roomArg: "rest" });
    expect(room.type).toBe("rest");
    expect(game.state.combat).toBeNull();
  });

  test("landing in an uncleared combat/boss room with living monsters starts a fresh, consistent combat", () => {
    const game = new Game(4, PARTY);
    const room = applyDump(game, { level: 10, floorDepth: 20, roomArg: "boss" });
    expect(room.type).toBe("boss");
    expect(game.state.combat).not.toBeNull();
    expect(game.state.combat!.roomId).toBe(room.id);
    const monsterIds = new Set(game.ctx.monsters.map((m) => m.id));
    for (const combatant of game.state.combat!.combatants) {
      if (combatant.ref.kind === "monster") expect(monsterIds.has(combatant.ref.id)).toBe(true);
    }
  });

  test("out-of-range level/floor are clamped instead of producing an invalid state", () => {
    const game = new Game(5, PARTY);
    applyDump(game, { level: 999, floorDepth: -5, roomArg: "entry" });
    expect(game.state.party[0]!.level).toBe(100);
    expect(game.state.floor.depth).toBeGreaterThanOrEqual(1);
  });

  test("landing in a rest room arms Camp Reflection the same way a real arrival there would", () => {
    const game = new Game(6, PARTY);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier1Threshold;
    const room = applyDump(game, { level: 10, floorDepth: 20, roomArg: "rest" });
    expect(room.type).toBe("rest");
    expect(game.state.pendingCampReflectionTier).toBe(1);
  });

  test("landing in an event room resolves a real event and drains satiety, instead of doing nothing", () => {
    const game = new Game(7, PARTY);
    const satietyBefore = game.state.satiety;
    const room = applyDump(game, { level: 10, floorDepth: 20, roomArg: "event", forceEventId: "merchant" });
    expect(room.type).toBe("event");
    expect(room.rolledEventId).toBe("merchant");
    expect(game.state.activeEvent?.eventId).toBe("merchant");
    expect(game.state.satiety).toBeLessThan(satietyBefore);
  });

  test("landing on the ending-checkpoint floor resolves the requested room normally — the checkpoint only fires after that floor's own boss is defeated, not on arrival", () => {
    const game = new Game(8, PARTY);
    const room = applyDump(game, { level: 50, floorDepth: ENDING_CHECKPOINT_FLOOR_DEPTH, roomArg: "boss" });
    expect(game.state.pendingEndingCheckpoint).toBe(false);
    expect(room.type).toBe("boss");
    expect(game.state.combat).not.toBeNull();
  });

  test("reaching the founder floor after continuing past the checkpoint arms the founder dialogue", () => {
    const game = new Game(9, PARTY);
    game.state.continuedPastCheckpoint = true;
    applyDump(game, { level: 100, floorDepth: FOUNDER_FLOOR_DEPTH, roomArg: "boss" });
    expect(game.state.pendingFounderDialogue).toBe(true);
    expect(game.state.combat).toBeNull();
  });

  test("reaching the founder floor without having continued past the checkpoint resolves the room normally", () => {
    const game = new Game(10, PARTY);
    const room = applyDump(game, { level: 100, floorDepth: FOUNDER_FLOOR_DEPTH, roomArg: "boss" });
    expect(game.state.pendingFounderDialogue).toBe(false);
    expect(room.type).toBe("boss");
    expect(game.state.combat).not.toBeNull();
  });
});
