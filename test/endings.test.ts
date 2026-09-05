import { describe, test, expect } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { CombatantRef } from "../src/types";
import { Game } from "../src/engine/game";
import { getRoom, pickEventText } from "../src/engine/dungeon";
import { BALANCE } from "../src/data/balanceConfig";
import {
  leaveTriggered,
  endingCheckpointMode,
  hasWaystoneShardEquipped,
  ENDING_CHECKPOINT_FLOOR_DEPTH,
  FOUNDER_FLOOR_DEPTH,
  FOUNDER_VICTORY_REMOVED_EVENT_IDS,
} from "../src/data/endings";
import { migrateGameState } from "../src/engine/migration";
import { loadProfile, addRetiredCharacter, markRetiredCharacterEventShown, PROFILE_FILENAME } from "../src/engine/profile";
import { EVENTS } from "../src/data/events";

function toFloor99(game: Game) {
  game.state.combat = null;
  game.state.floor.depth = 99;
}

function resetProfile() {
  const path = join(process.env.DARKEST_TERMINAL_SAVE_DIR!, PROFILE_FILENAME);
  if (existsSync(path)) rmSync(path);
}

describe("leaveTriggered / endingCheckpointMode (10-event-narrative.md §F.1)", () => {
  test("blood debt breaking triggers Leave", () => {
    const game = new Game(400);
    game.state.narrativeCounters.altarPaymentsCount = BALANCE.events.bloodDebtThreshold3;
    game.state.eventOutcomes["blood-altar"] = "declined";
    expect(leaveTriggered(game.state)).toBe(true);
    expect(endingCheckpointMode(game.state)).toBe("leaveOnly");
  });

  test("blood debt below tier-3, or last outcome 'paid', does not trigger Leave", () => {
    const game = new Game(401);
    game.state.narrativeCounters.altarPaymentsCount = BALANCE.events.bloodDebtThreshold3 - 1;
    game.state.eventOutcomes["blood-altar"] = "declined";
    expect(leaveTriggered(game.state)).toBe(false);

    const game2 = new Game(402);
    game2.state.narrativeCounters.altarPaymentsCount = BALANCE.events.bloodDebtThreshold3;
    game2.state.eventOutcomes["blood-altar"] = "paid";
    expect(leaveTriggered(game2.state)).toBe(false);
  });

  test("the free-take ledger never opening triggers Leave", () => {
    const game = new Game(403);
    game.state.narrativeCounters.freeRewardsTakenCount = BALANCE.events.freeTakenThreshold;
    expect(leaveTriggered(game.state)).toBe(true);
    expect(endingCheckpointMode(game.state)).toBe("leaveOnly");
  });

  test("free-take threshold reached but a cost was paid elsewhere does not trigger Leave", () => {
    const game = new Game(404);
    game.state.narrativeCounters.freeRewardsTakenCount = BALANCE.events.freeTakenThreshold;
    game.state.narrativeCounters.altarPaymentsCount = 1;
    expect(leaveTriggered(game.state)).toBe(false);
  });

  test("Camp Reflection tier 4 unlocks 'full' mode when Leave isn't triggered", () => {
    const game = new Game(405);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier4Threshold;
    expect(endingCheckpointMode(game.state)).toBe("full");
  });

  test("anything else falls back to 'stayOrLetGo'", () => {
    const game = new Game(406);
    expect(endingCheckpointMode(game.state)).toBe("stayOrLetGo");
  });

  test("Leave overrides 'full' when both conditions are somehow true at once", () => {
    const game = new Game(407);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier4Threshold;
    game.state.narrativeCounters.freeRewardsTakenCount = BALANCE.events.freeTakenThreshold;
    expect(endingCheckpointMode(game.state)).toBe("leaveOnly");
  });
});

describe("hasWaystoneShardEquipped", () => {
  test("true only when a party member has it equipped", () => {
    const game = new Game(408);
    expect(hasWaystoneShardEquipped(game.state)).toBe(false);
    game.state.party[0]!.equippedArtifactIds = ["waystone-shard"];
    expect(hasWaystoneShardEquipped(game.state)).toBe(true);
  });
});

describe("advanceToNextFloor's floor-100 checkpoint trigger", () => {
  test("sets pendingEndingCheckpoint exactly on reaching floor 100, blocking the entry room's own ambush", () => {
    const game = new Game(409);
    toFloor99(game);
    game.advanceToNextFloor();
    expect(game.state.floor.depth).toBe(ENDING_CHECKPOINT_FLOOR_DEPTH);
    expect(game.state.pendingEndingCheckpoint).toBe(true);
    expect(game.state.combat).toBeNull();
  });

  test("does not set it for any other floor", () => {
    const game = new Game(410);
    game.advanceToNextFloor();
    expect(game.state.floor.depth).toBe(2);
    expect(game.state.pendingEndingCheckpoint).toBe(false);
  });
});

