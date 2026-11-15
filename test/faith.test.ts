import { describe, expect, test } from "bun:test";
import { BALANCE } from "../src/data/balanceConfig";
import { Game } from "../src/engine/game";
import { getRoom, moveToRoom } from "../src/engine/dungeon";
import { adjustFaith, drainFaithOnFirstEntry, faithFearMultiplier, resistedFearGain } from "../src/engine/survival";
import type { GameState } from "../src/types";
import { makeCtx } from "./helpers";

const PARTY = ["knight", "mage", "rogue", "acolyte"];

function drainOnce(state: GameState): void {
  drainFaithOnFirstEntry(state, getRoom(state.floor, state.currentRoomId), true);
}

describe("Faith", () => {
  test("a new run starts at the configured Faith", () => {
    expect(new Game(1, PARTY).state.faith).toBe(BALANCE.faith.initial);
  });

  test("adjustFaith clamps and rounds", () => {
    const state = new Game(1, PARTY).state;
    expect(adjustFaith(state, 5)).toBe(0);
    expect(state.faith).toBe(100);
    state.faith = 10;
    adjustFaith(state, -12.34);
    expect(state.faith).toBe(0);
    state.faith = 50;
    adjustFaith(state, -1.26);
    expect(state.faith).toBe(48.7);
  });

  test("faith stores one decimal and displays rounded", () => {
    const state = new Game(1, PARTY).state;
    drainOnce(state);
    expect(state.faith).toBe(96);
    drainOnce(state);
    expect(state.faith).toBe(92.1);
    expect(Math.round(state.faith)).toBe(92);
  });

  test("fear multiplier ends and neutral point", () => {
    expect(faithFearMultiplier(0)).toBe(1.2);
    expect(faithFearMultiplier(100)).toBe(0.5);
    expect(Math.abs(faithFearMultiplier((100 * 0.2) / 0.7) - 1)).toBeLessThan(1e-9);
  });

  test("fear gain scales with faith", () => {
    const c = makeCtx().ctx.party[0]!;
    c.activeStatusEffects = [];
    expect(resistedFearGain(c, 10, 0)).toBe(12);
    expect(resistedFearGain(c, 10, 100)).toBe(5);
  });

  test("drain only on first entry, never in a temple", () => {
    const game = new Game(3, PARTY);
    const { state } = game;
    const startId = state.currentRoomId;
    const nextId = getRoom(state.floor, startId).connectedRoomIds[0]!;
    const next = getRoom(state.floor, nextId);

    moveToRoom(state, nextId, game.ctx);
    expect(state.faith).toBe(96);

    next.connectedRoomIds.push(startId);
    state.combat = null;
    moveToRoom(state, startId, game.ctx);
    expect(state.faith).toBe(96);

    state.faith = 100;
    const otherId = getRoom(state.floor, startId).connectedRoomIds.find((id) => id !== nextId) ?? nextId;
    const other = getRoom(state.floor, otherId);
    state.roomPath = state.roomPath.filter((id) => id !== otherId);
    other.type = "temple";
    state.combat = null;
    moveToRoom(state, otherId, game.ctx);
    expect(state.faith).toBe(100);
  });

  test("non-temple entry room drains on floor advance", () => {
    const game = new Game(4, PARTY);
    game.advanceToNextFloor();
    expect(game.state.faith).toBe(96);
  });
});
