import { describe, expect, test } from "bun:test";
import { Game } from "../src/engine/game";
import { Rng } from "../src/engine/rng";
import { migrateGameState } from "../src/engine/migration";
import { FLOOR_MILESTONE_INTERVAL, FLOOR_MILESTONE_OMENS, pickFloorMilestoneOmen, validateFloorMilestones } from "../src/data/floorMilestones";
import type { CombatState, Floor } from "../src/types";
import * as floorMilestoneScreen from "../src/ui/screens/floorMilestone";
import type { ScreenContext } from "../src/ui/screens/context";

function setUpBossVictory(depth: number, roomType: "boss" | "combat", game: Game = new Game(1)): Game {
  const floor: Floor = {
    depth,
    rooms: [{ id: "r1", name: "Test Room", type: roomType, connectedRoomIds: [], monsterIds: [], cleared: false }],
    entryRoomId: "r1",
  };
  (game.state as { floor: Floor }).floor = floor;
  const combat: CombatState = {
    roomId: "r1",
    combatants: [],
    roundNumber: 1,
    phase: "over",
    queuedActions: [],
    turnQueue: [],
    activeTurnIndex: 0,
    isBossFight: roomType === "boss",
    log: [],
    outcome: "victory",
  };
  (game.state as { combat: CombatState | null }).combat = combat;
  return game;
}

const LAST_MAX_FLOOR = Math.max(...FLOOR_MILESTONE_OMENS.map((o) => o.maxFloor));

describe("floor-milestone message", () => {
  test("clearFinishedCombat sets pendingFloorMilestoneOmenId on a boss-room victory at a floor-10-multiple", () => {
    const game = setUpBossVictory(20, "boss");
    game.clearFinishedCombat();
    const id = game.state.pendingFloorMilestoneOmenId;
    expect(FLOOR_MILESTONE_OMENS.map((o) => o.id)).toContain(id!);
    expect(game.state.shownFloorMilestoneIds).toEqual([id!]);
  });

  test("a run's milestones show each omen once before any repeats", () => {
    const game = new Game(7);
    for (let depth = FLOOR_MILESTONE_INTERVAL; depth <= LAST_MAX_FLOOR; depth += FLOOR_MILESTONE_INTERVAL) {
      setUpBossVictory(depth, "boss", game);
      game.clearFinishedCombat();
      game.dismissFloorMilestoneMessage();
    }
    expect(game.state.shownFloorMilestoneIds.length).toBe(FLOOR_MILESTONE_OMENS.length);
    expect(new Set(game.state.shownFloorMilestoneIds).size).toBe(FLOOR_MILESTONE_OMENS.length);
  });

  test("does NOT set the message on floor 19's boss room (not a multiple of 10)", () => {
    const game = setUpBossVictory(19, "boss");
    game.clearFinishedCombat();
    expect(game.state.pendingFloorMilestoneOmenId).toBeFalsy();
  });

  test("does NOT set the message on a non-boss combat room victory at floor 20", () => {
    const game = setUpBossVictory(20, "combat");
    game.clearFinishedCombat();
    expect(game.state.pendingFloorMilestoneOmenId).toBeFalsy();
  });

  test("dismissFloorMilestoneMessage clears it back to null", () => {
    const game = setUpBossVictory(20, "boss");
    game.clearFinishedCombat();
    expect(game.state.pendingFloorMilestoneOmenId).toBeDefined();
    game.dismissFloorMilestoneMessage();
    expect(game.state.pendingFloorMilestoneOmenId).toBeNull();
  });
});

describe("pickFloorMilestoneOmen", () => {
  test("any seed shows every omen once between floor 10 and the last maxFloor, never later than its own maxFloor", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = new Rng(seed);
      const shown: string[] = [];
      for (let depth = FLOOR_MILESTONE_INTERVAL; depth <= LAST_MAX_FLOOR; depth += FLOOR_MILESTONE_INTERVAL) {
        const omen = pickFloorMilestoneOmen(depth, shown, rng);
        expect(omen.maxFloor).toBeGreaterThanOrEqual(depth);
        shown.push(omen.id);
      }
      expect(new Set(shown).size).toBe(FLOOR_MILESTONE_OMENS.length);
    }
  });

  test("the first milestone only ever draws from the shallowest band", () => {
    const lowest = Math.min(...FLOOR_MILESTONE_OMENS.map((o) => o.maxFloor));
    for (let seed = 1; seed <= 200; seed++) {
      expect(pickFloorMilestoneOmen(FLOOR_MILESTONE_INTERVAL, [], new Rng(seed)).maxFloor).toBe(lowest);
    }
  });

  test("past the last maxFloor it still picks an omen, and never the one shown last", () => {
    const rng = new Rng(3);
    const shown = FLOOR_MILESTONE_OMENS.map((o) => o.id);
    for (let i = 0; i < 100; i++) {
      const omen = pickFloorMilestoneOmen(LAST_MAX_FLOOR + FLOOR_MILESTONE_INTERVAL * (i + 1), shown, rng);
      expect(omen.id).not.toBe(shown[shown.length - 1]);
      shown.push(omen.id);
    }
  });
});