describe("Game.pickEndingChoice", () => {
  test("no-ops if nothing is pending", () => {
    const game = new Game(411);
    game.pickEndingChoice("stay");
    expect(game.state.gameOver).toBeNull();
  });

  test("stay/letGo are rejected in 'leaveOnly' mode", () => {
    const game = new Game(412);
    toFloor99(game);
    game.state.narrativeCounters.freeRewardsTakenCount = BALANCE.events.freeTakenThreshold;
    game.advanceToNextFloor();
    game.pickEndingChoice("stay");
    expect(game.state.gameOver).toBeNull();
    expect(game.state.pendingEndingCheckpoint).toBe(true);
  });

  test("stay sets gameOver to 'stay' and clears the checkpoint", () => {
    const game = new Game(413);
    toFloor99(game);
    game.advanceToNextFloor();
    game.pickEndingChoice("stay");
    expect(game.state.gameOver).toBe("stay");
    expect(game.state.pendingEndingCheckpoint).toBe(false);
  });

  test("letGo sets gameOver to 'letGo'", () => {
    const game = new Game(414);
    toFloor99(game);
    game.advanceToNextFloor();
    game.pickEndingChoice("letGo");
    expect(game.state.gameOver).toBe("letGo");
  });

  test("continue is rejected outside 'full' mode and leaves the run playable", () => {
    const game = new Game(415);
    toFloor99(game);
    game.advanceToNextFloor();
    game.pickEndingChoice("continue");
    expect(game.state.gameOver).toBeNull();
    expect(game.state.pendingEndingCheckpoint).toBe(true);
  });

  test("continue proceeds without ending the run in 'full' mode", () => {
    const game = new Game(416);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier4Threshold;
    toFloor99(game);
    game.advanceToNextFloor();
    game.pickEndingChoice("continue");
    expect(game.state.gameOver).toBeNull();
    expect(game.state.pendingEndingCheckpoint).toBe(false);
  });

  test("'full' mode still allows stay/letGo directly, not only continue", () => {
    const game1 = new Game(4161);
    game1.state.loreExposureCount = BALANCE.survival.campReflectionTier4Threshold;
    toFloor99(game1);
    game1.advanceToNextFloor();
    game1.pickEndingChoice("stay");
    expect(game1.state.gameOver).toBe("stay");

    const game2 = new Game(4162);
    game2.state.loreExposureCount = BALANCE.survival.campReflectionTier4Threshold;
    toFloor99(game2);
    game2.advanceToNextFloor();
    game2.pickEndingChoice("letGo");
    expect(game2.state.gameOver).toBe("letGo");
  });

  test("leave is rejected outside 'leaveOnly' mode (both 'stayOrLetGo' and 'full')", () => {
    const game1 = new Game(4163); // stayOrLetGo (no triggers, no tier 4)
    toFloor99(game1);
    game1.advanceToNextFloor();
    game1.pickEndingChoice("leave");
    expect(game1.state.gameOver).toBeNull();
    expect(game1.state.pendingEndingCheckpoint).toBe(true);

    const game2 = new Game(4164); // full (tier 4, no Leave trigger)
    game2.state.loreExposureCount = BALANCE.survival.campReflectionTier4Threshold;
    toFloor99(game2);
    game2.advanceToNextFloor();
    game2.pickEndingChoice("leave");
    expect(game2.state.gameOver).toBeNull();
    expect(game2.state.pendingEndingCheckpoint).toBe(true);
  });

  test("stay/letGo/continue are all rejected once resolved (checkpoint already cleared)", () => {
    const game = new Game(4165);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier4Threshold;
    toFloor99(game);
    game.advanceToNextFloor();
    game.pickEndingChoice("stay");
    expect(game.state.gameOver).toBe("stay");
    game.pickEndingChoice("letGo"); // already resolved — must no-op
    expect(game.state.gameOver).toBe("stay");
  });

  test("leave resolves to 'leaveAmbushed' without the shard, 'leaveEscaped' with it equipped", () => {
    const game1 = new Game(417);
    toFloor99(game1);
    game1.state.narrativeCounters.freeRewardsTakenCount = BALANCE.events.freeTakenThreshold;
    game1.advanceToNextFloor();
    game1.pickEndingChoice("leave");
    expect(game1.state.gameOver).toBe("leaveAmbushed");

    const game2 = new Game(418);
    toFloor99(game2);
    game2.state.narrativeCounters.freeRewardsTakenCount = BALANCE.events.freeTakenThreshold;
    game2.state.party[0]!.equippedArtifactIds = ["waystone-shard"];
    game2.advanceToNextFloor();
    game2.pickEndingChoice("leave");
    expect(game2.state.gameOver).toBe("leaveEscaped");
  });
});

