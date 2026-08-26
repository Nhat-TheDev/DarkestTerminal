import { describe, test, expect } from "bun:test";
import { Rng } from "../src/engine/rng";
import { getRoom, moveToRoom } from "../src/engine/dungeon";
import { rollArtifactWithMinRarity, rollArtifactOrCursed, getArtifact } from "../src/data/artifacts";
import { rollEvent, EVENTS } from "../src/data/events";
import { curseAggroBoostSum } from "../src/engine/artifacts";
import { removeArtifactFromCharacter } from "../src/engine/party";
import { MERCHANT_PRICE_COINS } from "../src/engine/events/merchant";
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

  test("moveToRoom auto-resolves open-chest: grants 1 Artifact as a pending decision and clears the room (A.2)", () => {
    const game = new Game(1);
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "open-chest";
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.pendingArtifactDecision).not.toBeNull();
    expect(game.state.pendingArtifactDecision!.forceEquip).toBe(false);
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

  test("moveToRoom pre-rolls a fixed 4 merchant offers into activeEvent, refreshCount starts at 0", () => {
    const game = new Game(3);
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "merchant";
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.activeEvent?.eventId).toBe("merchant");
    expect(game.state.activeEvent?.offerArtifactIds).toHaveLength(4);
    expect(game.state.activeEvent?.refreshCount).toBe(0);
  });

  test("merchantPurchase deducts coins by rarity and grants the artifact as a pending decision; rejects when short on coins", () => {
    const game = new Game(4);
    forceEventRoom(game, "merchant");
    game.state.activeEvent = { eventId: "merchant", offerArtifactIds: ["iron-gauntlet"], refreshCount: 0 };
    const cost = MERCHANT_PRICE_COINS[getArtifact("iron-gauntlet").rarity];
    game.state.coins = cost;
    expect(game.merchantPurchase(0)).toBeNull();
    expect(game.state.coins).toBe(0);
    expect(game.state.pendingArtifactDecision?.artifactId).toBe("iron-gauntlet");
    expect(getRoom(game.state.floor, game.state.currentRoomId).cleared).toBe(true);

    const game2 = new Game(5);
    forceEventRoom(game2, "merchant");
    game2.state.activeEvent = { eventId: "merchant", offerArtifactIds: ["iron-gauntlet"], refreshCount: 0 };
    game2.state.coins = cost - 1;
    expect(game2.merchantPurchase(0)).not.toBeNull();
  });

  test("merchantRefresh re-rolls all 4 offers, costs 10 coins, capped at 3 uses per visit", () => {
    const game = new Game(6);
    forceEventRoom(game, "merchant");
    game.state.activeEvent = { eventId: "merchant", offerArtifactIds: ["iron-gauntlet", "sharp-claw", "ancient-sword", "heart-of-stone"], refreshCount: 0 };
    game.state.coins = 100;
    expect(game.merchantRefresh()).toBeNull();
    expect(game.state.coins).toBe(90);
    expect(game.state.activeEvent?.refreshCount).toBe(1);
    expect(game.merchantRefresh()).toBeNull();
    expect(game.merchantRefresh()).toBeNull();
    expect(game.state.activeEvent?.refreshCount).toBe(3);
    expect(game.merchantRefresh()).not.toBeNull(); // exhausted
  });

  test("bloodAltarPay pays a fixed 25% maxHP for 1 fully random artifact, granted as a pending decision", () => {
    const game = new Game(7);
    forceEventRoom(game, "blood-altar");
    const c = game.state.party[0]!;
    const before = c.hp;
    const cost = Math.floor((c.maxHp * 25) / 100);
    expect(game.bloodAltarPay(c.id)).toBeNull();
    expect(c.hp).toBe(before - cost);
    expect(game.state.pendingArtifactDecision).not.toBeNull();
  });

  test("cursedShrineDecide: accept grants the pre-rolled offer as a pending decision, decline grants nothing", () => {
    const game = new Game(8);
    forceEventRoom(game, "cursed-shrine");
    game.state.activeEvent = { eventId: "cursed-shrine", offerArtifactIds: ["blackened-locket"] };
    expect(game.cursedShrineDecide(true)).toBeNull();
    expect(game.state.pendingArtifactDecision?.artifactId).toBe("blackened-locket");
    expect(game.state.pendingArtifactDecision?.forceEquip).toBe(true); // isCursed auto-detected

    const game2 = new Game(9);
    forceEventRoom(game2, "cursed-shrine");
    game2.state.activeEvent = { eventId: "cursed-shrine", offerArtifactIds: ["blackened-locket"] };
    expect(game2.cursedShrineDecide(false)).toBeNull();
    expect(game2.state.pendingArtifactDecision).toBeNull();
  });

  test("twinAltarsChoose reveals+picks 1 of 2 as a forced pending decision; resolveArtifactEquip then requires a replacement when full", () => {
    const game = new Game(10);
    forceEventRoom(game, "twin-altars");
    game.state.activeEvent = { eventId: "twin-altars", offerArtifactIds: ["iron-gauntlet", "sharp-claw"] };
    const c = game.state.party[0]!;
    expect(game.twinAltarsChoose(0)).toBeNull();
    expect(game.state.pendingArtifactDecision).toEqual({ artifactId: "iron-gauntlet", forceEquip: true, source: "event" });
    expect(game.resolveArtifactEquip(c.id)).toBeNull();
    expect(c.equippedArtifactIds).toContain("iron-gauntlet");

    const game2 = new Game(11);
    const c2 = game2.state.party[0]!;
    for (const id of ["ancient-sword", "heart-of-stone", "eternal-vial"]) {
      game2.state.pendingArtifactDecision = { artifactId: id, forceEquip: false, source: "event" };
      expect(game2.resolveArtifactEquip(c2.id)).toBeNull();
    }
    forceEventRoom(game2, "twin-altars");
    game2.state.activeEvent = { eventId: "twin-altars", offerArtifactIds: ["iron-gauntlet", "sharp-claw"] };
    expect(game2.twinAltarsChoose(0)).toBeNull();
    expect(game2.resolveArtifactEquip(c2.id)).not.toBeNull(); // full, no replaceArtifactId
    expect(game2.resolveArtifactEquip(c2.id, "ancient-sword")).toBeNull();
    expect(c2.equippedArtifactIds).toContain("iron-gauntlet");
    expect(c2.equippedArtifactIds).not.toContain("ancient-sword");
  });

  test("sacrifice removes a currently-equipped artifact and rolls at/above its rarity as a pending decision", () => {
    const game = new Game(12);
    forceEventRoom(game, "sacrificial-circle");
    const c = game.state.party[0]!;
    let sawSubUnique = false;
    for (let i = 0; i < 60 && !sawSubUnique; i++) {
      c.equippedArtifactIds = ["scholars-insight"];
      expect(game.sacrifice("scholars-insight")).toBeNull();
      const rarity = getArtifact(game.state.pendingArtifactDecision!.artifactId).rarity;
      if (rarity === "common" || rarity === "rare") sawSubUnique = true;
      game.state.pendingArtifactDecision = null;
    }
    expect(sawSubUnique).toBe(false);
    expect(getRoom(game.state.floor, game.state.currentRoomId).cleared).toBe(false);
    game.sacrificeLeave();
    expect(getRoom(game.state.floor, game.state.currentRoomId).cleared).toBe(true);
  });

  test("gambling den: Enter rolls round 1, Continue restakes the whole pot, Stop banks it, a loss ends the event empty-handed", () => {
    let sawWin = false;
    let sawLoss = false;
    for (let seed = 1; seed < 100 && !(sawWin && sawLoss); seed++) {
      const game = new Game(seed);
      forceEventRoom(game, "gambling-den");
      game.state.activeEvent = { eventId: "gambling-den", offerArtifactIds: [] };
      game.state.coins = 20;
      expect(game.gamblingDenEnter()).toBeNull();
      expect(game.state.coins).toBe(0);
      const gamble = game.state.activeEvent?.gambleState;
      if (gamble) {
        expect(gamble.pot).toBe(40);
        expect(game.gamblingDenStop()).toBeNull();
        expect(game.state.coins).toBe(40);
        sawWin = true;
      } else {
        sawLoss = true;
      }
    }
    expect(sawWin).toBe(true);
    expect(sawLoss).toBe(true);
  });

  test("gambling den round 4 win awards 2 Epic artifacts, resolved sequentially (A.3)", () => {
    let seed = 1;
    let jackpotHit = false;
    for (; seed < 400 && !jackpotHit; seed++) {
      const game = new Game(seed);
      forceEventRoom(game, "gambling-den");
      game.state.activeEvent = { eventId: "gambling-den", offerArtifactIds: [] };
      game.state.coins = 20;
      game.gamblingDenEnter();
      for (let round = 1; round <= 3 && game.state.activeEvent?.gambleState; round++) {
        game.gamblingDenContinue();
      }
      if (game.state.pendingArtifactDecision && !game.state.activeEvent?.gambleState) {
        jackpotHit = true;
        expect(getArtifact(game.state.pendingArtifactDecision.artifactId).rarity).toBe("epic");
        expect(game.state.secondJackpotArtifactId).not.toBeNull();
        const c = game.state.party[0]!;
        expect(game.resolveArtifactEquip(c.id)).toBeNull();
        // the 2nd jackpot artifact chains in automatically once the 1st decision resolves
        expect(game.state.pendingArtifactDecision).not.toBeNull();
        expect(getArtifact(game.state.pendingArtifactDecision!.artifactId).rarity).toBe("epic");
        expect(game.state.secondJackpotArtifactId).toBeNull();
      }
    }
    expect(jackpotHit).toBe(true);
  });

  test("hermitExchangeFortune costs 50 coins, works on any equipped artifact incl. Cursed, rolls a replacement ≥ its rarity", () => {
    const game = new Game(13);
    forceEventRoom(game, "wandering-hermit");
    const c = game.state.party[0]!;
    c.equippedArtifactIds.push("blackened-locket"); // isCursed
    game.state.coins = 50;
    expect(game.hermitExchangeFortune("blackened-locket")).toBeNull();
    expect(game.state.coins).toBe(0);
    expect(c.equippedArtifactIds).not.toContain("blackened-locket");
    expect(game.state.pendingArtifactDecision).not.toBeNull();

    const game2 = new Game(14);
    forceEventRoom(game2, "wandering-hermit");
    const c2 = game2.state.party[0]!;
    c2.equippedArtifactIds.push("iron-gauntlet");
    game2.state.coins = 49;
    expect(game2.hermitExchangeFortune("iron-gauntlet")).not.toBeNull(); // not enough coins
  });

  test("collapsedFloorAttempt pays a fixed HP cost, then grants a Unique/Epic artifact as a pending decision on the 60% success roll", () => {
    let sawSuccess = false;
    let sawFailure = false;
    for (let seed = 1; seed < 60 && !(sawSuccess && sawFailure); seed++) {
      const game = new Game(seed);
      forceEventRoom(game, "collapsed-floor");
      const c = game.state.party[0]!;
      const hpBefore = c.hp;
      expect(game.collapsedFloorAttempt(c.id)).toBeNull();
      expect(c.hp).toBeLessThan(hpBefore);
      if (game.state.pendingArtifactDecision) {
        expect(["unique", "epic"]).toContain(getArtifact(game.state.pendingArtifactDecision.artifactId).rarity);
        sawSuccess = true;
      } else {
        sawFailure = true;
      }
    }
    expect(sawSuccess).toBe(true);
    expect(sawFailure).toBe(true);
  });

  test("curseAggroBoost adds flat aggro; Shackle of Hunger now trades defense for attack (no more curseDrainBoost)", () => {
    const { ctx } = makeCtx();
    const c = ctx.party[0]!;
    c.equippedArtifactIds.push("unstable-core");
    expect(curseAggroBoostSum(c)).toBe(25);

    const shackle = getArtifact("shackle-of-hunger");
    expect(shackle.effects).toEqual([
      { kind: "statBoost", stat: "defense", amount: -6 },
      { kind: "statBoost", stat: "attack", amount: 8 },
    ]);
  });

  test("recomputeCharacterStats folds curseAggroBoost into character.aggro on equip and back out on removal", () => {
    const game = new Game(15);
    const c = game.state.party[0]!;
    const baseAggro = c.aggro;
    game.state.pendingArtifactDecision = { artifactId: "unstable-core", forceEquip: false, source: "event" };
    expect(game.resolveArtifactEquip(c.id)).toBeNull();
    expect(c.aggro).toBe(baseAggro + 25);
    expect(removeArtifactFromCharacter(game.state, c.id, "unstable-core")).toBeNull();
    expect(c.aggro).toBe(baseAggro);
  });
});