describe("validateFloorMilestones", () => {
  const omen = (id: string, maxFloor: number) => ({ id, maxFloor, text: "Something." });

  test("accepts data where every omen can be shown by its maxFloor", () => {
    expect(() => validateFloorMilestones({ interval: 10, omens: [omen("a", 10), omen("b", 20), omen("c", 30)] })).not.toThrow();
  });

  test("refuses more omens due by a floor than milestone floors up to it", () => {
    expect(() => validateFloorMilestones({ interval: 10, omens: [omen("a", 10), omen("b", 10)] })).toThrow(/due by floor 10/);
  });

  test("refuses a maxFloor that is not a multiple of the interval, a duplicate id and empty text", () => {
    expect(() => validateFloorMilestones({ interval: 10, omens: [omen("a", 15)] })).toThrow(/multiple of 10/);
    expect(() => validateFloorMilestones({ interval: 10, omens: [omen("a", 20), omen("a", 30)] })).toThrow(/appears twice/);
    expect(() => validateFloorMilestones({ interval: 10, omens: [{ id: "a", maxFloor: 10, text: " " }] })).toThrow(/no text/);
  });
});

describe("migration default for shownFloorMilestoneIds", () => {
  test("defaults to an empty list on a save from before the omen bands", () => {
    const legacy = { party: [], inventory: {}, floor: { depth: 1, rooms: [], entryRoomId: "r1" }, currentRoomId: "r1" } as unknown as Parameters<typeof migrateGameState>[0];
    expect(migrateGameState(legacy).shownFloorMilestoneIds).toEqual([]);
  });
});

describe("floorMilestone screen module", () => {
  test("renderMain shows the pending message", () => {
    const game = setUpBossVictory(20, "boss");
    game.clearFinishedCombat();
    const rendered = floorMilestoneScreen.renderMain(game, { kind: "floorMilestone" });
    expect(rendered).toBe(FLOOR_MILESTONE_OMENS.find((o) => o.id === game.state.pendingFloorMilestoneOmenId)!.text);
    expect(rendered.length).toBeGreaterThan(0);
  });

  test("renderMain shows nothing for an omen id that is no longer in the data file", () => {
    const game = setUpBossVictory(20, "boss");
    game.state.pendingFloorMilestoneOmenId = "removed-omen";
    expect(floorMilestoneScreen.renderMain(game, { kind: "floorMilestone" })).toBe("");
  });

  test("renderFooter shows the Enter-to-continue hint", () => {
    expect(floorMilestoneScreen.renderFooter({ kind: "floorMilestone" })).toBe("[Enter] Continue");
  });

  test("handleKey on Enter dismisses the message and calls syncUiToGameState (via proceedAfterVictory)", () => {
    const game = setUpBossVictory(20, "boss");
    game.clearFinishedCombat();
    let synced = false;
    const ctx: ScreenContext = {
      game,
      setUi: () => {},
      reportUnusable: () => {},
      logInfo: () => {},
      syncUiToGameState: () => {
        synced = true;
      },
      pushToast: () => {},
      quit: () => {},
      getPendingFloorAdvance: () => false,
      setPendingFloorAdvance: () => {},
      getPendingCampOffer: () => false,
      setPendingCampOffer: () => {},
      getListPage: () => 0,
      setListPage: () => {},
    };
    floorMilestoneScreen.handleKey(ctx, { kind: "floorMilestone" }, { name: "return" } as never, null);
    expect(game.state.pendingFloorMilestoneOmenId).toBeNull();
    expect(synced).toBe(true);
  });

  test("handleKey ignores any key other than Enter", () => {
    const game = setUpBossVictory(20, "boss");
    game.clearFinishedCombat();
    const omenId = game.state.pendingFloorMilestoneOmenId;
    const ctx: ScreenContext = {
      game,
      setUi: () => {},
      reportUnusable: () => {},
      logInfo: () => {},
      syncUiToGameState: () => {},
      pushToast: () => {},
      quit: () => {},
      getPendingFloorAdvance: () => false,
      setPendingFloorAdvance: () => {},
      getPendingCampOffer: () => false,
      setPendingCampOffer: () => {},
      getListPage: () => 0,
      setListPage: () => {},
    };
    floorMilestoneScreen.handleKey(ctx, { kind: "floorMilestone" }, { name: "a" } as never, null);
    expect(game.state.pendingFloorMilestoneOmenId).toBe(omenId!);
  });
});