describe("migration default for pendingEndingCheckpoint", () => {
  test("defaults to false on a pre-Ending-System save", () => {
    const legacy = { party: [], inventory: {} } as unknown as Parameters<typeof migrateGameState>[0];
    const migrated = migrateGameState(legacy);
    expect(migrated.pendingEndingCheckpoint).toBe(false);
  });
});

describe("Part F.5: Continue → the founder encounter", () => {
  function toFloor119Continued(game: Game) {
    game.state.combat = null;
    game.state.continuedPastCheckpoint = true;
    game.state.floor.depth = 119;
  }

  test("continue marks continuedPastCheckpoint and leaves the run playable", () => {
    const game = new Game(419);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier4Threshold;
    toFloor99(game);
    game.advanceToNextFloor();
    game.pickEndingChoice("continue");
    expect(game.state.continuedPastCheckpoint).toBe(true);
    expect(game.state.gameOver).toBeNull();
  });

  test("reaching floor 120 after continuing sets pendingFounderDialogue, blocking the entry room's ambush", () => {
    const game = new Game(420);
    toFloor119Continued(game);
    game.advanceToNextFloor();
    expect(game.state.floor.depth).toBe(FOUNDER_FLOOR_DEPTH);
    expect(game.state.pendingFounderDialogue).toBe(true);
    expect(game.state.combat).toBeNull();
  });

  test("reaching floor 120 WITHOUT having continued does not trigger the founder dialogue", () => {
    const game = new Game(421);
    game.state.combat = null;
    game.state.floor.depth = 119;
    game.advanceToNextFloor();
    expect(game.state.floor.depth).toBe(FOUNDER_FLOOR_DEPTH);
    expect(game.state.pendingFounderDialogue).toBe(false);
  });

  test("enterFounderFight no-ops if nothing is pending", () => {
    const game = new Game(422);
    game.state.combat = null;
    game.enterFounderFight();
    expect(game.state.combat).toBeNull();
  });

  test("enterFounderFight spawns exactly 1 boss-tier 'the-founder' and starts combat in a boss room", () => {
    const game = new Game(423);
    toFloor119Continued(game);
    game.advanceToNextFloor();
    game.enterFounderFight();
    expect(game.state.pendingFounderDialogue).toBe(false);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    expect(room.type).toBe("boss");
    expect(room.monsterIds.length).toBe(1);
    const founder = game.ctx.monsters.find((m) => m.id === room.monsterIds[0]);
    expect(founder?.archetypeId).toBe("the-founder");
    expect(founder?.tier).toBe("boss");
    expect(game.state.combat).not.toBeNull();
  });

  test("defeating the founder bulk-inserts all 11 Covenant events into firedOnceEventIds", () => {
    const game = new Game(424, ["vanguard"]);
    toFloor119Continued(game);
    game.advanceToNextFloor();
    game.enterFounderFight();
    expect(FOUNDER_VICTORY_REMOVED_EVENT_IDS.length).toBe(11);
    for (const id of FOUNDER_VICTORY_REMOVED_EVENT_IDS) {
      expect(game.state.firedOnceEventIds).not.toContain(id);
    }

    const room = getRoom(game.state.floor, game.state.currentRoomId);
    const founder = game.ctx.monsters.find((m) => m.id === room.monsterIds[0])!;
    founder.hp = 1;
    const vanguard = game.state.party[0]!;
    const vanguardRef: CombatantRef = { kind: "character", id: vanguard.id };
    const founderRef: CombatantRef = { kind: "monster", id: founder.id };
    expect(game.queue(vanguardRef, "vanguard-slash", [founderRef])).toBeNull();
    game.resolve();

    expect(game.state.combat!.outcome).toBe("victory");
    for (const id of FOUNDER_VICTORY_REMOVED_EVENT_IDS) {
      expect(game.state.firedOnceEventIds).toContain(id);
    }
  });

  test("winning an ordinary boss fight never triggers the event-removal bulk-insert", () => {
    const game = new Game(425);
    toFloor99(game);
    game.advanceToNextFloor(); // floor 100 checkpoint
    game.pickEndingChoice("letGo");
    expect(FOUNDER_VICTORY_REMOVED_EVENT_IDS.some((id) => game.state.firedOnceEventIds.includes(id))).toBe(false);
  });
});

describe("migration defaults for continuedPastCheckpoint/pendingFounderDialogue", () => {
  test("both default to false on a pre-Ending-System save", () => {
    const legacy = { party: [], inventory: {} } as unknown as Parameters<typeof migrateGameState>[0];
    const migrated = migrateGameState(legacy);
    expect(migrated.continuedPastCheckpoint).toBe(false);
    expect(migrated.pendingFounderDialogue).toBe(false);
  });
});

