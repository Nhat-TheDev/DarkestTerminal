import { describe, test, expect } from "bun:test";
import {
  APP_VERSION,
  ALLOWED_LEGACY_SAVE_VERSIONS,
  UNVERSIONED,
  isSaveVersionAllowed,
  isSaveStateValid,
  isDevDumpAllowed,
  quickSave,
  autoSave,
  manualSave,
  writeDevDumpSave,
  listSaves,
  deleteSavesForRun,
  loadSave,
  gameFromSave,
  QUICKSAVE_ID,
  AUTOSAVE_ID,
} from "../src/engine/save";
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
      const meta = writeDevDumpSave(game, "dev-dump-test");
      expect(meta.devDump).toBe(true);
      expect(listSaves().some((m) => m.id === "dev-dump-test")).toBe(true);

      const save = loadSave("dev-dump-test");
      expect(save.meta.devDump).toBe(true);
      const resumed = gameFromSave(save, "dev-dump-test");
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
    deleteSavesForRun(game.state.runId);
  }
}

describe("Save file read/write (isolated temp dir via bunfig.toml preload)", () => {
  test("quickSave writes a file that listSaves() and loadSave() can find and read back", () => {
    withGame(2, (game) => {
      quickSave(game);
      expect(listSaves().some((m) => m.id === QUICKSAVE_ID)).toBe(true);
      expect(loadSave(QUICKSAVE_ID).state.runId).toBe(game.state.runId);
    });
  });

  test("deleteSavesForRun removes every save (quick/auto/manual) sharing a runId", () => {
    withGame(3, (game) => {
      quickSave(game);
      autoSave(game);
      const manualMeta = manualSave(game);
      expect(listSaves().some((m) => m.id === QUICKSAVE_ID)).toBe(true);
      expect(listSaves().some((m) => m.id === AUTOSAVE_ID)).toBe(true);
      expect(listSaves().some((m) => m.id === manualMeta.id)).toBe(true);

      deleteSavesForRun(game.state.runId);

      expect(listSaves().some((m) => m.id === QUICKSAVE_ID)).toBe(false);
      expect(listSaves().some((m) => m.id === AUTOSAVE_ID)).toBe(false);
      expect(listSaves().some((m) => m.id === manualMeta.id)).toBe(false);
    });
  });

  test("gameFromSave persists a fresh runId back to disk for a save written before runId existed", () => {
    withGame(4, (game) => {
      const meta = manualSave(game);
      const save = loadSave(meta.id);
      delete (save.meta as { runId?: string }).runId;
      delete (save.state as { runId?: string }).runId;

      const resumed = gameFromSave(save, meta.id);
      expect(typeof resumed.state.runId).toBe("string");
      expect(loadSave(meta.id).meta.runId).toBe(resumed.state.runId);

      deleteSavesForRun(resumed.state.runId);
      expect(listSaves().some((m) => m.id === meta.id)).toBe(false);
    });
  });

  test("gameFromSave throws for a disallowed save version", () => {
    withGame(5, (game) => {
      const meta = manualSave(game);
      const save = loadSave(meta.id);
      save.meta.saveVersion = "0.0.1-not-a-real-version";
      expect(() => gameFromSave(save, meta.id)).toThrow();
    });
  });

  test("gameFromSave throws for a structurally invalid save state", () => {
    withGame(6, (game) => {
      const meta = manualSave(game);
      const save = loadSave(meta.id);
      save.state.coins = -1;
      expect(() => gameFromSave(save, meta.id)).toThrow();
    });
  });
});
