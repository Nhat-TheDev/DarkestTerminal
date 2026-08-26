import { describe, test, expect } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { getSkill } from "../src/data/classes";
import type { Character } from "../src/types";
import { getActorByRef, startCombat } from "../src/engine/combat";
import { spawnMonster } from "../src/data/monsters";
import { getRoom } from "../src/engine/dungeon";

describe("headless UI smoke test", () => {
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
        mockInput.pressKey("RETURN");
        await renderOnce();
        continue;
      }

      let key = "1";
      if (ui.kind === "room") {
        const choices = app.debugGame.connectedRoomChoices();
        const idx = choices.findIndex((r) => !r.cleared);
        key = String((idx >= 0 ? idx : 0) + 1);
      } else if (ui.kind === "pickAction") {
        key = "1";
      } else if (ui.kind === "pickSkill") {
        const actor = getActorByRef(ui.actorRef, app.debugGame.ctx) as Character;
        const skills = actor.unlockedSkillIds.map(getSkill);
        const attackIdx = skills.findIndex((s) => s.target === "singleEnemy" && actor.mp >= s.mpCost);
        key = String((attackIdx >= 0 ? attackIdx : 0) + 1);
      } else if (ui.kind === "pickTarget") {
        key = "1";
      } else {
        key = "1";
      }

      mockInput.pressKey(key);
      await renderOnce();
    }

    const outcome = app.debugGame.state.gameOver;
    expect(outcome).not.toBe("victory");
    if (outcome === null) {
      expect(app.debugGame.state.floor.depth).toBeGreaterThan(startingDepth);
    } else {
      expect(outcome).toBe("defeat");
    }

    const finalFrame = captureCharFrame();
    expect(finalFrame.length).toBeGreaterThan(0);
  }, 20000);

  test("a boss kill's pending artifact decision surfaces before the floor advances, even if the new floor's entry room ambushes the party", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 100, height: 40 });
    const game = new Game(7);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.type = "boss";
    const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });
    boss.hp = 1;
    game.ctx.monsters.push(boss);
    room.monsterIds = [boss.id];
    room.cleared = false;
    game.state.combat = startCombat(room.id, [boss.id], game.ctx, true);
    const app = new App(renderer, game);
    await renderOnce();

    let guard = 0;
    while (app.debugUiState.kind !== "artifactDecision" && guard < 40) {
      guard++;
      if (app.debugUiState.kind === "roomReward") mockInput.pressKey("RETURN");
      else mockInput.pressKey("1");
      await renderOnce();
    }
    expect(app.debugUiState.kind).toBe("artifactDecision");
    expect(game.state.floor.depth).toBe(1); // must not have advanced yet — the decision comes first

    mockInput.pressKey("1"); // Equip
    await renderOnce();
    mockInput.pressKey("1"); // pick character 1
    await renderOnce();

    expect(game.state.pendingArtifactDecision).toBeNull();
    expect(app.debugUiState.kind).toBe("campPrompt"); // Camp offer comes after the decision, before the floor advances
    expect(game.state.floor.depth).toBe(1);

    mockInput.pressKey("2"); // skip Camp
    await renderOnce();

    expect(game.state.floor.depth).toBe(2); // now it advances
  }, 20000);

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
