import { describe, test, expect } from "bun:test";
import {
  APP_VERSION,
  ALLOWED_LEGACY_SAVE_VERSIONS,
  UNVERSIONED,
  isSaveVersionAllowed,
  isSaveStateValid,
  isDevDumpAllowed,
  saveRun,
  writeDevDumpSave,
  listSlots,
  deleteSlot,
  firstFreeSlotId,
  loadSave,
  gameFromSave,
  SLOT_IDS,
} from "../src/engine/save";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SAVE_DIR } from "../src/engine/paths";
import { Game } from "../src/engine/game";
import type { GameState } from "../src/types";

const PARTY = ["vanguard", "mage", "rogue", "acolyte"];

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

describe("Dev-dump save gating", () => {
  test("a save with no devDump flag is always allowed, dev mode or not", () => {
    expect(isDevDumpAllowed({})).toBe(true);
    expect(isDevDumpAllowed({}, false)).toBe(true);
  });

  test("a devDump save is allowed in dev mode and blocked outside it", () => {
    expect(isDevDumpAllowed({ devDump: true }, true)).toBe(true);
    expect(isDevDumpAllowed({ devDump: true }, false)).toBe(false);
  });

  test("writeDevDumpSave stamps meta.devDump and the save loads normally under dev mode (this test run)", () => {
    withGame(7, (game) => {
      const meta = writeDevDumpSave(game, "slot4");
      expect(meta.devDump).toBe(true);
      expect(listSlots().find((s) => s.id === "slot4")?.meta?.devDump).toBe(true);

      const save = loadSave("slot4");
      expect(save.meta.devDump).toBe(true);
      const resumed = gameFromSave(save, "slot4");
      expect(resumed.state.runId).toBe(game.state.runId);
    });
  });
});

function validState(): GameState {
  return new Game(1, PARTY).state;
}

describe("Save state validation", () => {
  test("a freshly created game state is valid", () => {
    expect(isSaveStateValid(validState())).toBe(true);
  });

  test("a negative combat stat from a status-effect debuff is still valid", () => {
    const state = validState();
    state.party[0]!.speed = -12;
    state.party[0]!.aggro = -5;
    state.party[0]!.defense = -1;
    expect(isSaveStateValid(state)).toBe(true);
  });

  const invalidCases: [string, (s: GameState) => void][] = [
    ["wrong party size", (s) => { s.party.pop(); }],
    ["unknown classId", (s) => { s.party[0]!.classId = "not-a-real-class"; }],
    ["level below 1", (s) => { s.party[0]!.level = 0; }],
    ["level above MAX_LEVEL", (s) => { s.party[0]!.level = 101; }],
    ["hp above maxHp", (s) => { s.party[0]!.hp = s.party[0]!.maxHp + 1; }],
    ["negative coins", (s) => { s.coins = -1; }],
    ["satiety out of [0,100]", (s) => { s.satiety = 150; }],
    ["floor depth below 1", (s) => { s.floor.depth = 0; }],
    ["too many equipped artifacts", (s) => { s.party[0]!.equippedArtifactIds = ["iron-gauntlet", "worn-wooden-shield", "charm-of-life", "iron-gauntlet"]; }],
    ["unknown equipped artifact id", (s) => { s.party[0]!.equippedArtifactIds = ["not-a-real-artifact"]; }],
    ["nonsensical gameOver value", (s) => { (s as unknown as { gameOver: string }).gameOver = "cheated"; }],
    ["non-finite combat stat", (s) => { s.party[0]!.attack = Number.NaN; }],
    [
      "malformed combat.phase",
      (s) => {
        s.combat = { roomId: "r1", combatants: [], roundNumber: 1, phase: "not-a-real-phase" as never, queuedActions: [], turnQueue: [], activeTurnIndex: 0, isBossFight: false, log: [] };
      },
    ],
  ];

  test.each(invalidCases)("%s is invalid", (_name, mutate) => {
    const state = validState();
    mutate(state);
    expect(isSaveStateValid(state)).toBe(false);
  });
});

