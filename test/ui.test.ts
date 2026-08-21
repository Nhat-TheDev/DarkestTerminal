import { describe, test, expect } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { getSkill } from "../src/data/classes";
import type { Character } from "../src/types";
import { getActorByRef } from "../src/engine/combat";

describe("headless UI smoke test", () => {
  // docs/gameplay-decisions.md §6.9/6.10: floor depth is uncapped (clearing the
  // guard room always advances to the next floor instead of ending the game),
  // so a bounded scripted run can no longer expect to reach "gameover" at
  // all — early floors are comfortably survivable. Assert progression +
  // no-crash + "victory" being unreachable instead of "run finishes".
  test("boots and plays a scripted run via real keypresses across multiple floors without crashing", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 100, height: 40 });
    const app = new App(renderer, new Game(7));
    await renderOnce();

    const firstFrame = captureCharFrame();
    expect(firstFrame).toContain("DARKEST-TERMINAL");
    const startingDepth = app.debugGame.state.floor.depth;

    let guard = 0;
    while (app.debugUiState.kind !== "gameover" && guard < 800) {
      guard++;
      const ui = app.debugUiState;

      if (ui.kind === "roomReward") {
        mockInput.pressKey("RETURN"); // "Tiếp tục" is Enter-only now — skip viewing detail in the smoke test
        await renderOnce();
        continue;
      }

      let key = "1";
      if (ui.kind === "room") {
        const choices = app.debugGame.connectedRoomChoices();
        const idx = choices.findIndex((r) => !r.cleared);
        key = String((idx >= 0 ? idx : 0) + 1);
      } else if (ui.kind === "pickAction") {
        key = "1"; // always Fight
      } else if (ui.kind === "pickSkill") {
        const actor = getActorByRef(ui.actorRef, app.debugGame.ctx) as Character;
        const skills = actor.unlockedSkillIds.map(getSkill);
        const attackIdx = skills.findIndex((s) => s.target === "singleEnemy" && actor.mp >= s.mpCost);
        key = String((attackIdx >= 0 ? attackIdx : 0) + 1);
      } else if (ui.kind === "pickTarget") {
        key = "1";
      } else {
        key = "1"; // roundResolved / combatOver: any key advances
      }

      mockInput.pressKey(key);
      await renderOnce();
    }

    const outcome = app.debugGame.state.gameOver;
    expect(outcome).not.toBe("victory"); // boss-clear always advances the floor now, never ends the game
    if (outcome === null) {
      // didn't die within the guard — expected given uncapped floor depth; confirm real progression happened instead.
      expect(app.debugGame.state.floor.depth).toBeGreaterThan(startingDepth);
    } else {
      expect(outcome).toBe("defeat");
    }

    const finalFrame = captureCharFrame();
    expect(finalFrame.length).toBeGreaterThan(0);
  });

  test("q opens the save menu instead of quitting", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 80, height: 24 });
    const originalExit = process.exit;
    let exitCalled = false;
    process.exit = ((code?: number) => {
      exitCalled = true;
      throw new Error("__exit__");
    }) as typeof process.exit;
    try {
      const app = new App(renderer, new Game(1));
      await renderOnce();
      mockInput.pressKey("q");
      expect(app.debugUiState.kind).toBe("saveMenu");
      expect(exitCalled).toBe(false);
    } finally {
      process.exit = originalExit;
    }
  });

  test("ctrl+c quits the process", async () => {
    // Smoke-check the key is wired without actually exiting the test process.
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 80, height: 24 });
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("__exit__");
    }) as typeof process.exit;
    try {
      new App(renderer, new Game(1));
      await renderOnce();
      try {
        mockInput.pressCtrlC();
      } catch (e) {
        if (!(e instanceof Error) || e.message !== "__exit__") throw e;
      }
      expect(exitCode).toBe(0);
    } finally {
      process.exit = originalExit;
    }
  });
});
