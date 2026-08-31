import { describe, test, expect } from "bun:test";
import { APP_VERSION, ALLOWED_LEGACY_SAVE_VERSIONS, UNVERSIONED, isSaveVersionAllowed, isSaveStateValid } from "../src/engine/save";
import { Game } from "../src/engine/game";
import type { GameState } from "../src/types";

describe("Save version blocking", () => {
  test("current app version is always allowed", () => {
    expect(isSaveVersionAllowed(APP_VERSION)).toBe(true);
  });

  test("a version not in the allowlist is blocked", () => {
    expect(isSaveVersionAllowed("0.0.1-not-a-real-version")).toBe(false);
  });

  test("a save with no version field is blocked by default", () => {
    expect(ALLOWED_LEGACY_SAVE_VERSIONS.includes(UNVERSIONED)).toBe(false);
    expect(isSaveVersionAllowed(undefined)).toBe(false);
  });

  test("a version explicitly added to the allowlist is allowed", () => {
    const original = [...ALLOWED_LEGACY_SAVE_VERSIONS];
    expect(isSaveVersionAllowed("0.1.1")).toBe(false);
    ALLOWED_LEGACY_SAVE_VERSIONS.push("0.1.1");
    try {
      expect(isSaveVersionAllowed("0.1.1")).toBe(true);
    } finally {
      ALLOWED_LEGACY_SAVE_VERSIONS.length = 0;
      ALLOWED_LEGACY_SAVE_VERSIONS.push(...original);
    }
  });
});

function validState(): GameState {
  return new Game(1, ["vanguard", "mage", "rogue", "acolyte"]).state;
}

describe("Save state validation", () => {
  test("a freshly created game state is valid", () => {
    expect(isSaveStateValid(validState())).toBe(true);
  });

  test("wrong party size is invalid", () => {
    const state = validState();
    state.party.pop();
    expect(isSaveStateValid(state)).toBe(false);
  });

  test("unknown classId is invalid", () => {
    const state = validState();
    state.party[0]!.classId = "not-a-real-class";
    expect(isSaveStateValid(state)).toBe(false);
  });

  test("level out of range is invalid", () => {
    const state = validState();
    state.party[0]!.level = 0;
    expect(isSaveStateValid(state)).toBe(false);
    state.party[0]!.level = 101;
    expect(isSaveStateValid(state)).toBe(false);
  });

  test("hp above maxHp is invalid", () => {
    const state = validState();
    state.party[0]!.hp = state.party[0]!.maxHp + 1;
    expect(isSaveStateValid(state)).toBe(false);
  });

  test("negative coins is invalid", () => {
    const state = validState();
    state.coins = -1;
    expect(isSaveStateValid(state)).toBe(false);
  });

  test("satiety out of [0,100] is invalid", () => {
    const state = validState();
    state.satiety = 150;
    expect(isSaveStateValid(state)).toBe(false);
  });

  test("floor depth below 1 is invalid", () => {
    const state = validState();
    state.floor.depth = 0;
    expect(isSaveStateValid(state)).toBe(false);
  });

  test("too many equipped artifacts is invalid", () => {
    const state = validState();
    state.party[0]!.equippedArtifactIds = ["iron-gauntlet", "worn-wooden-shield", "charm-of-life", "iron-gauntlet"];
    expect(isSaveStateValid(state)).toBe(false);
  });

  test("unknown equipped artifact id is invalid", () => {
    const state = validState();
    state.party[0]!.equippedArtifactIds = ["not-a-real-artifact"];
    expect(isSaveStateValid(state)).toBe(false);
  });

  test("nonsensical gameOver value is invalid", () => {
    const state = validState();
    (state as unknown as { gameOver: string }).gameOver = "cheated";
    expect(isSaveStateValid(state)).toBe(false);
  });
});