describe("Part F.2: the cross-run persistence layer for Ending 1 (Stay)", () => {
  test("a fresh game with no retired characters excludes the-one-who-stayed and leaves retiredCharacterClassId null", () => {
    resetProfile();
    const game = new Game(500);
    expect(game.state.firedOnceEventIds).toContain("the-one-who-stayed");
    expect(game.state.retiredCharacterClassId).toBeNull();
  });

  test("a prior retirement makes a new game eligible, with the class filled in", () => {
    resetProfile();
    addRetiredCharacter("rogue");
    const game = new Game(501);
    expect(game.state.firedOnceEventIds).not.toContain("the-one-who-stayed");
    expect(game.state.retiredCharacterClassId).toBe("rogue");
  });

  test("already-shown (in a previous run) excludes it again even with retired characters present", () => {
    resetProfile();
    addRetiredCharacter("mage");
    markRetiredCharacterEventShown();
    const game = new Game(502);
    expect(game.state.firedOnceEventIds).toContain("the-one-who-stayed");
    expect(game.state.retiredCharacterClassId).toBeNull();
  });

  test("with multiple retired characters, the most recently retired one is used", () => {
    resetProfile();
    addRetiredCharacter("vanguard");
    addRetiredCharacter("acolyte");
    const game = new Game(503);
    expect(game.state.retiredCharacterClassId).toBe("acolyte");
  });

  test("choosing Stay persists the picked party member's class to the profile", () => {
    resetProfile();
    const game = new Game(504);
    toFloor99(game);
    game.advanceToNextFloor();
    game.pickEndingChoice("stay");
    const profile = loadProfile();
    expect(profile.retiredCharacters.length).toBe(1);
    expect(game.state.party.map((c) => c.classId)).toContain(profile.retiredCharacters[0]!.classId);
  });

  test("pickEventText substitutes {{class}} with the retired class's display name", () => {
    resetProfile();
    addRetiredCharacter("plague-doctor");
    const game = new Game(505);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    const event = EVENTS.find((e) => e.id === "the-one-who-stayed")!;
    const text = pickEventText(game.state, room, event);
    expect(text).not.toContain("{{class}}");
    expect(text).toContain("Plague Doctor");
  });

  test("resolving the-one-who-stayed marks it shown in the persisted profile, not just this run", () => {
    resetProfile();
    addRetiredCharacter("viking");
    const game = new Game(506);
    expect(loadProfile().shownRetiredCharacterEvent).toBe(false);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.type = "event";
    room.cleared = false;
    room.rolledEventId = "the-one-who-stayed";
    expect(game.openChest()).toBeNull();
    expect(loadProfile().shownRetiredCharacterEvent).toBe(true);
    expect(game.state.firedOnceEventIds).toContain("the-one-who-stayed");
  });

  test("a migrated pre-Ending-System save can never roll the event with no retired class recorded", () => {
    const legacy = { party: [], inventory: {} } as unknown as Parameters<typeof migrateGameState>[0];
    const migrated = migrateGameState(legacy);
    expect(migrated.retiredCharacterClassId).toBeNull();
    // Without this the event stays eligible on a migrated save and renders its raw placeholder.
    expect(migrated.firedOnceEventIds).toContain("the-one-who-stayed");
  });

  test("the raw {{class}} placeholder never reaches the player, even with no class recorded", () => {
    const game = new Game(508);
    game.state.retiredCharacterClassId = null;
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    const event = EVENTS.find((e) => e.id === "the-one-who-stayed")!;
    expect(pickEventText(game.state, room, event)).not.toContain("{{class}}");
  });

  test("only a living party member is ever recorded as the one who stayed", () => {
    resetProfile();
    const game = new Game(509, ["vanguard", "rogue"]);
    game.state.combat = null;
    game.state.party[0]!.isAlive = false; // vanguard dead, rogue alive
    game.state.floor.depth = 99;
    game.advanceToNextFloor();
    game.pickEndingChoice("stay");
    expect(loadProfile().retiredCharacters).toEqual([{ classId: "rogue" }]);
  });

  test("resolving it grants no artifact, matching Part E's 'just talk, no transaction' shape", () => {
    resetProfile();
    addRetiredCharacter("rogue");
    const game = new Game(507);
    const before = game.state.party[0]!.equippedArtifactIds.length;
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.type = "event";
    room.cleared = false;
    room.rolledEventId = "the-one-who-stayed";
    game.openChest();
    expect(game.state.party[0]!.equippedArtifactIds.length).toBe(before);
    expect(game.state.pendingArtifactDecision).toBeFalsy();
  });
});
