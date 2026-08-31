import { describe, test, expect } from "bun:test";
import { Rng } from "../src/engine/rng";
import { getRoom, moveToRoom, pickEventText } from "../src/engine/dungeon";
import { rollArtifactWithMinRarity, rollArtifactOrCursed, getArtifact } from "../src/data/artifacts";
import { rollEvent, EVENTS } from "../src/data/events";
import { curseAggroBoostSum } from "../src/engine/artifacts";
import { removeArtifactFromCharacter } from "../src/engine/party";
import { MERCHANT_PRICE_COINS } from "../src/engine/events/merchant";
import { spawnEventGuardianMonsters } from "../src/data/floor";
import { spawnMonster } from "../src/data/monsters";
import { Game } from "../src/engine/game";
import { makeCtx } from "./helpers";

function forceEventRoom(game: Game, eventId: string) {
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  room.type = "event";
  room.cleared = false;
  room.rolledEventId = eventId;
  return room;
}

describe("events", () => {
  test("rollEvent picks only Common/Rare ids, roughly 65/35", () => {
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

  test("rollArtifactWithMinRarity('rare') never rolls Common", () => {
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

  test("rollArtifactWithMinRarity('epic') always returns an Epic", () => {
    const rng = new Rng(6);
    for (let i = 0; i < 20; i++) expect(getArtifact(rollArtifactWithMinRarity("epic", rng)).rarity).toBe("epic");
  });

  test("rollArtifactOrCursed rolls Cursed roughly 30% of the time", () => {
    const rng = new Rng(7);
    let cursedCount = 0;
    const total = 4000;
    for (let i = 0; i < total; i++) {
      if (getArtifact(rollArtifactOrCursed(rng)).isCursed) cursedCount++;
    }
    expect(cursedCount / total).toBeGreaterThan(0.24);
    expect(cursedCount / total).toBeLessThan(0.36);
  });

  test("moveToRoom auto-resolves open-chest into a pending decision and clears the room", () => {
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

  test("moveToRoom doesn't start combat for a guardian-fight room", () => {
    const game = new Game(2);
    game.state.combat = null;
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.monsterIds = [];
    room.rolledEventId = "guardian-fight";
    const monsterCountBefore = game.ctx.monsters.length;
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.combat).toBeNull();
    expect(room.monsterIds.length).toBe(0);
    expect(game.ctx.monsters.length).toBe(monsterCountBefore);
    expect(room.cleared).toBe(false);
  });

  test("enterGuardianFight starts combat, skipGuardianFight closes with no fight", () => {
    const game = new Game(2);
    game.state.combat = null;
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.monsterIds = [];
    room.rolledEventId = "guardian-fight";
    moveToRoom(game.state, target.id, game.ctx);

    expect(game.enterGuardianFight()).toBeNull();
    expect(game.state.combat).not.toBeNull();
    expect(room.monsterIds.length).toBeGreaterThanOrEqual(1);
    expect(room.monsterIds.length).toBeLessThanOrEqual(2);

    const game2 = new Game(9);
    game2.state.combat = null;
    const target2 = game2.connectedRoomChoices()[0]!;
    const room2 = getRoom(game2.state.floor, target2.id);
    room2.type = "event";
    room2.monsterIds = [];
    room2.rolledEventId = "guardian-fight";
    moveToRoom(game2.state, target2.id, game2.ctx);

    expect(game2.skipGuardianFight()).toBeNull();
    expect(game2.state.combat).toBeNull();
    expect(room2.cleared).toBe(true);
    expect(room2.monsterIds.length).toBe(0);
  });

  test("enterGuardianFight/skipGuardianFight reject without a pending fight", () => {
    const game = new Game(2);
    expect(game.enterGuardianFight()).not.toBeNull();
    expect(game.skipGuardianFight()).not.toBeNull();
  });

  test("spawnEventGuardianMonsters scales stats by the guardian multiplier, not exp", () => {
    const rng = new Rng(1);
    const depth = 5;
    const monsters = spawnEventGuardianMonsters(rng, depth);
    expect(monsters.length).toBeGreaterThanOrEqual(1);
    expect(monsters.length).toBeLessThanOrEqual(2);
    for (const m of monsters) {
      const base = spawnMonster(m.archetypeId, depth);
      expect(m.maxHp).toBe(Math.round(base.maxHp * 1.7));
      expect(m.hp).toBe(m.maxHp);
      expect(m.attack).toBe(Math.round(base.attack * 1.2));
      expect(m.defense).toBe(Math.round(base.defense * 1.2));
      expect(m.expReward).toBe(base.expReward);
    }
  });

  test("moveToRoom pre-rolls 4 merchant offers", () => {
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

  test("merchantPurchase deducts coins and grants the artifact, rejects when short", () => {
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

  test("merchantRefresh re-rolls offers, capped at 3 uses per visit", () => {
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

  test("bloodAltarPay costs 25% maxHP for a random artifact", () => {
    const game = new Game(7);
    forceEventRoom(game, "blood-altar");
    const c = game.state.party[0]!;
    const before = c.hp;
    const cost = Math.floor((c.maxHp * 25) / 100);
    expect(game.bloodAltarPay(c.id)).toBeNull();
    expect(c.hp).toBe(before - cost);
    expect(game.state.pendingArtifactDecision).not.toBeNull();
  });

  test("cursedShrineDecide: accept grants the offer, decline grants nothing", () => {
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

  test("twinAltarsChoose forces equip, requiring a replacement when full", () => {
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

  test("sacrifice removes an artifact and rolls at/above its rarity", () => {
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

  test("gambling den: enter, continue, stop, and loss flows", () => {
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

  test("gambling den round 4 win awards 2 Epic artifacts sequentially", () => {
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

  test("hermitExchangeFortune costs coins and rolls a replacement ≥ its rarity", () => {
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

  test("collapsedFloorAttempt costs HP, grants Unique/Epic on success", () => {
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

  test("curseAggroBoost adds flat aggro; Shackle of Hunger trades defense for attack", () => {
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

  test("recomputeCharacterStats applies curseAggroBoost on equip, removes it on unequip", () => {
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

describe("recurring narrative NPCs (docs/gameplay-decisions/10-event-narrative.md §10.2)", () => {
  test("resolveEventEntry shows the original description on the 1st visit; metNarrativeNpcIds is only marked once the event closes, not on room entry", () => {
    const game = new Game(20);
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "merchant";
    moveToRoom(game.state, target.id, game.ctx);
    const merchantEvent = EVENTS.find((e) => e.id === "merchant")!;
    expect(game.state.message).toBe(merchantEvent.description);
    expect(game.state.metNarrativeNpcIds).not.toContain("merchant"); // still the 1st visit
    game.merchantLeave();
    expect(game.state.metNarrativeNpcIds).toContain("merchant"); // marked only once the visit closes
  });

  test("resolveEventEntry shows returnDescription once the event id is already in metNarrativeNpcIds", () => {
    const game = new Game(21);
    game.state.metNarrativeNpcIds = ["wandering-hermit"];
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "wandering-hermit";
    moveToRoom(game.state, target.id, game.ctx);
    const hermitReturnDescription = EVENTS.find((e) => e.id === "wandering-hermit")!.returnDescription;
    expect(typeof hermitReturnDescription).toBe("string");
    expect(game.state.message).toBe(hermitReturnDescription as string);
  });

  test("resolveEventEntry leaves events without a returnDescription unaffected by metNarrativeNpcIds (e.g. cursed-shrine)", () => {
    const game = new Game(22);
    game.state.metNarrativeNpcIds = ["cursed-shrine"];
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "cursed-shrine";
    moveToRoom(game.state, target.id, game.ctx);
    expect(game.state.message).toBe(EVENTS.find((e) => e.id === "cursed-shrine")!.description);
  });

  test("gambling den closing paths set lastGamblingDenOutcome to lost/won/declined", () => {
    let sawLoss = false;
    let sawBankedWin = false;
    for (let seed = 1; seed < 100 && !(sawLoss && sawBankedWin); seed++) {
      const game = new Game(seed);
      forceEventRoom(game, "gambling-den");
      game.state.activeEvent = { eventId: "gambling-den", offerArtifactIds: [] };
      game.state.coins = 20;
      game.gamblingDenEnter();
      if (game.state.activeEvent?.gambleState) {
        game.gamblingDenStop();
        expect(game.state.lastGamblingDenOutcome).toBe("won");
        sawBankedWin = true;
      } else {
        expect(game.state.lastGamblingDenOutcome).toBe("lost");
        sawLoss = true;
      }
    }
    expect(sawLoss).toBe(true);
    expect(sawBankedWin).toBe(true);

    let jackpotHit = false;
    for (let seed = 1; seed < 400 && !jackpotHit; seed++) {
      const game = new Game(seed);
      forceEventRoom(game, "gambling-den");
      game.state.activeEvent = { eventId: "gambling-den", offerArtifactIds: [] };
      game.state.coins = 20;
      game.gamblingDenEnter();
      for (let round = 1; round <= 3 && game.state.activeEvent?.gambleState; round++) game.gamblingDenContinue();
      if (game.state.pendingArtifactDecision && !game.state.activeEvent?.gambleState) {
        expect(game.state.lastGamblingDenOutcome).toBe("won");
        jackpotHit = true;
      }
    }
    expect(jackpotHit).toBe(true);

    const declinedGame = new Game(50);
    forceEventRoom(declinedGame, "gambling-den");
    declinedGame.state.activeEvent = { eventId: "gambling-den", offerArtifactIds: [] };
    declinedGame.gamblingDenLeave();
    expect(declinedGame.state.lastGamblingDenOutcome).toBe("declined");
  });

  test("resolveEventEntry picks gambling-den's returnDescription branch off lastGamblingDenOutcome", () => {
    const gamblingEvent = EVENTS.find((e) => e.id === "gambling-den")!;
    const returnVariants = gamblingEvent.returnDescription as Record<"won" | "lost" | "declined", string>;

    for (const outcome of ["won", "lost", "declined"] as const) {
      const game = new Game(23);
      game.state.metNarrativeNpcIds = ["gambling-den"];
      game.state.lastGamblingDenOutcome = outcome;
      const target = game.connectedRoomChoices()[0]!;
      const room = getRoom(game.state.floor, target.id);
      room.type = "event";
      room.rolledEventId = "gambling-den";
      moveToRoom(game.state, target.id, game.ctx);
      expect(game.state.message).toBe(returnVariants[outcome]);
    }
  });
});

describe("Chain 1: The Guardian's Grudge (docs/gameplay-decisions/10-event-narrative.md §10.3)", () => {
  test("counter is shared across guardian-fight and desecrated-altar — skipping 1 of each reaches the threshold", () => {
    const game = new Game(30);
    forceEventRoom(game, "guardian-fight");
    expect(game.skipGuardianFight()).toBeNull();
    expect(game.state.narrativeCounters.guardianFightsSkipped).toBe(1);

    forceEventRoom(game, "desecrated-altar");
    expect(game.skipGuardianFight()).toBeNull();
    expect(game.state.narrativeCounters.guardianFightsSkipped).toBe(2);
  });

  test("at 2 skips: the next guardian-fight/desecrated-altar shows the buildup description, Skip is still offered", () => {
    const game = new Game(31);
    game.state.narrativeCounters.guardianFightsSkipped = 2;
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "guardian-fight";
    moveToRoom(game.state, target.id, game.ctx);
    const buildupDescription = EVENTS.find((e) => e.id === "guardian-fight")!.chainBuildupDescription;
    expect(room.chainVariant).toBe("buildup");
    expect(typeof buildupDescription).toBe("string");
    expect(game.state.message).toBe(buildupDescription as string);
    expect(game.skipGuardianFight()).toBeNull(); // still allowed at 2
  });

  test("at 3 skips: the next guardian-fight/desecrated-altar shows the forced description, Skip is rejected", () => {
    const game = new Game(32);
    game.state.narrativeCounters.guardianFightsSkipped = 3;
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "desecrated-altar";
    moveToRoom(game.state, target.id, game.ctx);
    const forcedDescription = EVENTS.find((e) => e.id === "desecrated-altar")!.chainForcedDescription;
    expect(room.chainVariant).toBe("forced");
    expect(typeof forcedDescription).toBe("string");
    expect(game.state.message).toBe(forcedDescription as string);
    expect(game.skipGuardianFight()).not.toBeNull(); // rejected past the threshold
    expect(game.state.narrativeCounters.guardianFightsSkipped).toBe(3); // unchanged by the rejected attempt
  });

  test("entering the forced encounter resets the counter back to 0", () => {
    const game = new Game(33);
    game.state.combat = null;
    game.state.narrativeCounters.guardianFightsSkipped = 3;
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.monsterIds = [];
    room.rolledEventId = "guardian-fight";
    moveToRoom(game.state, target.id, game.ctx);
    expect(room.chainVariant).toBe("forced");
    expect(game.enterGuardianFight()).toBeNull();
    expect(game.state.narrativeCounters.guardianFightsSkipped).toBe(0);
  });

  test("below the threshold, guardian-fight/desecrated-altar show the plain description as before", () => {
    const game = new Game(34);
    const target = game.connectedRoomChoices()[0]!;
    const room = getRoom(game.state.floor, target.id);
    room.type = "event";
    room.rolledEventId = "guardian-fight";
    moveToRoom(game.state, target.id, game.ctx);
    expect(room.chainVariant).toBeUndefined();
    expect(game.state.message).toBe(EVENTS.find((e) => e.id === "guardian-fight")!.description);
  });
});

describe("Chain 2/3: The Circle Remembers & Blood Debt (docs/gameplay-decisions/10-event-narrative.md §10.3)", () => {
  test("sacrificial-circle shows the plain description below the threshold, the escalated one at/past it — and it stays escalated on a later visit", () => {
    const game = new Game(40);
    const c = game.state.party[0]!;

    for (let i = 0; i < 4; i++) {
      c.equippedArtifactIds = ["scholars-insight"];
      expect(game.sacrifice("scholars-insight")).toBeNull();
      game.state.pendingArtifactDecision = null;
    }
    expect(game.state.narrativeCounters.artifactsSacrificed).toBe(4);

    const target1 = game.connectedRoomChoices()[0]!;
    const room1 = getRoom(game.state.floor, target1.id);
    room1.type = "event";
    room1.rolledEventId = "sacrificial-circle";
    moveToRoom(game.state, target1.id, game.ctx);
    expect(game.state.message).toBe(EVENTS.find((e) => e.id === "sacrificial-circle")!.description); // still below 5

    c.equippedArtifactIds = ["scholars-insight"];
    expect(game.sacrifice("scholars-insight")).toBeNull();
    expect(game.state.narrativeCounters.artifactsSacrificed).toBe(5);

    const escalated = EVENTS.find((e) => e.id === "sacrificial-circle")!.chainEscalatedDescription;
    expect(typeof escalated).toBe("string");

    const target2 = game.connectedRoomChoices().find((r) => r.id !== target1.id) ?? game.connectedRoomChoices()[0]!;
    const room2 = getRoom(game.state.floor, target2.id);
    room2.type = "event";
    room2.rolledEventId = "sacrificial-circle";
    moveToRoom(game.state, target2.id, game.ctx);
    expect(game.state.message).toBe(escalated as string);

    // stays escalated — the counter never resets for Chain 2/3 (unlike Chain 1)
    expect(game.state.narrativeCounters.artifactsSacrificed).toBe(5);
    expect(pickEventText(game.state, room2, EVENTS.find((e) => e.id === "sacrificial-circle")!)).toBe(escalated as string);
  });

  test("blood-altar escalates once altarPaymentsCount (bloodAltarPay + collapsedFloorAttempt combined) reaches the threshold", () => {
    const game = new Game(41);
    const c = game.state.party[0]!;

    c.hp = c.maxHp;
    expect(game.bloodAltarPay(c.id)).toBeNull();
    c.hp = c.maxHp;
    expect(game.collapsedFloorAttempt(c.id)).toBeNull();
    c.hp = c.maxHp;
    expect(game.bloodAltarPay(c.id)).toBeNull();
    expect(game.state.narrativeCounters.altarPaymentsCount).toBe(3);

    const target1 = game.connectedRoomChoices()[0]!;
    const room1 = getRoom(game.state.floor, target1.id);
    room1.type = "event";
    room1.rolledEventId = "blood-altar";
    moveToRoom(game.state, target1.id, game.ctx);
    expect(game.state.message).toBe(EVENTS.find((e) => e.id === "blood-altar")!.description); // still below 4

    c.hp = c.maxHp;
    expect(game.collapsedFloorAttempt(c.id)).toBeNull();
    expect(game.state.narrativeCounters.altarPaymentsCount).toBe(4);

    const escalated = EVENTS.find((e) => e.id === "blood-altar")!.chainEscalatedDescription;
    expect(typeof escalated).toBe("string");

    const target2 = game.connectedRoomChoices().find((r) => r.id !== target1.id) ?? game.connectedRoomChoices()[0]!;
    const room2 = getRoom(game.state.floor, target2.id);
    room2.type = "event";
    room2.rolledEventId = "blood-altar";
    moveToRoom(game.state, target2.id, game.ctx);
    expect(game.state.message).toBe(escalated as string);
  });

  test("collapsedFloorAttempt counts toward Chain 3 even when the 60% success roll fails — only the HP payment matters", () => {
    let sawFailure = false;
    for (let seed = 1; seed < 60 && !sawFailure; seed++) {
      const game = new Game(seed);
      const c = game.state.party[0]!;
      c.hp = c.maxHp;
      expect(game.collapsedFloorAttempt(c.id)).toBeNull();
      if (!game.state.pendingArtifactDecision) {
        expect(game.state.narrativeCounters.altarPaymentsCount).toBe(1);
        sawFailure = true;
      }
    }
    expect(sawFailure).toBe(true);
  });
});
