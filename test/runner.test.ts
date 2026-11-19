import { describe, test, expect } from "bun:test";
import { Rng } from "../src/engine/rng";
import { Game } from "../src/engine/game";
import { getRoom } from "../src/engine/dungeon";
import { migrateGameState } from "../src/engine/migration";
import { rollRestRunner, shopPrice, buybackPrice, runnerSell } from "../src/engine/events/runner";
import { rollShopOffers } from "../src/data/shopStock";
import { getItem } from "../src/data/items";
import { getArchetype } from "../src/data/monsters";
import { BALANCE } from "../src/data/balanceConfig";
import { STRINGS } from "../src/data/strings";
import type { GameState } from "../src/types";

function restGame(seed = 1) {
  const game = new Game(seed);
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  room.type = "rest";
  room.cleared = false;
  return { game, room };
}

function withRunner(game: Game, offers: { itemId: string; lot: boolean }[]) {
  game.state.restRunner = { roomId: game.state.currentRoomId, noticeShown: false, noticeVariant: 0, offers, refreshCount: 0 };
}

describe("Rest room runner", () => {
  test("the runner is rolled on entering a Rest room, about half the time", () => {
    const { game, room } = restGame(3);
    let present = 0;
    const total = 2000;
    for (let i = 0; i < total; i++) {
      game.state.restRunner = null;
      rollRestRunner(game.state, room, game.ctx);
      if (game.state.restRunner) present++;
    }
    expect(present / total).toBeGreaterThan(BALANCE.runner.appearChance - 0.05);
    expect(present / total).toBeLessThan(BALANCE.runner.appearChance + 0.05);
  });

  test("a room that already has its runner keeps the same stock instead of rolling again", () => {
    const { game, room } = restGame(4);
    withRunner(game, [{ itemId: "small-health-potion", lot: false }]);
    const before = game.state.restRunner;
    rollRestRunner(game.state, room, game.ctx);
    expect(game.state.restRunner).toBe(before);
  });

  test("restRunner survives a save round trip and defaults to null on an older save", () => {
    const { game } = restGame(5);
    withRunner(game, [{ itemId: "small-health-potion", lot: true }]);
    const reloaded = migrateGameState(JSON.parse(JSON.stringify(game.state)) as GameState);
    expect(reloaded.restRunner?.offers).toEqual([{ itemId: "small-health-potion", lot: true }]);
    const older = JSON.parse(JSON.stringify(game.state)) as Record<string, unknown>;
    delete older.restRunner;
    expect(migrateGameState(older).restRunner).toBeNull();
  });

  test("leaving the rest room clears it and drops the runner; leaveRunner only closes the shop", () => {
    const skipped = restGame(6);
    withRunner(skipped.game, []);
    skipped.game.restAction("leave");
    expect(skipped.game.state.restRunner).toBeNull();
    expect(skipped.room.cleared).toBe(true);

    const traded = restGame(7);
    withRunner(traded.game, []);
    traded.game.leaveRunner();
    expect(traded.game.state.restRunner).not.toBeNull();
    expect(traded.room.cleared).toBe(false);
  });

  test("trade first keeps the rest", () => {
    const { game, room } = restGame(9);
    withRunner(game, []);
    const c = game.state.party[0]!;
    c.hp = 1;
    game.leaveRunner();
    game.restAction("eat");
    expect(c.hp).toBeGreaterThan(1);
    expect(room.rested).toBe(true);
    expect(room.cleared).toBe(false);
  });

  test("rest first dims the rest actions, keeps the runner, and leaving clears the room", () => {
    const { game, room } = restGame(10);
    withRunner(game, []);
    const c = game.state.party[0]!;
    c.hp = 1;
    game.state.party[1]!.hp = 1;
    game.restAction("chat");
    const hpAfterChat = c.hp;
    const satiety = game.state.satiety;
    game.restAction("eat");
    game.restAction("pray");
    expect(c.hp).toBe(hpAfterChat);
    expect(game.state.satiety).toBe(satiety);
    expect(game.state.restRunner).not.toBeNull();
    expect(room.cleared).toBe(false);
    game.restAction("leave");
    expect(room.cleared).toBe(true);
    expect(game.state.restRunner).toBeNull();
  });

  test("a 1.2.1 save mid-rest with the runner loads with every rest action open", () => {
    const { game, room } = restGame(11);
    withRunner(game, [{ itemId: "small-health-potion", lot: false }]);
    const old = JSON.parse(JSON.stringify(game.state)) as GameState;
    for (const r of old.floor.rooms) delete r.rested;
    const loaded = migrateGameState(old);
    const loadedRoom = getRoom(loaded.floor, room.id);
    expect(loadedRoom.rested).toBeFalsy();
    expect(loadedRoom.cleared).toBe(false);
    expect(loaded.restRunner?.offers.length).toBe(1);
  });
});

