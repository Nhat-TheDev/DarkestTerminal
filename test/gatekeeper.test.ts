import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { Game } from "../src/engine/game";
import { App } from "../src/ui/app";
import * as characterInfoScreen from "../src/ui/screens/characterInfo";
import { getRoom } from "../src/engine/dungeon";
import { countBlessedRoom } from "../src/engine/events/gatekeeper";
import { rollEvent } from "../src/data/events";
import { LORE_EXPOSURE_EVENT_IDS } from "../src/data/loreExposure";
import { BALANCE } from "../src/data/balanceConfig";
import { getStatusEffect } from "../src/data/statusEffects";
import { t } from "../src/data/strings";
import { Rng } from "../src/engine/rng";
import { saveRun, loadSave, gameFromSave } from "../src/engine/save";
import { CLASSES } from "../src/data/classes";
import type { Room, RoomType } from "../src/types";

const BLESSED = BALANCE.gatekeeper.blessingStatusId;
const PARTY = CLASSES.slice(0, BALANCE.party.size).map((c) => c.id);
const newRun = (seed = 7) => new Game(seed, PARTY, undefined, undefined, true);
const room = (id: string, type: RoomType): Room => ({ id, name: id, type, connectedRoomIds: [], monsterIds: [], cleared: false });
const isBlessed = (game: Game) => game.state.party.every((c) => c.activeStatusEffects.some((s) => s.statusEffectId === BLESSED));

describe("the Gatekeeper scene", () => {
  test("a new run starts at the gate with the starting coins and no fight, and only when asked for", () => {
    const game = newRun();
    expect(game.state.pendingGatekeeper).toBe(true);
    expect(game.state.combat).toBeNull();
    expect(game.state.coins).toBe(BALANCE.party.startingCoins);
    expect(new Game(7).state.pendingGatekeeper).toBe(false);
  });

  test("entering is refused until the party has answered", () => {
    const game = newRun();
    game.enterDungeon();
    expect(game.state.pendingGatekeeper).toBe(true);
  });

  test("leaving the coins takes the toll and arms the blessing; keeping them does neither", () => {
    const paid = newRun();
    paid.answerGatekeeper("paid");
    expect(paid.state.coins).toBe(BALANCE.party.startingCoins - BALANCE.gatekeeper.tollCoins);
    expect(paid.state.blessingRoomsLeft).toBe(BALANCE.gatekeeper.blessingRooms);
    paid.answerGatekeeper("refused");
    expect(paid.state.gatekeeperAnswer).toBe("paid");

    const refused = newRun();
    refused.answerGatekeeper("refused");
    expect(refused.state.coins).toBe(BALANCE.party.startingCoins);
    expect(refused.state.blessingRoomsLeft).toBe(0);
  });

  test("a party short of the toll can't leave it, and can still keep its coins", () => {
    const game = newRun();
    game.state.coins = BALANCE.gatekeeper.tollCoins - 1;
    expect(game.answerGatekeeper("paid")).toEqual({ reason: t("errors.notEnoughCoins") });
    expect(game.state.coins).toBe(BALANCE.gatekeeper.tollCoins - 1);
    expect(game.state.gatekeeperAnswer).toBeNull();
    expect(game.state.blessingRoomsLeft).toBe(0);
    expect(game.answerGatekeeper("refused")).toBeNull();
    expect(game.state.gatekeeperAnswer).toBe("refused");
  });

  test("entering starts the entry room's ambush, blessed only when the coins were left", () => {
    const paid = newRun();
    paid.answerGatekeeper("paid");
    paid.enterDungeon();
    expect(paid.state.pendingGatekeeper).toBe(false);
    expect(paid.state.combat).not.toBeNull();
    expect(paid.state.blessedRoomId).toBe(paid.state.floor.entryRoomId);
    expect(paid.state.blessingRoomsLeft).toBe(BALANCE.gatekeeper.blessingRooms - 1);
    expect(isBlessed(paid)).toBe(true);

    const refused = newRun();
    refused.answerGatekeeper("refused");
    refused.enterDungeon();
    expect(refused.state.combat).not.toBeNull();
    expect(refused.state.party.some((c) => c.activeStatusEffects.some((s) => s.statusEffectId === BLESSED))).toBe(false);
  });

  test("the blessing raises defense by its own percent of defense", () => {
    const paid = newRun();
    paid.answerGatekeeper("paid");
    paid.enterDungeon();
    const refused = newRun();
    refused.answerGatekeeper("refused");
    refused.enterDungeon();
    const before = refused.state.party[0]!.defense;
    const percent = getStatusEffect(BLESSED).perTurnEffects.find((e) => e.combatStat === "defense")!.minPercent!;
    expect(paid.state.party[0]!.defense).toBe(before + Math.round((before * percent) / 100));
  });

  test("an unanswered scene survives a save and reload", () => {
    const game = newRun();
    game.currentSaveSlot = "slot1";
    saveRun(game);
    const restored = gameFromSave(loadSave("slot1"), "slot1");
    expect(restored.state.pendingGatekeeper).toBe(true);
    expect(restored.state.combat).toBeNull();
  });

  test("the scene is never rolled into a room and never counts as lore", () => {
    const rng = new Rng(11);
    for (let i = 0; i < 3000; i++) expect(rollEvent(rng, 1 + (i % 120), [])).not.toBe("the-gatekeeper");
    expect(LORE_EXPOSURE_EVENT_IDS.has("the-gatekeeper")).toBe(false);
  });
});

