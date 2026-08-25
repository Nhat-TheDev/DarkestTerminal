import { describe, test, expect } from "bun:test";
import { Rng } from "../src/engine/rng";
import { getRoom, moveToRoom } from "../src/engine/dungeon";
import { rollArtifactWithMinRarity, rollArtifactOrCursed, getArtifact } from "../src/data/artifacts";
import { rollEvent, EVENTS } from "../src/data/events";
import { survivalDrainMultiplier, curseAggroBoostSum } from "../src/engine/artifacts";
import { Game } from "../src/engine/game";
import { makeCtx } from "./helpers";

function forceEventRoom(game: Game, eventId: string) {
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  room.type = "event";
  room.cleared = false;
  room.rolledEventId = eventId;
  return room;
}

describe("events (docs/gameplay-decisions/08-events.md)", () => {
  test("rollEvent: only picks ids from the 2 tiers, roughly 65% Common / 35% Rare", () => {
    const rng = new Rng(3);
    const commonIds = new Set(EVENTS.filter((e) => e.tier === "common").map((e) => e.id));
    const rareIds = new Set(EVENTS.filter((e) => e.tier === "rare").map((e) => e.id));
    let commonCount = 0;
    const total = 4000;
    for (let i = 0; i < total; i++) {
      const id = rollEvent(rng);
      expect(commonIds.has(id) || rareIds.has(id)).toBe(true);
      if (commonIds.has(id)) commonCount++;
    }
    expect(commonCount / total).toBeGreaterThan(0.6);
    expect(commonCount / total).toBeLessThan(0.7);
  });

  test("rollArtifactWithMinRarity('rare', ...) never rolls Common, matches §8.9's 60/30/10 Rare/Unique/Epic split", () => {
    const rng = new Rng(4);
    const counts: Record<string, number> = {};
    const total = 6000;
    for (let i = 0; i < total; i++) {
      const rarity = getArtifact(rollArtifactWithMinRarity("rare", rng)).rarity;
      counts[rarity] = (counts[rarity] ?? 0) + 1;
    }
    expect(counts["common"] ?? 0).toBe(0);
    expect((counts["rare"] ?? 0) / total).toBeGreaterThan(0.55);
    expect((counts["rare"] ?? 0) / total).toBeLessThan(0.65);
    expect((counts["epic"] ?? 0) / total).toBeGreaterThan(0.06);
    expect((counts["epic"] ?? 0) / total).toBeLessThan(0.14);
  });

  test("rollArtifactWithMinRarity('epic', ...) always returns an Epic", () => {
    const rng = new Rng(6);
    for (let i = 0; i < 20; i++) expect(getArtifact(rollArtifactWithMinRarity("epic", rng)).rarity).toBe("epic");
  });

  test("rollArtifactOrCursed fires the Cursed pool close to 30% of the time", () => {
    const rng = new Rng(7);
    let cursedCount = 0;
    const total = 4000;
    for (let i = 0; i < total; i++) {
      if (getArtifact(rollArtifactOrCursed(rng)).isCursed) cursedCount++;
    }
    expect(cursedCount / total).toBeGreaterThan(0.24);
    expect(cursedCount / total).toBeLessThan(0.36);
  });

  test("moveToRoom auto-resolves open-chest: grants 1 Artifact immediately and clears the room", () => {
    const game = new Game(1);
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "open-chest";
    const before = game.state.unequippedArtifactIds.length;
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.unequippedArtifactIds.length).toBe(before + 1);
    expect(room.cleared).toBe(true);
  });

  test("moveToRoom auto-resolves guardian-fight: starts combat with 1-2 scaled monsters", () => {
    const game = new Game(2);
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "guardian-fight";
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.combat).not.toBeNull();
    expect(room.monsterIds.length).toBeGreaterThanOrEqual(1);
    expect(room.monsterIds.length).toBeLessThanOrEqual(2);
  });

  test("moveToRoom pre-rolls merchant offers into activeEvent (2-3 artifacts)", () => {
    const game = new Game(3);
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "merchant";
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.activeEvent?.eventId).toBe("merchant");
    const offers = game.state.activeEvent?.offerArtifactIds ?? [];
    expect(offers.length).toBeGreaterThanOrEqual(2);
    expect(offers.length).toBeLessThanOrEqual(3);
  });

  test("merchantPurchase deducts HP price by rarity and grants the artifact; rejects a payer with too little HP", () => {
    const game = new Game(4);
    forceEventRoom(game, "merchant");
    const payer = game.state.party[0]!;
    game.state.activeEvent = { eventId: "merchant", offerArtifactIds: ["iron-gauntlet"] };
    const before = payer.hp;
    const cost = Math.floor((payer.maxHp * 15) / 100);
    expect(game.merchantPurchase(0, payer.id)).toBeNull();
    expect(payer.hp).toBe(before - cost);
    expect(game.state.unequippedArtifactIds).toContain("iron-gauntlet");
    expect(getRoom(game.state.floor, game.state.currentRoomId).cleared).toBe(true);

    const game2 = new Game(5);
    forceEventRoom(game2, "merchant");
    const poorPayer = game2.state.party[0]!;
    poorPayer.hp = 1;
    game2.state.activeEvent = { eventId: "merchant", offerArtifactIds: ["iron-gauntlet"] };
    expect(game2.merchantPurchase(0, poorPayer.id)).not.toBeNull();
  });

  test("bloodAltarPay pays a fixed 25% maxHP for 1 fully random artifact", () => {
    const game = new Game(6);
    forceEventRoom(game, "blood-altar");
    const c = game.state.party[0]!;
    const before = c.hp;
    const cost = Math.floor((c.maxHp * 25) / 100);
    const beforeCount = game.state.unequippedArtifactIds.length;
    expect(game.bloodAltarPay(c.id)).toBeNull();
    expect(c.hp).toBe(before - cost);
    expect(game.state.unequippedArtifactIds.length).toBe(beforeCount + 1);
  });

  test("cursedShrineDecide: accept grants the pre-rolled offer, decline grants nothing", () => {
    const game = new Game(7);
    forceEventRoom(game, "cursed-shrine");
    game.state.activeEvent = { eventId: "cursed-shrine", offerArtifactIds: ["blackened-locket"] };
    expect(game.cursedShrineDecide(true)).toBeNull();
    expect(game.state.unequippedArtifactIds).toContain("blackened-locket");

    const game2 = new Game(8);
    forceEventRoom(game2, "cursed-shrine");
    game2.state.activeEvent = { eventId: "cursed-shrine", offerArtifactIds: ["blackened-locket"] };
    expect(game2.cursedShrineDecide(false)).toBeNull();
    expect(game2.state.unequippedArtifactIds).not.toContain("blackened-locket");
  });

  test("twinAltarsChoose equips the chosen offer immediately, discards the other, and requires an unequip pick when full", () => {
    const game = new Game(9);
    forceEventRoom(game, "twin-altars");
    game.state.activeEvent = { eventId: "twin-altars", offerArtifactIds: ["iron-gauntlet", "sharp-claw"] };
    const c = game.state.party[0]!;
    expect(game.twinAltarsChoose(0, c.id)).toBeNull();
    expect(c.equippedArtifactIds).toContain("iron-gauntlet");
    expect(game.state.unequippedArtifactIds).not.toContain("sharp-claw");

    const game2 = new Game(10);
    const c2 = game2.state.party[0]!;
    game2.state.unequippedArtifactIds.push("ancient-sword", "heart-of-stone", "eternal-vial");
    expect(game2.equipArtifact(c2.id, "ancient-sword")).toBeNull();
    expect(game2.equipArtifact(c2.id, "heart-of-stone")).toBeNull();
    expect(game2.equipArtifact(c2.id, "eternal-vial")).toBeNull();
    forceEventRoom(game2, "twin-altars");
    game2.state.activeEvent = { eventId: "twin-altars", offerArtifactIds: ["iron-gauntlet", "sharp-claw"] };
    expect(game2.twinAltarsChoose(0, c2.id)).not.toBeNull();
    expect(game2.twinAltarsChoose(0, c2.id, "ancient-sword")).toBeNull();
    expect(c2.equippedArtifactIds).toContain("iron-gauntlet");
    expect(c2.equippedArtifactIds).not.toContain("ancient-sword");
    expect(game2.state.unequippedArtifactIds).toContain("ancient-sword");
  });

  test("sacrifice consumes the sacrificed artifact and rolls at/above its rarity; room only closes via sacrificeLeave", () => {
    const game = new Game(11);
    forceEventRoom(game, "sacrificial-circle");
    let sawSubUnique = false;
    for (let i = 0; i < 60 && !sawSubUnique; i++) {
      game.state.unequippedArtifactIds = ["scholars-insight"];
      expect(game.sacrifice("scholars-insight")).toBeNull();
      const rarity = getArtifact(game.state.unequippedArtifactIds[0]!).rarity;
      if (rarity === "common" || rarity === "rare") sawSubUnique = true;
    }
    expect(sawSubUnique).toBe(false);
    expect(getRoom(game.state.floor, game.state.currentRoomId).cleared).toBe(false);
    game.sacrificeLeave();
    expect(getRoom(game.state.floor, game.state.currentRoomId).cleared).toBe(true);
  });

  test("gamblingDenBet: win adds a same-rarity artifact, lose removes the bet permanently", () => {
    let won = false;
    let lost = false;
    for (let seed = 1; seed < 60 && !(won && lost); seed++) {
      const game = new Game(seed);
      forceEventRoom(game, "gambling-den");
      game.state.unequippedArtifactIds = ["iron-gauntlet"];
      expect(game.gamblingDenBet("iron-gauntlet")).toBeNull();
      if (game.state.unequippedArtifactIds.length === 2 && game.state.unequippedArtifactIds.includes("iron-gauntlet")) won = true;
      if (game.state.unequippedArtifactIds.length === 0) lost = true;
    }
    expect(won).toBe(true);
    expect(lost).toBe(true);
  });

  test("hermitRemoveCurse deletes a Cursed Artifact entirely (not returned to the pool)", () => {
    const game = new Game(12);
    forceEventRoom(game, "wandering-hermit");
    const c = game.state.party[0]!;
    game.state.unequippedArtifactIds.push("blackened-locket");
    expect(game.equipArtifact(c.id, "blackened-locket")).toBeNull();
    expect(game.hermitRemoveCurse(c.id, "blackened-locket")).toBeNull();
    expect(c.equippedArtifactIds).not.toContain("blackened-locket");
    expect(game.state.unequippedArtifactIds).not.toContain("blackened-locket");
  });

  test("hermitRerollFortune trades any owned artifact (auto-unequipping first) for a new random roll", () => {
    const game = new Game(13);
    forceEventRoom(game, "wandering-hermit");
    const c = game.state.party[0]!;
    game.state.unequippedArtifactIds.push("iron-gauntlet");
    expect(game.equipArtifact(c.id, "iron-gauntlet")).toBeNull();
    const beforeCount = game.state.unequippedArtifactIds.length + c.equippedArtifactIds.length;
    expect(game.hermitRerollFortune("iron-gauntlet")).toBeNull();
    expect(c.equippedArtifactIds).not.toContain("iron-gauntlet");
    expect(game.state.unequippedArtifactIds).not.toContain("iron-gauntlet");
    expect(game.state.unequippedArtifactIds.length + c.equippedArtifactIds.length).toBe(beforeCount);
  });

  test("collapsedFloorAttempt pays a fixed HP cost, then grants a Unique/Epic artifact on the 60% success roll", () => {
    let sawSuccess = false;
    let sawFailure = false;
    for (let seed = 1; seed < 60 && !(sawSuccess && sawFailure); seed++) {
      const game = new Game(seed);
      forceEventRoom(game, "collapsed-floor");
      const c = game.state.party[0]!;
      const hpBefore = c.hp;
      const before = game.state.unequippedArtifactIds.length;
      expect(game.collapsedFloorAttempt(c.id)).toBeNull();
      expect(c.hp).toBeLessThan(hpBefore);
      if (game.state.unequippedArtifactIds.length > before) {
        const gained = game.state.unequippedArtifactIds[game.state.unequippedArtifactIds.length - 1]!;
        expect(["unique", "epic"]).toContain(getArtifact(gained).rarity);
        sawSuccess = true;
      } else {
        sawFailure = true;
      }
    }
    expect(sawSuccess).toBe(true);
    expect(sawFailure).toBe(true);
  });

  test("curseAggroBoost adds flat aggro, curseDrainBoost speeds up survival drain", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedArtifactIds.push("unstable-core");
    expect(curseAggroBoostSum(c)).toBe(25);

    const { ctx: ctx2 } = makeCtx();
    const c2 = ctx2.party[0]!;
    c2.equippedArtifactIds.push("shackle-of-hunger");
    expect(survivalDrainMultiplier(c2)).toBeCloseTo(1.3);
  });

  test("recomputeCharacterStats folds curseAggroBoost into character.aggro on equip", () => {
    const game = new Game(14);
    const c = game.state.party[0]!;
    const baseAggro = c.aggro;
    game.state.unequippedArtifactIds.push("unstable-core");
    expect(game.equipArtifact(c.id, "unstable-core")).toBeNull();
    expect(c.aggro).toBe(baseAggro + 25);
    expect(game.unequipArtifact(c.id, "unstable-core")).toBeNull();
    expect(c.aggro).toBe(baseAggro);
  });
});