function withGame(seed: number, fn: (game: Game) => void): void {
  const game = new Game(seed, PARTY);
  try {
    fn(game);
  } finally {
    SLOT_IDS.forEach(deleteSlot);
  }
}

describe("Save slots (isolated temp dir via bunfig.toml preload)", () => {
  test("saveRun writes to the run's slot, and listSlots/loadSave read it back", () => {
    withGame(2, (game) => {
      game.currentSaveSlot = "slot2";
      saveRun(game);
      const slot = listSlots().find((s) => s.id === "slot2");
      expect(slot?.meta?.runId).toBe(game.state.runId);
      expect(loadSave("slot2").state.runId).toBe(game.state.runId);
    });
  });

  test("saveRun is a no-op for a run with no slot", () => {
    withGame(3, (game) => {
      expect(saveRun(game)).toBeNull();
      expect(listSlots().every((s) => s.meta === null)).toBe(true);
    });
  });

  test("listSlots always returns one entry per slot, in order", () => {
    withGame(4, () => {
      expect(listSlots().map((s) => s.id)).toEqual([...SLOT_IDS]);
    });
  });

  test("a slot whose save fails validation reads as empty, and firstFreeSlotId can reuse it", () => {
    withGame(5, (game) => {
      game.currentSaveSlot = "slot1";
      saveRun(game);
      expect(firstFreeSlotId()).toBe("slot2");

      const save = loadSave("slot1");
      save.meta.saveVersion = "0.0.1-not-a-real-version";
      writeFileSync(join(SAVE_DIR, "slot1.json"), JSON.stringify(save));
      expect(listSlots()[0]!.meta).toBeNull();
      expect(firstFreeSlotId()).toBe("slot1");
    });
  });

  test("firstFreeSlotId is null when every slot is occupied", () => {
    withGame(6, (game) => {
      for (const id of SLOT_IDS) {
        game.currentSaveSlot = id;
        saveRun(game);
      }
      expect(firstFreeSlotId()).toBeNull();
    });
  });

  test("deleteSlot removes the slot's file and tolerates an empty slot", () => {
    withGame(7, (game) => {
      game.currentSaveSlot = "slot3";
      saveRun(game);
      deleteSlot("slot3");
      expect(listSlots().find((s) => s.id === "slot3")?.meta).toBeNull();
      expect(() => deleteSlot("slot3")).not.toThrow();
    });
  });

  test("gameFromSave binds the run to the slot it was loaded from", () => {
    withGame(8, (game) => {
      game.currentSaveSlot = "slot5";
      saveRun(game);
      const resumed = gameFromSave(loadSave("slot5"), "slot5");
      expect(resumed.currentSaveSlot).toBe("slot5");
      expect(resumed.state.runId).toBe(game.state.runId);
    });
  });

  test("playtime carries across a save/load instead of restarting", () => {
    withGame(9, (game) => {
      game.currentSaveSlot = "slot1";
      saveRun(game);
      const save = loadSave("slot1");
      save.meta.playTime = 3600;
      const resumed = gameFromSave(save, "slot1");
      expect(resumed.playTimeSec()).toBeGreaterThanOrEqual(3600);
      expect(resumed.playTimeSec()).toBeLessThan(3700);
      saveRun(resumed);
      expect(loadSave("slot1").meta.playTime).toBeGreaterThanOrEqual(3600);
    });
  });

  test("gameFromSave throws for a disallowed save version", () => {
    withGame(10, (game) => {
      game.currentSaveSlot = "slot1";
      saveRun(game);
      const save = loadSave("slot1");
      save.meta.saveVersion = "0.0.1-not-a-real-version";
      expect(() => gameFromSave(save, "slot1")).toThrow();
    });
  });

  test("gameFromSave throws for a structurally invalid save state", () => {
    withGame(11, (game) => {
      game.currentSaveSlot = "slot1";
      saveRun(game);
      const save = loadSave("slot1");
      save.state.coins = -1;
      expect(() => gameFromSave(save, "slot1")).toThrow();
    });
  });
});
