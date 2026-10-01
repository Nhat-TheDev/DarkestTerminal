import type { GameState, ItemDefinition, ItemTier, Room } from "../../types";
import type { PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { BALANCE } from "../../data/balanceConfig";
import { getItem } from "../../data/items";
import { rollShopOffers } from "../../data/shopStock";
import { t } from "../../data/strings";

/** Rolls the Merchant's Runner for a Rest room the party just entered; a room that already has one keeps it. */
export function rollRestRunner(state: GameState, room: Room, ctx: EngineContext): void {
  if (state.restRunner?.roomId === room.id) return;
  if (!ctx.rng.chance(BALANCE.runner.appearChance)) {
    state.restRunner = null;
    return;
  }
  state.restRunner = {
    roomId: room.id,
    noticeShown: false,
    noticeVariant: ctx.rng.int(0, BALANCE.runner.noticeVariantCount - 1),
    offers: rollShopOffers(ctx.rng, state.floor.depth),
    refreshCount: 0,
  };
}

export function shopPrice(tier: ItemTier, lot: boolean): number {
  const price = BALANCE.runner.priceByTier[tier];
  if (!price) throw new Error(`No shop price for tier "${tier}"`);
  return lot ? price.lot : price.single;
}

/** What the Runner pays for one `item`, or null when he refuses it: he doesn't buy what he never sells (Legendary trophies, items above Rare in the general pool). */
export function buybackPrice(item: ItemDefinition): number | null {
  const neverSold = item.tier === "legendary" || (!item.archetypeIds?.length && (item.tier === "unique" || item.tier === "epic"));
  if (neverSold) return null;
  return Math.round(shopPrice(item.tier, false) / BALANCE.runner.buybackDivisor);
}

export function runnerBuy(state: GameState, offerIndex: number): PartyActionError | null {
  const runner = state.restRunner;
  if (!runner) return { reason: t("errors.noRunner") };
  const offer = runner.offers[offerIndex];
  if (!offer || offer.sold) return { reason: t("errors.noSuchOffer") };
  const item = getItem(offer.itemId);
  const cost = shopPrice(item.tier, offer.lot);
  if (state.coins < cost) return { reason: t("errors.notEnoughCoins") };
  const count = offer.lot ? BALANCE.runner.lotSize : 1;
  state.coins -= cost;
  state.inventory[item.id] = (state.inventory[item.id] ?? 0) + count;
  offer.sold = true;
  state.message = t("game.runnerBought", { cost, item: count > 1 ? `${item.name} ×${count}` : item.name });
  return null;
}

export function runnerRefresh(state: GameState, ctx: EngineContext): PartyActionError | null {
  const runner = state.restRunner;
  if (!runner) return { reason: t("errors.noRunner") };
  if (runner.refreshCount >= BALANCE.events.merchantMaxRefreshes) return { reason: t("errors.merchantMaxRefreshesReached") };
  if (state.coins < BALANCE.events.merchantRefreshCostCoins) return { reason: t("errors.notEnoughCoins") };
  state.coins -= BALANCE.events.merchantRefreshCostCoins;
  runner.offers = rollShopOffers(ctx.rng, state.floor.depth);
  runner.refreshCount += 1;
  state.message = t("game.runnerRefreshed");
  return null;
}

export function runnerSell(state: GameState, itemId: string): PartyActionError | null {
  if (!state.restRunner) return { reason: t("errors.noRunner") };
  if ((state.inventory[itemId] ?? 0) <= 0) return { reason: t("errors.noItem") };
  const item = getItem(itemId);
  const price = buybackPrice(item);
  if (price === null) return { reason: t("errors.runnerWontBuy") };
  state.inventory[itemId] = (state.inventory[itemId] ?? 0) - 1;
  state.coins += price;
  state.message = t("game.runnerSold", { coins: price, item: item.name });
  return null;
}