describe("Rest room runner bookkeeping", () => {
  test("a runner left over from one floor is gone on the next, where room ids repeat", () => {
    const { game } = restGame(8);
    withRunner(game, [{ itemId: "small-health-potion", lot: false }]);
    game.advanceToNextFloor();
    expect(game.state.restRunner).toBeNull();
  });

  test("there is an appearance text for every variant the config can roll, and no spare ones", () => {
    const count = BALANCE.runner.noticeVariantCount;
    for (let i = 0; i < count; i++) expect(STRINGS[`runner.notice${i}`]).toBeTruthy();
    expect(STRINGS[`runner.notice${count}`]).toBeUndefined();
  });
});

describe("shop stock", () => {
  test("offers are 5 distinct items and never Legendary trophies or, unless passed in, the Exploration Kit", () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const depth of [1, 30, 75, 120]) {
        const offers = rollShopOffers(new Rng(seed), depth);
        expect(offers.length).toBe(BALANCE.runner.offerCount);
        expect(new Set(offers.map((o) => o.itemId)).size).toBe(offers.length);
        for (const offer of offers) {
          const item = getItem(offer.itemId);
          expect(item.tier).not.toBe("legendary");
          expect(offer.itemId).not.toBe("exploration-kit");
          if (!item.archetypeIds?.length) expect(["common", "uncommon", "rare"]).toContain(item.tier);
        }
      }
    }
  });

  test("a kit offer passed in takes one of the offers as it is", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const kit = { itemId: "exploration-kit", lot: false, sold: true };
      const offers = rollShopOffers(new Rng(seed), 30, kit);
      expect(offers.length).toBe(BALANCE.runner.offerCount);
      expect(offers.filter((o) => o.itemId === "exploration-kit")).toEqual([kit]);
    }
  });

  test("a trophy is offered only once one of its monsters can appear at that depth", () => {
    for (let seed = 1; seed <= 3000; seed++) {
      for (const offer of rollShopOffers(new Rng(seed), 1)) {
        const item = getItem(offer.itemId);
        if (item.archetypeIds?.length) expect(item.archetypeIds.some((id) => (getArchetype(id).minFloor ?? 0) <= 1)).toBe(true);
      }
    }
  });

  test("offers are about 30% single items and 5% trophies", () => {
    let singles = 0;
    let trophies = 0;
    let total = 0;
    for (let seed = 1; seed <= 4000; seed++) {
      for (const offer of rollShopOffers(new Rng(seed), 40)) {
        total++;
        if (!offer.lot) singles++;
        if (getItem(offer.itemId).archetypeIds?.length) trophies++;
      }
    }
    expect(singles / total).toBeGreaterThan(BALANCE.runner.singleChance - 0.03);
    expect(singles / total).toBeLessThan(BALANCE.runner.singleChance + 0.03);
    expect(trophies / total).toBeGreaterThan(BALANCE.runner.trophyOfferChance - 0.02);
    expect(trophies / total).toBeLessThan(BALANCE.runner.trophyOfferChance + 0.02);
  });

  test("deeper floors offer rarer consumables", () => {
    const rareShare = (depth: number) => {
      let rare = 0;
      let total = 0;
      for (let seed = 1; seed <= 1500; seed++) {
        for (const offer of rollShopOffers(new Rng(seed), depth)) {
          const item = getItem(offer.itemId);
          if (item.archetypeIds?.length) continue;
          total++;
          if (item.tier === "rare") rare++;
        }
      }
      return rare / total;
    };
    expect(rareShare(80)).toBeGreaterThan(rareShare(5) + 0.3);
  });
});

