import { describe, expect, test } from "bun:test";
import { Game } from "../src/engine/game";
import type { CombatState, Floor } from "../src/types";
import * as floorMilestoneScreen from "../src/ui/screens/floorMilestone";
import type { ScreenContext } from "../src/ui/screens/context";

function setUpBossVictory(depth: number, roomType: "boss" | "combat"): Game {
  const game = new Game(1);
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

const FLOOR_MILESTONE_POOL = [
  "Something changes in the dark beyond this floor.",
  "The air grows heavier past this point.",
  "The walls remember what comes next.",
  "Further down, the dark holds its breath.",
  "The dungeon does not forgive what follows.",
];

describe("floor-milestone message", () => {
  test("clearFinishedCombat sets pendingFloorMilestoneMessage on a boss-room victory at a floor-10-multiple", () => {
    const game = setUpBossVictory(20, "boss");
    game.clearFinishedCombat();
    expect(game.state.pendingFloorMilestoneMessage).toBeDefined();
    expect(FLOOR_MILESTONE_POOL).toContain(game.state.pendingFloorMilestoneMessage!);
  });

  test("does NOT set the message on floor 19's boss room (not a multiple of 10)", () => {
    const game = setUpBossVictory(19, "boss");
    game.clearFinishedCombat();
    expect(game.state.pendingFloorMilestoneMessage).toBeFalsy();
  });

  test("does NOT set the message on a non-boss combat room victory at floor 20", () => {
    const game = setUpBossVictory(20, "combat");
    game.clearFinishedCombat();
    expect(game.state.pendingFloorMilestoneMessage).toBeFalsy();
  });

  test("dismissFloorMilestoneMessage clears it back to null", () => {
    const game = setUpBossVictory(20, "boss");
    game.clearFinishedCombat();
    expect(game.state.pendingFloorMilestoneMessage).toBeDefined();
    game.dismissFloorMilestoneMessage();
    expect(game.state.pendingFloorMilestoneMessage).toBeNull();
  });
});

describe("floorMilestone screen module", () => {
  test("renderMain shows the pending message", () => {
    const game = setUpBossVictory(20, "boss");
    game.clearFinishedCombat();
    const rendered = floorMilestoneScreen.renderMain(game, { kind: "floorMilestone" });
    expect(rendered).toBe(game.state.pendingFloorMilestoneMessage!);
    expect(rendered.length).toBeGreaterThan(0);
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
    expect(game.state.pendingFloorMilestoneMessage).toBeNull();
    expect(synced).toBe(true);
  });

  test("handleKey ignores any key other than Enter", () => {
    const game = setUpBossVictory(20, "boss");
    game.clearFinishedCombat();
    const message = game.state.pendingFloorMilestoneMessage;
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
    expect(game.state.pendingFloorMilestoneMessage).toBe(message!);
  });
});
