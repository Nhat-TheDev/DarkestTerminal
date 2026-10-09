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
import { migrateGameState, migrateMonsters, migrateSummons } from "../src/engine/migration";
import { getClass } from "../src/data/classes";
import { FLOOR_MILESTONE_OMENS, getFloorMilestoneOmen } from "../src/data/floorMilestones";
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
