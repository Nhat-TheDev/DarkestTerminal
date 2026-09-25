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
import { getActorByRef, startCombat } from "../src/engine/combat";
import { getRoom } from "../src/engine/dungeon";
import { spawnMonster, getArchetype } from "../src/data/monsters";
import type { GameState, Summon } from "../src/types";

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

  test("a save/load round-trip keeps an active summon usable instead of leaving a dangling combatant ref", () => {
    withGame(11, (game) => {
      game.currentSaveSlot = "slot1";
      const owner = game.state.party[0]!;
      const rat = spawnMonster("dungeon-rat", 1);
      game.ctx.monsters.push(rat);
      const room = getRoom(game.state.floor, game.state.currentRoomId);
      room.monsterIds = [rat.id];
      room.cleared = false;
      game.state.combat = startCombat(room.id, [rat.id], game.ctx, false);

      const summon: Summon = {
        id: "test-summon-1",
        ownerId: owner.id,
        archetypeId: "ninja-clone",
        name: "Test Clone",
        hp: 10,
        maxHp: 10,
        attack: 1,
        defense: 1,
        magicPower: 0,
        aggro: 20,
        speed: 5,
        activeStatusEffects: [],
        actionsTaken: 0,
        maxActions: 2,
      };
      game.ctx.summons.push(summon);
      game.state.combat.combatants.push({ ref: { kind: "summon", id: summon.id }, speed: summon.speed });

      saveRun(game);
      const resumed = gameFromSave(loadSave("slot1"), "slot1");

      expect(resumed.ctx.summons).toHaveLength(1);
      expect(resumed.ctx.summons[0]!.id).toBe(summon.id);
      expect(() => getActorByRef({ kind: "summon", id: summon.id }, resumed.ctx)).not.toThrow();
    });
  });

  test("a legacy save with no summons field still loads, dropping the now-dangling summon combatant ref instead of crashing", () => {
    withGame(12, (game) => {
      game.currentSaveSlot = "slot1";
      const rat = spawnMonster("dungeon-rat", 1);
      game.ctx.monsters.push(rat);
      const room = getRoom(game.state.floor, game.state.currentRoomId);
      room.monsterIds = [rat.id];
      room.cleared = false;
      game.state.combat = startCombat(room.id, [rat.id], game.ctx, false);
      const summonRef = { kind: "summon" as const, id: "test-summon-legacy" };
      game.state.combat.combatants.push({ ref: summonRef, speed: 5 });
      game.state.combat.turnQueue.push(summonRef);

      saveRun(game);
      const save = loadSave("slot1");
      delete save.summons; // simulates a save written before this field existed

      const resumed = gameFromSave(save, "slot1");

      expect(resumed.ctx.summons).toHaveLength(0);
      expect(resumed.state.combat!.combatants.some((c) => c.ref.kind === "summon")).toBe(false);
      expect(resumed.state.combat!.turnQueue.some((r) => r.kind === "summon")).toBe(false);
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

  test("gameFromSave backfills race/subRace/traitIds onto monsters saved before the race/trait system existed", () => {
    withGame(12, (game) => {
      const rat = spawnMonster("dungeon-rat", 1);
      game.ctx.monsters.push(rat);
      const room = getRoom(game.state.floor, game.state.currentRoomId);
      room.monsterIds = [rat.id];
      room.cleared = false;
      game.state.combat = startCombat(room.id, [rat.id], game.ctx, false);

      game.currentSaveSlot = "slot1";
      saveRun(game);

      const save = loadSave("slot1");
      const savedRat = save.monsters.find((m) => m.id === rat.id)! as unknown as Record<string, unknown>;
      delete savedRat.race;
      delete savedRat.subRace;
      delete savedRat.traitIds;

      const resumed = gameFromSave(save, "slot1");
      const resumedRat = resumed.ctx.monsters.find((m) => m.id === rat.id)!;
      const archetype = getArchetype("dungeon-rat");
      expect(resumedRat.race).toBe(archetype.race);
      expect(resumedRat.subRace).toBe(archetype.subRace);
      expect(resumedRat.traitIds).toEqual(archetype.traitIds);
    });
  });
});
