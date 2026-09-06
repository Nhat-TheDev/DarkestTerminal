import { describe, test, expect } from "bun:test";
import { Game } from "../src/engine/game";
import { getRoom, moveToRoom, pickEventText } from "../src/engine/dungeon";
import { EVENTS } from "../src/data/events";
import { BALANCE } from "../src/data/balanceConfig";
import { campReflectionTier, highestAnsweredCampReflectionTier, LORE_EXPOSURE_EVENT_IDS } from "../src/data/loreExposure";
import { migrateGameState } from "../src/engine/migration";

function forceEventRoom(game: Game, eventId: string) {
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  room.type = "event";
  room.cleared = false;
  room.rolledEventId = eventId;
  return room;
}

function forceRestRoom(game: Game) {
  const target = game.connectedRoomChoices()[0]!;
  const room = getRoom(game.state.floor, target.id);
  room.type = "rest";
  room.cleared = false;
  return { target, room };
}

describe("campReflectionTier (03-survival-stats.md)", () => {
  test("thresholds match balance-config.json exactly, skip-to-highest, no partial credit", () => {
    expect(campReflectionTier(0)).toBeNull();
    expect(campReflectionTier(BALANCE.survival.campReflectionTier1Threshold - 1)).toBeNull();
    expect(campReflectionTier(BALANCE.survival.campReflectionTier1Threshold)).toBe(1);
    expect(campReflectionTier(BALANCE.survival.campReflectionTier2Threshold - 1)).toBe(1);
    expect(campReflectionTier(BALANCE.survival.campReflectionTier2Threshold)).toBe(2);
    expect(campReflectionTier(BALANCE.survival.campReflectionTier3Threshold - 1)).toBe(2);
    expect(campReflectionTier(BALANCE.survival.campReflectionTier3Threshold)).toBe(3);
    expect(campReflectionTier(BALANCE.survival.campReflectionTier4Threshold - 1)).toBe(3);
    expect(campReflectionTier(BALANCE.survival.campReflectionTier4Threshold)).toBe(4);
  });

  test("a single jump straight past tier 1-2 resolves to tier 3, not tier 1", () => {
    expect(campReflectionTier(BALANCE.survival.campReflectionTier3Threshold)).toBe(3);
  });

  test("highestAnsweredCampReflectionTier reads the max key, or 0 if empty", () => {
    expect(highestAnsweredCampReflectionTier({})).toBe(0);
    expect(highestAnsweredCampReflectionTier({ 1: 0, 3: 2 })).toBe(3);
  });

  test("LORE_EXPOSURE_EVENT_IDS excludes only open-chest", () => {
    expect(LORE_EXPOSURE_EVENT_IDS.has("open-chest")).toBe(false);
    for (const event of EVENTS) {
      if (event.id === "open-chest") continue;
      expect(LORE_EXPOSURE_EVENT_IDS.has(event.id)).toBe(true);
    }
  });
});

describe("loreExposureCount tracking", () => {
  test("resolving open-chest never increments it", () => {
    const game = new Game(300);
    forceEventRoom(game, "open-chest");
    game.openChest();
    expect(game.state.loreExposureCount).toBe(0);
  });

  test("resolving any other event increments it by 1, including a decline", () => {
    const game = new Game(301);
    forceEventRoom(game, "blood-altar");
    game.bloodAltarLeave();
    expect(game.state.loreExposureCount).toBe(1);
  });

  test("old-count (a Chain 4 free-take id, but still lore-exposed) increments it too", () => {
    const game = new Game(302);
    forceEventRoom(game, "old-count");
    game.openChest();
    expect(game.state.loreExposureCount).toBe(1);
  });
});

