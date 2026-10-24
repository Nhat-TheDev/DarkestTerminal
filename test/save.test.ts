import { describe, test, expect } from "bun:test";
import {
  APP_VERSION,
  OLDEST_LOADABLE_SAVE_VERSION,
  UNVERSIONED,
  isSaveVersionAllowed,
  isSaveStateValid,
  isDevDumpAllowed,
  saveRun,
  writeDevDumpSave,
  listSlots,
  deleteSlot,
  clearSlot,
  migrateLegacyProfile,
  firstFreeSlotId,
  loadSave,
  gameFromSave,
  SLOT_IDS,
} from "../src/engine/save";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { beginRun, loadProfile, saveProfile } from "../src/engine/profile";
import { join } from "node:path";
import { SAVE_DIR } from "../src/engine/paths";
import { Game } from "../src/engine/game";
import { getActorByRef, startCombat } from "../src/engine/combat";
import { getRoom, moveToRoom } from "../src/engine/dungeon";
import { spawnMonster, getArchetype } from "../src/data/monsters";
import { compareVersions, migrateGameState, migrateMonsters, migrateSummons } from "../src/engine/migration";
import { expCostForLevel, levelForTotalExp, MAX_LEVEL } from "../src/data/levelGrowth";
import { getClass } from "../src/data/classes";
import { FLOOR_MILESTONE_OMENS, getFloorMilestoneOmen } from "../src/data/floorMilestones";
import type { GameState, Monster, Summon } from "../src/types";
import { advanceBar } from "../src/engine/monsterBars";

const PARTY = ["knight", "mage", "rogue", "acolyte"];