describe("runner trade", () => {
  test("prices follow the tier, with buyback at a fifth of the single price", () => {
    expect(shopPrice("rare", true)).toBe(135);
    expect(shopPrice("common", false)).toBe(15);
    expect(buybackPrice(getItem("small-health-potion"))).toBe(3);
    expect(buybackPrice(getItem("rat-tail"))).toBe(5);
    expect(buybackPrice(getItem("greater-health-potion"))).toBe(10);
    expect(buybackPrice(getItem("predator-sinew"))).toBe(16);
    expect(buybackPrice(getItem("warped-vambrace"))).toBe(30);
  });

  test("buying a lot pays the lot price and adds a lot of items, once", () => {
    const { game } = restGame(8);
    withRunner(game, [{ itemId: "small-health-potion", lot: true }, { itemId: "greater-health-potion", lot: false }]);
    game.state.coins = 100;
    const before = game.state.inventory["small-health-potion"] ?? 0;
    expect(game.runnerBuy(0)).toBeNull();
    expect(game.state.coins).toBe(60);
    expect(game.state.inventory["small-health-potion"]).toBe(before + BALANCE.runner.lotSize);
    expect(game.runnerBuy(0)).not.toBeNull();
    expect(game.state.coins).toBe(60);
  });

  test("an offer the party can't afford is refused and nothing changes", () => {
    const { game } = restGame(9);
    withRunner(game, [{ itemId: "greater-health-potion", lot: true }]);
    game.state.coins = 134;
    expect(game.runnerBuy(0)).not.toBeNull();
    expect(game.state.coins).toBe(134);
    expect(game.state.restRunner?.offers[0]?.sold).toBeUndefined();
  });

  test("refresh costs coins, rerolls the stock and stops after the Merchant's limit", () => {
    const { game } = restGame(10);
    withRunner(game, rollShopOffers(new Rng(1), 1));
    game.state.coins = 100;
    for (let i = 0; i < BALANCE.events.merchantMaxRefreshes; i++) {
      expect(game.runnerRefresh()).toBeNull();
      expect(game.state.restRunner?.offers.length).toBe(BALANCE.runner.offerCount);
    }
    expect(game.state.coins).toBe(100 - BALANCE.events.merchantMaxRefreshes * BALANCE.events.merchantRefreshCostCoins);
    expect(game.runnerRefresh()).not.toBeNull();

    const broke = restGame(11);
    withRunner(broke.game, []);
    broke.game.state.coins = BALANCE.events.merchantRefreshCostCoins - 1;
    expect(broke.game.runnerRefresh()).not.toBeNull();
  });

  test("the runner lays out a single Exploration Kit on about campKitOfferChance of his visits", () => {
    const { game, room } = restGame(14);
    let visits = 0;
    let withKit = 0;
    for (let i = 0; i < 6000; i++) {
      game.state.restRunner = null;
      rollRestRunner(game.state, room, game.ctx);
      const offers = (game.state.restRunner as GameState["restRunner"])?.offers;
      if (!offers) continue;
      visits++;
      const kits = offers.filter((o) => o.itemId === "exploration-kit");
      expect(kits.length).toBeLessThanOrEqual(1);
      if (kits[0]) {
        withKit++;
        expect(kits[0].lot).toBe(false);
      }
    }
    expect(withKit / visits).toBeGreaterThan(BALANCE.runner.campKitOfferChance - 0.04);
    expect(withKit / visits).toBeLessThan(BALANCE.runner.campKitOfferChance + 0.04);
  });

  test("a refresh never rolls the kit again: unsold it stays, sold it stays sold, absent it stays absent", () => {
    const kitsIn = (game: Game) => game.state.restRunner!.offers.filter((o) => o.itemId === "exploration-kit");

    const unsold = restGame(15).game;
    withRunner(unsold, rollShopOffers(new Rng(1), 1, { itemId: "exploration-kit", lot: false }));
    unsold.state.coins = 1000;
    for (let i = 0; i < BALANCE.events.merchantMaxRefreshes; i++) {
      expect(unsold.runnerRefresh()).toBeNull();
      expect(kitsIn(unsold)).toEqual([{ itemId: "exploration-kit", lot: false }]);
    }

    const sold = restGame(16).game;
    withRunner(sold, rollShopOffers(new Rng(1), 1, { itemId: "exploration-kit", lot: false }));
    sold.state.coins = 1000;
    const kitIndex = sold.state.restRunner!.offers.findIndex((o) => o.itemId === "exploration-kit");
    expect(sold.runnerBuy(kitIndex)).toBeNull();
    for (let i = 0; i < BALANCE.events.merchantMaxRefreshes; i++) {
      expect(sold.runnerRefresh()).toBeNull();
      expect(kitsIn(sold)).toEqual([{ itemId: "exploration-kit", lot: false, sold: true }]);
    }

    const absent = restGame(17).game;
    withRunner(absent, rollShopOffers(new Rng(1), 1));
    absent.state.coins = 1000;
    for (let i = 0; i < BALANCE.events.merchantMaxRefreshes; i++) {
      expect(absent.runnerRefresh()).toBeNull();
      expect(kitsIn(absent)).toEqual([]);
    }
  });

  test("the runner sells no kit to a party already holding maxExplorationKits", () => {
    const { game } = restGame(18);
    withRunner(game, [{ itemId: "exploration-kit", lot: false }]);
    game.state.coins = 500;
    game.state.inventory["exploration-kit"] = BALANCE.party.maxExplorationKits;
    expect(game.runnerBuy(0)).not.toBeNull();
    expect(game.state.coins).toBe(500);
    game.state.inventory["exploration-kit"] = BALANCE.party.maxExplorationKits - 1;
    expect(game.runnerBuy(0)).toBeNull();
    expect(game.state.inventory["exploration-kit"]).toBe(BALANCE.party.maxExplorationKits);
  });

  test("selling pays the buyback price; Legendary trophies and the Exploration Kit are refused", () => {
    const { game } = restGame(12);
    withRunner(game, []);
    game.state.coins = 0;
    game.state.inventory["rat-tail"] = 2;
    game.state.inventory["dragon-scale"] = 1;
    game.state.inventory["exploration-kit"] = 1;
    expect(game.runnerSell("rat-tail")).toBeNull();
    expect(game.state.coins).toBe(5);
    expect(game.state.inventory["rat-tail"]).toBe(1);
    expect(game.runnerSell("dragon-scale")).not.toBeNull();
    expect(game.runnerSell("exploration-kit")).not.toBeNull();
    expect(game.runnerSell("venom-gland")).not.toBeNull();
    expect(game.state.coins).toBe(5);
    expect(game.state.inventory["dragon-scale"]).toBe(1);
  });

  test("with no runner present nothing can be bought, refreshed or sold", () => {
    const { game } = restGame(13);
    game.state.restRunner = null;
    expect(game.runnerBuy(0)).not.toBeNull();
    expect(game.runnerRefresh()).not.toBeNull();
    expect(runnerSell(game.state, "small-health-potion")).not.toBeNull();
  });
});