describe("rest-room entry sets pendingCampReflectionTier", () => {
  test("does nothing below tier 1's threshold", () => {
    const game = new Game(303);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier1Threshold - 1;
    const { target } = forceRestRoom(game);
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.pendingCampReflectionTier).toBeNull();
  });

  test("sets tier 1 once its threshold is reached", () => {
    const game = new Game(304);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier1Threshold;
    const { target } = forceRestRoom(game);
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.pendingCampReflectionTier).toBe(1);
  });

  test("skip-to-highest: jumping straight to tier 3 sets tier 3, never backfilling tier 1/2", () => {
    const game = new Game(305);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier3Threshold;
    const { target } = forceRestRoom(game);
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.pendingCampReflectionTier).toBe(3);
    game.pickCampReflectionChoice(0);
    expect(game.state.campReflectionChoices).toEqual({ 3: 0 });
  });

  test("a tier already answered never re-triggers on a later rest visit at the same lore level", () => {
    const game = new Game(306);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier1Threshold;
    const { target: t1 } = forceRestRoom(game);
    moveToRoom(game.state, t1.id, game.ctx);
    expect(game.state.pendingCampReflectionTier).toBe(1);
    game.pickCampReflectionChoice(1);

    const t2 = game.connectedRoomChoices().find((r) => r.id !== t1.id) ?? game.connectedRoomChoices()[0]!;
    const room2 = getRoom(game.state.floor, t2.id);
    room2.type = "rest";
    room2.cleared = false;
    moveToRoom(game.state, t2.id, game.ctx);
    expect(game.state.pendingCampReflectionTier).toBeNull();
  });

  test("skipped entirely if an event reflection is already pending", () => {
    const game = new Game(307);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier1Threshold;
    game.state.pendingReflection = { eventId: "merchant" };
    const { target } = forceRestRoom(game);
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.pendingCampReflectionTier).toBeNull();
  });

  test("re-entering the same still-pending rest room doesn't reset the tier", () => {
    const game = new Game(308);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier1Threshold;
    const { target } = forceRestRoom(game);
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.pendingCampReflectionTier).toBe(1);
    moveToRoom(game.state, target.id, game.ctx); // re-entry, room still not cleared
    expect(game.state.pendingCampReflectionTier).toBe(1);
  });
});

describe("Game.pickCampReflectionChoice", () => {
  test("no-ops if nothing is pending", () => {
    const game = new Game(309);
    game.pickCampReflectionChoice(0);
    expect(game.state.campReflectionChoices).toEqual({});
  });

  test("records the choice, clears the pending tier, and writes the tier-4 bridge tag only at tier 4", () => {
    const game = new Game(310);
    game.state.loreExposureCount = BALANCE.survival.campReflectionTier1Threshold;
    const { target } = forceRestRoom(game);
    moveToRoom(game.state, target.id, game.ctx);
    game.pickCampReflectionChoice(2);
    expect(game.state.campReflectionChoices).toEqual({ 1: 2 });
    expect(game.state.pendingCampReflectionTier).toBeNull();
    expect(game.state.eventOutcomes["camp-reflection"]).toBeUndefined();

    game.state.loreExposureCount = BALANCE.survival.campReflectionTier4Threshold;
    const { target: t2 } = forceRestRoom(game);
    moveToRoom(game.state, t2.id, game.ctx);
    expect(game.state.pendingCampReflectionTier).toBe(4);
    game.pickCampReflectionChoice(0);
    expect(game.state.eventOutcomes["camp-reflection"]).toBe("unaware");
  });
});

describe("wandering-hermit's camp-reflection bridge (both forms)", () => {
  test("crossEventVariant wins on a 1st meeting once the tag is set", () => {
    const game = new Game(311);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    const event = EVENTS.find((e) => e.id === "wandering-hermit")!;
    game.state.eventOutcomes["camp-reflection"] = "unaware";
    const bridgeVariant = event.crossEventVariants!.find((v) => v.when.some((c) => c.eventId === "camp-reflection"))!;
    expect(pickEventText(game.state, room, event)).toBe(bridgeVariant.description);
  });

  test("campReflectionUnawareEcho is appended on a repeat visit instead, since returnDescription wins there", () => {
    const game = new Game(312);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    const event = EVENTS.find((e) => e.id === "wandering-hermit")!;
    game.state.metNarrativeNpcIds.push("wandering-hermit");
    game.state.eventOutcomes["camp-reflection"] = "unaware";
    const text = pickEventText(game.state, room, event);
    expect(text).toContain(event.returnDescription as string);
    expect(text).toContain(event.campReflectionUnawareEcho as string);
  });

  test("neither form shows without the tag", () => {
    const game = new Game(313);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    const event = EVENTS.find((e) => e.id === "wandering-hermit")!;
    game.state.metNarrativeNpcIds.push("wandering-hermit");
    expect(pickEventText(game.state, room, event)).toBe(event.returnDescription as string);
  });
});

describe("migration defaults for Camp Reflection's 3 new fields", () => {
  test("fills in loreExposureCount/pendingCampReflectionTier/campReflectionChoices on a pre-Camp-Reflection save", () => {
    const legacy = { party: [], inventory: {} } as unknown as Parameters<typeof migrateGameState>[0];
    const migrated = migrateGameState(legacy);
    expect(migrated.loreExposureCount).toBe(0);
    expect(migrated.pendingCampReflectionTier).toBeNull();
    expect(migrated.campReflectionChoices).toEqual({});
  });
});