describe("Save version blocking", () => {
  test("current app version is always allowed", () => {
    expect(isSaveVersionAllowed(APP_VERSION)).toBe(true);
  });

  test("every version from the oldest loadable one up to the app's own is allowed", () => {
    expect(isSaveVersionAllowed(OLDEST_LOADABLE_SAVE_VERSION)).toBe(true);
  });

  test("a version older than the oldest loadable one is blocked", () => {
    expect(isSaveVersionAllowed("1.0.0")).toBe(false);
  });

  test("a version newer than the app is blocked", () => {
    const [major, minor, patch] = APP_VERSION.split(".").map(Number);
    expect(isSaveVersionAllowed(`${major}.${minor}.${patch! + 1}`)).toBe(false);
    expect(isSaveVersionAllowed(`${major! + 1}.0.0`)).toBe(false);
  });

  test("a save with no version field, or one that is not x.y.z, is blocked", () => {
    expect(isSaveVersionAllowed(undefined)).toBe(false);
    expect(isSaveVersionAllowed(UNVERSIONED)).toBe(false);
    expect(isSaveVersionAllowed("0.0.1-not-a-real-version")).toBe(false);
    expect(isSaveVersionAllowed("1.2.0-rc.1")).toBe(false);
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
    SLOT_IDS.forEach(clearSlot);
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

  test("deleteSlot keeps the slot's profile, so the slot reads as ended on the same run number", () => {
    withGame(8, (game) => {
      game.currentSaveSlot = "slot2";
      beginRun("slot2");
      saveProfile("slot2", { ...loadProfile("slot2"), unlockedAbilityIds: ["bloodletting"] });
      saveRun(game);
      deleteSlot("slot2");
      const slot = listSlots().find((s) => s.id === "slot2");
      expect(slot?.meta).toBeNull();
      expect(slot?.runCount).toBe(1);
      expect(loadProfile("slot2").unlockedAbilityIds).toEqual(["bloodletting"]);
    });
  });

  test("beginRun counts runs per slot, and clearSlot starts the slot over", () => {
    withGame(9, (game) => {
      beginRun("slot4");
      beginRun("slot4");
      expect(listSlots().find((s) => s.id === "slot4")?.runCount).toBe(2);
      expect(listSlots().find((s) => s.id === "slot5")?.runCount).toBe(0);
      game.currentSaveSlot = "slot4";
      saveRun(game);
      clearSlot("slot4");
      expect(listSlots().find((s) => s.id === "slot4")).toEqual({ id: "slot4", meta: null, runCount: 0 });
      expect(loadProfile("slot4").unlockedAbilityIds).toEqual([]);
    });
  });

  test("migrateLegacyProfile copies the shared profile into slots holding a run only, once", () => {
    withGame(10, (game) => {
      game.currentSaveSlot = "slot3";
      saveRun(game);
      const legacyPath = join(SAVE_DIR, "profile.json");
      writeFileSync(legacyPath, JSON.stringify({ version: 1, unlockedAbilityIds: ["bloodletting"], retiredCharacters: [{ classId: "rogue" }], shownRetiredCharacterEvent: true }));
      migrateLegacyProfile();
      expect(loadProfile("slot3")).toMatchObject({ unlockedAbilityIds: ["bloodletting"], retiredCharacters: [{ classId: "rogue" }], shownRetiredCharacterEvent: true, runCount: 1 });
      expect(loadProfile("slot1").unlockedAbilityIds).toEqual([]);
      expect(existsSync(legacyPath)).toBe(false);
      expect(existsSync(join(SAVE_DIR, "profile.legacy.json"))).toBe(true);
      saveProfile("slot3", { ...loadProfile("slot3"), unlockedAbilityIds: [] });
      migrateLegacyProfile();
      expect(loadProfile("slot3").unlockedAbilityIds).toEqual([]);
    });
  });

  describe("legacy profile migration edge cases", () => {
    const legacyPath = join(SAVE_DIR, "profile.json");
    const backupPath = join(SAVE_DIR, "profile.legacy.json");
    const writeLegacy = () => writeFileSync(legacyPath, JSON.stringify({ version: 1, unlockedAbilityIds: ["bloodletting"], retiredCharacters: [], shownRetiredCharacterEvent: false }));
    const cleanUp = () => {
      rmSync(legacyPath, { recursive: true, force: true });
      rmSync(backupPath, { recursive: true, force: true });
    };

    test("a profile.json recreated by an older build never overwrites a slot's own profile", () => {
      withGame(12, (game) => {
        try {
          game.currentSaveSlot = "slot1";
          saveRun(game);
          saveProfile("slot1", { ...loadProfile("slot1"), runCount: 4, memoryUnlocked: true, unlockedAbilityIds: ["predators-edge"] });
          writeLegacy();
          migrateLegacyProfile();
          expect(loadProfile("slot1")).toMatchObject({ runCount: 4, memoryUnlocked: true, unlockedAbilityIds: ["predators-edge"] });
        } finally {
          cleanUp();
        }
      });
    });

    test("a slot whose run cannot be loaded gets nothing, matching the slot list that shows it as empty", () => {
      withGame(13, (game) => {
        try {
          game.currentSaveSlot = "slot2";
          saveRun(game);
          const save = loadSave("slot2");
          save.meta.saveVersion = "0.0.1-not-a-real-version";
          writeFileSync(join(SAVE_DIR, "slot2.json"), JSON.stringify(save));
          writeLegacy();
          migrateLegacyProfile();
          expect(loadProfile("slot2").unlockedAbilityIds).toEqual([]);
          expect(listSlots().find((s) => s.id === "slot2")).toMatchObject({ meta: null, runCount: 0 });
        } finally {
          cleanUp();
        }
      });
    });

    test("a rename that fails does not stop the game from starting", () => {
      withGame(14, (game) => {
        try {
          game.currentSaveSlot = "slot1";
          saveRun(game);
          writeLegacy();
          mkdirSync(join(backupPath, "blocker"), { recursive: true });
          expect(() => migrateLegacyProfile()).not.toThrow();
          expect(loadProfile("slot1").unlockedAbilityIds).toEqual(["bloodletting"]);
        } finally {
          cleanUp();
        }
      });
    });
  });

  test("a 1.1.x slot whose metadata still names a renamed class lists the new class id", () => {
    withGame(16, (game) => {
      game.currentSaveSlot = "slot1";
      saveRun(game);
      const save = loadSave("slot1");
      save.meta.saveVersion = "1.1.1";
      save.meta.partyClassIds = ["vanguard", ...save.meta.partyClassIds.slice(1)];
      save.state.party[0]!.classId = "vanguard";
      writeFileSync(join(SAVE_DIR, "slot1.json"), JSON.stringify(save));
      expect(listSlots()[0]!.meta?.partyClassIds[0]).toBe("knight");
    });
  });

  test("loading a run saved before its slot had a profile counts it as the slot's first run", () => {
    withGame(15, (game) => {
      game.currentSaveSlot = "slot4";
      saveRun(game);
      expect(loadProfile("slot4").runCount).toBe(0);
      gameFromSave(loadSave("slot4"), "slot4");
      expect(loadProfile("slot4").runCount).toBe(1);
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
        archetypeId: "shadow-clone",
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

  describe("a saved status whose id no longer exists", () => {
    const gone = (appliedAmounts?: Record<string, number>) => ({ statusEffectId: "a-status-that-was-renamed", turnsRemaining: 5, appliedAmounts });
    const guard = { statusEffectId: "guard", turnsRemaining: 2 };

    test("is dropped from a monster, and the stat change it recorded is taken back", () => {
      const rat = spawnMonster("dungeon-rat", 1);
      const [attack, defense] = [rat.attack, rat.defense];
      rat.attack += 5; // a buff
      rat.defense -= 4; // a debuff
      rat.activeStatusEffects.push(gone({ attack: 5 }), gone({ defense: -4 }), { ...guard });
      migrateMonsters([rat]);
      expect(rat.attack).toBe(attack);
      expect(rat.defense).toBe(defense);
      expect(rat.activeStatusEffects).toEqual([guard]);
    });

    test("is dropped from a summon the same way", () => {
      const summon = { id: "s", ownerId: "p", archetypeId: "shadow-clone", name: "Clone", hp: 5, maxHp: 5, attack: 8, defense: 2, magicPower: 0, aggro: 20, speed: 3, activeStatusEffects: [gone({ attack: 3, aggro: 4 }), { ...guard }], actionsTaken: 0, maxActions: 2 } as Summon;
      migrateSummons([summon]);
      expect(summon.attack).toBe(5);
      expect(summon.aggro).toBe(16);
      expect(summon.activeStatusEffects).toEqual([guard]);
    });

    test("a status with no recorded stat change is just dropped, and a stat the bearer does not have is ignored", () => {
      const rat = spawnMonster("dungeon-rat", 1);
      const attack = rat.attack;
      rat.activeStatusEffects.push(gone(), gone({ aggro: 7 }));
      migrateMonsters([rat]);
      expect(rat.activeStatusEffects).toEqual([]);
      expect(rat.attack).toBe(attack);
      expect("aggro" in rat).toBe(false);
    });

    test("loading a save drops it from everyone in the party, the monsters and the summons", () => {
      withGame(21, (game) => {
        game.currentSaveSlot = "slot1";
        const hero = game.state.party[0]!;
        const heroAttack = hero.attack;
        const rat = spawnMonster("dungeon-rat", 1);
        game.ctx.monsters.push(rat);
        const room = getRoom(game.state.floor, game.state.currentRoomId);
        room.monsterIds = [rat.id];
        room.cleared = false;
        game.state.combat = startCombat(room.id, [rat.id], game.ctx, false);
        const summon = { id: "test-summon-2", ownerId: hero.id, archetypeId: "shadow-clone", name: "Clone", hp: 5, maxHp: 5, attack: 6, defense: 1, magicPower: 0, aggro: 20, speed: 5, activeStatusEffects: [gone({ attack: 2 })], actionsTaken: 0, maxActions: 2 } as Summon;
        game.ctx.summons.push(summon);
        game.state.combat.combatants.push({ ref: { kind: "summon", id: summon.id }, speed: summon.speed });
        const ratAttack = rat.attack;
        hero.attack += 9;
        hero.activeStatusEffects.push(gone({ attack: 9 }));
        rat.attack += 5;
        rat.activeStatusEffects.push(gone({ attack: 5 }));

        saveRun(game);
        const resumed = gameFromSave(loadSave("slot1"), "slot1");

        expect(resumed.state.party[0]!.activeStatusEffects).toEqual([]);
        expect(resumed.state.party[0]!.attack).toBe(heroAttack);
        expect(resumed.ctx.monsters.find((m) => m.id === rat.id)!.activeStatusEffects).toEqual([]);
        expect(resumed.ctx.monsters.find((m) => m.id === rat.id)!.attack).toBe(ratAttack);
        expect(resumed.ctx.summons[0]!.activeStatusEffects).toEqual([]);
        expect(resumed.ctx.summons[0]!.attack).toBe(4);
      });
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
      delete save.summons; // as written before this field existed

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

describe("The route walked on a floor", () => {
  /** Clears and enters one connected room per step, as a player walking the floor would. */
  function walk(game: Game, steps: number): void {
    for (let i = 0; i < steps; i++) {
      const here = getRoom(game.state.floor, game.state.currentRoomId);
      here.cleared = true;
      game.state.combat = null;
      moveToRoom(game.state, here.connectedRoomIds[0]!, game.ctx);
    }
  }

  test("starts at the entrance, grows by each room entered, and restarts on the next floor", () => {
    const game = new Game(21, PARTY);
    expect(game.state.roomPath).toEqual([game.state.floor.entryRoomId]);
    walk(game, 3);
    expect(game.state.roomPath).toHaveLength(4);
    expect(game.state.roomPath.at(-1)).toBe(game.state.currentRoomId);
    game.advanceToNextFloor();
    expect(game.state.roomPath).toEqual([game.state.floor.entryRoomId]);
  });

  test("survives a save and load", () => {
    const game = new Game(22, PARTY);
    try {
      walk(game, 3);
      game.currentSaveSlot = "slot1";
      saveRun(game);
      const loaded = gameFromSave(loadSave("slot1"), "slot1");
      expect(loaded.state.roomPath).toEqual(game.state.roomPath);
    } finally {
      SLOT_IDS.forEach(deleteSlot);
    }
  });

  test("a save from before the route was recorded gets it rebuilt from the cleared rooms", () => {
    const game = new Game(23, PARTY);
    walk(game, 3);
    const expected = [...game.state.roomPath];
    const old = structuredClone(game.state) as Partial<GameState>;
    delete old.roomPath;
    expect(migrateGameState(old).roomPath).toEqual(expected);
  });
});

describe("Loading a save after a data change", () => {
  const savedState = (): GameState => structuredClone(new Game(11, PARTY).state);

  test("a character saved with a since-renamed skill id loads with the current id", () => {
    const state = savedState();
    const mage = state.party.find((c) => c.classId === "mage")!;
    const basicId = getClass("mage").skills[0]!.id;
    mage.unlockedSkillIds = mage.unlockedSkillIds.map((id) => (id === basicId ? "renamed-old-basic" : id));
    const migrated = migrateGameState(state);
    expect(migrated.party.find((c) => c.classId === "mage")!.unlockedSkillIds).toContain(basicId);
    expect(migrated.party.find((c) => c.classId === "mage")!.unlockedSkillIds).not.toContain("renamed-old-basic");
  });

  test("a pending milestone saved as text loads with a valid omen pending", () => {
    const state = savedState() as GameState & { pendingFloorMilestoneMessage?: string | null };
    state.pendingFloorMilestoneMessage = "Something changes in the dark beyond this floor.";
    const migrated = migrateGameState(state) as typeof state;
    expect(getFloorMilestoneOmen(migrated.pendingFloorMilestoneOmenId!)).toBeDefined();
    expect(migrated.shownFloorMilestoneIds).toContain(migrated.pendingFloorMilestoneOmenId!);
    expect(migrated.pendingFloorMilestoneMessage).toBeUndefined();
  });

  test("a pending omen id no longer in the data is replaced by one that is", () => {
    const state = savedState();
    state.pendingFloorMilestoneOmenId = "omen-removed-from-data";
    state.shownFloorMilestoneIds = ["omen-removed-from-data"];
    const migrated = migrateGameState(state);
    expect(FLOOR_MILESTONE_OMENS.map((o) => o.id)).toContain(migrated.pendingFloorMilestoneOmenId!);
  });

  test("a pending omen that still exists is left as it is", () => {
    const state = savedState();
    const omenId = FLOOR_MILESTONE_OMENS[0]!.id;
    state.pendingFloorMilestoneOmenId = omenId;
    state.shownFloorMilestoneIds = [omenId];
    const migrated = migrateGameState(state);
    expect(migrated.pendingFloorMilestoneOmenId).toBe(omenId);
    expect(migrated.shownFloorMilestoneIds).toEqual([omenId]);
  });
});

describe("Version migrations", () => {
  /** A real save stamped 1.1.0, with the party at level 3 and 70 EXP into it on 1.1.0's curve (230 to 345). */
  function writeV110Save(game: Game) {
    game.currentSaveSlot = "slot1";
    saveRun(game);
    const save = loadSave("slot1");
    save.meta.saveVersion = "1.1.0";
    for (const c of save.state.party) c.level = 3;
    save.state.partyExp = 300;
    writeFileSync(join(SAVE_DIR, "slot1.json"), JSON.stringify(save));
    return save;
  }
  const span = (level: number) => expCostForLevel(level + 1) - expCostForLevel(level);

  test("a 1.1.1 save with a Vanguard loads it as a Knight, at the same level and EXP", () => {
    withGame(25, (game) => {
      game.currentSaveSlot = "slot1";
      saveRun(game);
      const save = loadSave("slot1");
      save.meta.saveVersion = "1.1.1";
      const vanguard = save.state.party.find((c) => c.classId === "knight")!;
      vanguard.classId = "vanguard";
      vanguard.name = "Vanguard";
      save.state.retiredCharacterClassId = "vanguard";
      writeFileSync(join(SAVE_DIR, "slot1.json"), JSON.stringify(save));

      expect(listSlots()[0]!.meta?.saveVersion).toBe("1.1.1");
      const state = gameFromSave(loadSave("slot1"), "slot1").state;
      const knight = state.party.find((c) => c.id === vanguard.id)!;
      expect(knight.classId).toBe("knight");
      expect(knight.name).toBe(getClass("knight").name);
      expect(knight.level).toBe(vanguard.level);
      expect(state.partyExp).toBe(save.state.partyExp);
      expect(state.retiredCharacterClassId).toBe("knight");
    });
  });

  test("compareVersions orders versions field by field, numerically", () => {
    expect(compareVersions("1.1.0", "1.1.1")).toBeLessThan(0);
    expect(compareVersions("1.1.1", "1.2.0")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("1.1.1", "1.1.1")).toBe(0);
  });

  test("compareVersions refuses anything but an x.y.z version", () => {
    expect(() => compareVersions("1.2.0-rc.1", "1.1.0")).toThrow();
    expect(() => compareVersions("1.1.0", UNVERSIONED)).toThrow();
  });

  /** A party of `level` holding `partyExp`, as a 1.1.0 save would carry them. */
  const v110State = (level: number, partyExp: number): GameState => {
    const state = structuredClone(new Game(24, PARTY).state);
    for (const c of state.party) c.level = level;
    state.partyExp = partyExp;
    return state;
  };
  /** 1.1.0's cost to reach `level` for level 30 and up: 4960 to reach 30, then the same steps as now. */
  const v110CostFrom30 = (level: number) => 4960 + expCostForLevel(level) - expCostForLevel(30);

  test("EXP that does not fit the party's level on 1.1.0's curve is held inside that level", () => {
    const ahead = migrateGameState(v110State(3, 500), "1.1.0").partyExp;
    expect(levelForTotalExp(ahead)).toBe(3);
    expect(ahead).toBe(expCostForLevel(4) - 1);
    expect(migrateGameState(v110State(3, 100), "1.1.0").partyExp).toBe(expCostForLevel(3));
  });

  test("from level 30 on, where a level costs what it did, the EXP into the level is unchanged", () => {
    expect(migrateGameState(v110State(30, v110CostFrom30(30) + 100), "1.1.0").partyExp).toBe(expCostForLevel(30) + 100);
    expect(migrateGameState(v110State(45, v110CostFrom30(45) + 37), "1.1.0").partyExp).toBe(expCostForLevel(45) + 37);
    expect(migrateGameState(v110State(MAX_LEVEL, v110CostFrom30(MAX_LEVEL) + 50), "1.1.0").partyExp).toBe(expCostForLevel(MAX_LEVEL) + 50);
  });

  test("a 1.1.0 save loads with its level, its floor and its share of the way to the next level", () => {
    withGame(21, (game) => {
      const save = writeV110Save(game);
      expect(listSlots()[0]!.meta?.saveVersion).toBe("1.1.0");
      const state = gameFromSave(loadSave("slot1"), "slot1").state;
      expect(state.party.every((c) => c.level === 3)).toBe(true);
      expect(levelForTotalExp(state.partyExp)).toBe(3);
      expect(state.partyExp - expCostForLevel(3)).toBe(Math.floor((70 * span(3)) / 115));
      expect(state.floor.depth).toBe(save.state.floor.depth);
      expect(state.currentRoomId).toBe(save.state.currentRoomId);
      expect(state.roomPath).toEqual(save.state.roomPath);
    });
  });

  test("a 1.1.0 fight's party snapshots are rescaled at the level each one reached", () => {
    withGame(22, (game) => {
      const rat = spawnMonster("dungeon-rat", 1);
      game.ctx.monsters.push(rat);
      const room = getRoom(game.state.floor, game.state.currentRoomId);
      room.monsterIds = [rat.id];
      room.cleared = false;
      const combat = startCombat(room.id, [rat.id], game.ctx, false);
      combat.roundStartPartySnapshot = { coins: 0, partyExp: 100, satiety: 50 };
      combat.log.push({ text: "", kind: "info", partySnapshot: { coins: 0, partyExp: 300, satiety: 50 } });
      const state = structuredClone({ ...game.state, combat, partyExp: 300 });
      for (const c of state.party) c.level = 3;

      const migrated = migrateGameState(state, "1.1.0").combat!;
      expect(migrated.roundStartPartySnapshot!.partyExp).toBe(Math.floor((100 * span(1)) / 115));
      expect(migrated.log.at(-1)!.partySnapshot!.partyExp).toBe(expCostForLevel(3) + Math.floor((70 * span(3)) / 115));
    });
  });

  test("a save of the current version keeps its EXP, and a migrated save is not migrated again once resaved", () => {
    withGame(23, (game) => {
      writeV110Save(game);
      const loaded = gameFromSave(loadSave("slot1"), "slot1");
      const migratedExp = loaded.state.partyExp;
      saveRun(loaded);
      const resaved = loadSave("slot1");
      expect(resaved.meta.saveVersion).toBe(APP_VERSION);
      expect(gameFromSave(resaved, "slot1").state.partyExp).toBe(migratedExp);
      expect(migrateGameState(structuredClone(resaved.state), APP_VERSION).partyExp).toBe(migratedExp);
    });
  });
});

describe("a save taken mid-fight keeps a guard-room monster's state", () => {
  function midFight(game: Game) {
    game.currentSaveSlot = "slot1";
    const boss = spawnMonster("lich", 1, { tier: "boss" });
    const add = spawnMonster("skeleton", 1);
    add.summonerId = boss.id;
    add.expReward = 0;
    boss.telegraphMeter = 3;
    boss.enteredPhaseIndexes = [0];
    boss.skillCooldowns = { "ledger-mark": 2, "name-struck-out": 3 };
    boss.skillUses = { "name-struck-out": 1 };
    game.ctx.monsters.push(boss, add);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    // A second guard whose archetype does declare a shell; startCombat forms it, then it is set mid-break.
    const golem = spawnMonster("ancient-golem", 1, { tier: "boss" });
    game.ctx.monsters.push(golem);
    room.monsterIds = [boss.id, golem.id];
    room.cleared = false;
    game.state.combat = startCombat(room.id, [boss.id, add.id, golem.id], game.ctx, true);
    golem.shell = { state: "broken", hitsLeft: 0, ownTurnsSinceBreak: 1 };
    return { boss, add, golem };
  }
  const roundTrip = (game: Game) => {
    saveRun(game);
    return gameFromSave(loadSave("slot1"), "slot1");
  };

  test("meter, phase, cooldowns, uses, shell and summoner all come back", () => {
    withGame(14, (game) => {
      const { boss, add, golem } = midFight(game);
      const resumed = roundTrip(game);
      expect(resumed.ctx.monsters.find((m) => m.id === boss.id)).toEqual(boss);
      expect(resumed.ctx.monsters.find((m) => m.id === add.id)).toEqual(add);
      expect(resumed.ctx.monsters.find((m) => m.id === golem.id)).toEqual(golem);
      expect(resumed.state.combat!.combatants).toEqual(game.state.combat!.combatants);
    });
  });

  test("a monster saved mid-charge under the old charging field loads with a full meter", () => {
    withGame(16, (game) => {
      const { boss } = midFight(game);
      boss.telegraphMeter = undefined;
      saveRun(game);
      const save = loadSave("slot1");
      const saved = save.monsters.find((m) => m.id === boss.id) as typeof boss & { charging?: unknown };
      saved.charging = { skillId: "name-struck-out", targetIds: [] };
      const loaded = gameFromSave(save, "slot1").ctx.monsters.find((m) => m.id === boss.id)! as typeof boss & { charging?: unknown };
      expect(loaded.telegraphMeter).toBe(5);
      expect(loaded.charging).toBeUndefined();
    });
  });

  test("the Founder saved in phase 2 reloads in phase 2 with that bar's HP, max HP and meter", () => {
    withGame(17, (game) => {
      game.currentSaveSlot = "slot1";
      const founder = spawnMonster("the-founder", 1, { tier: "boss" });
      game.ctx.monsters.push(founder);
      const room = getRoom(game.state.floor, game.state.currentRoomId);
      room.monsterIds = [founder.id];
      room.cleared = false;
      game.state.combat = startCombat(room.id, [founder.id], game.ctx, true);
      advanceBar(founder);
      founder.barEntryPending = false;
      founder.hp -= 40;
      founder.telegraphMeter = 2;
      const loaded = roundTrip(game).ctx.monsters.find((m) => m.id === founder.id)!;
      expect(loaded).toEqual(founder);
      expect(loaded.barIndex).toBe(1);
      expect(loaded.maxHp).toBe(Math.round(founder.barBaseHp! * getArchetype("the-founder").bars![1]!.hpMultiplier));
      expect(loaded.hp).toBe(loaded.maxHp - 40);
      expect(loaded.telegraphMeter).toBe(2);
    });
  });

  test("a Founder saved before bars existed loads on bar 1 at the same share of HP, and emptying it moves him to bar 2", () => {
    const founder = spawnMonster("the-founder", 1, { tier: "boss" });
    const whole = founder.barBaseHp!;
    for (const key of ["barBaseHp", "barIndex", "barEntryPending"] as const) delete founder[key];
    founder.maxHp = whole;
    founder.hp = Math.round(whole / 2);
    const [loaded] = migrateMonsters([founder]);
    const bars = getArchetype("the-founder").bars!;
    expect(loaded!.barBaseHp).toBe(whole);
    expect(loaded!.barIndex).toBe(0);
    expect(loaded!.maxHp).toBe(Math.round(whole * bars[0]!.hpMultiplier));
    expect(loaded!.hp).toBe(Math.round(loaded!.maxHp / 2));
    expect(advanceBar(loaded!)).toBe(true);
    expect(loaded!.barIndex).toBe(1);
    expect(loaded!.hp).toBe(Math.round(whole * bars[1]!.hpMultiplier));
  });

  for (const [label, corrupt] of [
    ["a bar index past his last bar", (m: Monster) => { m.barIndex = 3; }],
    ["a fractional bar index", (m: Monster) => { m.barIndex = 0.5; }],
    ["a non-boolean entry flag", (m: Monster) => { (m as any).barEntryPending = "yes"; }],
  ] as const) {
    test(`a Founder save with ${label} is refused`, () => {
      withGame(18, (game) => {
        game.currentSaveSlot = "slot1";
        const founder = spawnMonster("the-founder", 1, { tier: "boss" });
        game.ctx.monsters.push(founder);
        const room = getRoom(game.state.floor, game.state.currentRoomId);
        room.monsterIds = [founder.id];
        room.cleared = false;
        game.state.combat = startCombat(room.id, [founder.id], game.ctx, true);
        saveRun(game);
        const save = loadSave("slot1");
        corrupt(save.monsters.find((m) => m.id === founder.id)!);
        expect(() => gameFromSave(save, "slot1")).toThrow(/validation/);
      });
    });
  }

  type Saved = ReturnType<typeof spawnMonster>;
  const shell = { state: "intact" as const, hitsLeft: 3, ownTurnsSinceBreak: 0 };
  const corruptions: [string, (boss: Saved, add: Saved, golem: Saved) => void][] = [
    ["a shell in an unknown state", (_b, _a, g) => { (g.shell as any).state = "cracked"; }],
    ["a shell with a fractional hit count", (_b, _a, g) => { g.shell!.hitsLeft = 1.5; }],
    ["a shell on a monster whose archetype has none", (m) => { m.shell = { ...shell }; }],
    ["a shell on a normal-tier monster", (_boss, add) => { add.shell = { ...shell }; }],
    ["a null shell", (_b, _a, g) => { (g as any).shell = null; }],
    ["a negative telegraph meter", (m) => { m.telegraphMeter = -1; }],
    ["a fractional telegraph meter", (m) => { m.telegraphMeter = 1.5; }],
    ["bar state on a boss whose archetype has no bars", (m) => { m.barIndex = 1; m.barBaseHp = 100; }],
    ["null cooldowns", (m) => { (m as any).skillCooldowns = null; }],
    ["a negative cooldown", (m) => { m.skillCooldowns!["ledger-mark"] = -1; }],
    ["a negative use count", (m) => { m.skillUses!["name-struck-out"] = -1; }],
    ["a phase index that is not an integer", (m) => { (m.enteredPhaseIndexes as any) = ["first"]; }],
    ["a summoner that is not in the saved list", (_boss, add) => { add.summonerId = "no-such-monster"; }],
  ];
  for (const [label, corrupt] of corruptions) {
    test(`a save with ${label} is refused, and its slot reads as empty`, () => {
      withGame(15, (game) => {
        const { boss, add, golem } = midFight(game);
        saveRun(game);
        const save = loadSave("slot1");
        const saved = (id: string) => save.monsters.find((m) => m.id === id)!;
        corrupt(saved(boss.id), saved(add.id), saved(golem.id));
        expect(() => gameFromSave(save, "slot1")).toThrow(/validation/);
        writeFileSync(join(SAVE_DIR, "slot1.json"), JSON.stringify(save));
        expect(listSlots().find((slot) => slot.id === "slot1")!.meta).toBeNull();
      });
    });
  }
});