describe("the blessing's room count", () => {
  const armed = () => {
    const game = newRun();
    game.answerGatekeeper("paid");
    return game.state;
  };

  test("covers the first N non-rest rooms, then fades on the next one", () => {
    const state = armed();
    const n = BALANCE.gatekeeper.blessingRooms;
    for (let i = 0; i < n; i++) {
      expect(countBlessedRoom(state, room(`c${i}`, i % 2 === 0 ? "combat" : "event"))).toBeNull();
      expect(state.blessedRoomId).toBe(`c${i}`);
      expect(countBlessedRoom(state, room(`r${i}`, "rest"))).toBeNull();
    }
    expect(state.blessingRoomsLeft).toBe(0);
    expect(countBlessedRoom(state, room("after", "combat"))).toBe(t("game.blessingFaded"));
    expect(state.blessedRoomId).toBeNull();
    expect(countBlessedRoom(state, room("later", "combat"))).toBeNull();
  });

  test("the guard room ends it early and is never blessed", () => {
    const state = armed();
    countBlessedRoom(state, room("c0", "combat"));
    expect(countBlessedRoom(state, room("guard", "boss"))).toBe(t("game.blessingCutByGuard"));
    expect(state.blessingRoomsLeft).toBe(0);
    expect(state.blessedRoomId).toBeNull();
  });

  test("a refused run never counts anything", () => {
    const game = newRun();
    game.answerGatekeeper("refused");
    expect(countBlessedRoom(game.state, room("c0", "combat"))).toBeNull();
    expect(game.state.blessedRoomId).toBeNull();
  });

  test("moving into the next room counts it and blesses a fight that starts there", () => {
    const game = newRun();
    game.answerGatekeeper("paid");
    game.enterDungeon();
    game.state.combat = null;
    const next = game.connectedRoomChoices().find((r) => r.type === "combat");
    expect(next).toBeDefined();
    game.move(next!.id);
    expect(game.state.blessedRoomId).toBe(next!.id);
    expect(game.state.combat).not.toBeNull();
    expect(isBlessed(game)).toBe(true);
  });
});

describe("the Gatekeeper screen", () => {
  test("shows the gate, takes an answer, then enters the dungeon", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 45 });
    const game = newRun();
    new App(renderer, game, { autoReveal: false });
    await renderOnce();
    await renderOnce();
    let frame = captureCharFrame();
    expect(frame).toContain("The Gatekeeper");
    expect(frame).toContain("[1-2] Choose");
    expect(frame).not.toContain("[q] Save");
    expect(frame).not.toContain("[s] Quicksave");
    mockInput.pressKey("s");
    mockInput.pressKey("q");
    await renderOnce();
    frame = captureCharFrame();
    expect(frame).not.toContain("Quicksaved.");
    expect(frame).not.toContain("Paused");
    expect(frame).toContain("[1-2] Choose");

    mockInput.pressKey("1");
    await renderOnce();
    frame = captureCharFrame();
    expect(game.state.gatekeeperAnswer).toBe("paid");
    const entry = getRoom(game.state.floor, game.state.floor.entryRoomId);
    const pathLine = `[1] ${entry.name} (${entry.type})`;
    expect(frame).toContain("Paths:");
    expect(frame).toContain(`│  ${pathLine}`);
    expect(frame).toContain("[1] Move");
    expect(frame).not.toContain("[i] Items");
    expect(frame).not.toContain("[q] Save");
    expect(frame).not.toContain("[s] Quicksave");
    expect(frame).toContain("Blessed: +");

    mockInput.pressKey("1");
    await renderOnce();
    expect(game.state.pendingGatekeeper).toBe(false);
    frame = captureCharFrame();
    expect(frame).not.toContain(pathLine);
    expect(frame).toContain("[q] Save");
    expect(frame).toContain("[s] Quicksave");
    // (∞) in the party panel; the header (top 3 lines) leaves the blessing out.
    expect(frame).toContain("Blessed (∞)");
    expect(frame.split("\n").slice(0, 3).join("\n")).not.toContain("Blessed");
    const info = characterInfoScreen.renderMain(game, { kind: "characterInfo", characterIndex: 0, previousUi: { kind: "room" } });
    const infoText = typeof info === "string" ? info : info.chunks.map((c) => c.text).join("");
    expect(infoText).toContain("- Blessed (∞)");
    expect(getRoom(game.state.floor, game.state.currentRoomId).id).toBe(game.state.floor.entryRoomId);
    renderer.destroy();
  });
});
