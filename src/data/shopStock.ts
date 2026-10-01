import type { BarterOffer, ItemDefinition, ItemTier, ShopOffer } from "../types";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";
import { tierWeightsByDepth } from "./artifacts";
import { ITEMS } from "./items";
import { getArchetype } from "./monsters";

const CONSUMABLE_TIERS: readonly ItemTier[] = ["common", "uncommon", "rare"];
const TROPHY_TIERS: readonly ItemTier[] = ["common", "uncommon", "rare", "unique", "epic"];

/** A trophy can be offered once at least one monster that drops it can appear at `depth`. */
function trophyAvailableAt(item: ItemDefinition, depth: number): boolean {
  return (item.archetypeIds ?? []).some((id) => (getArchetype(id).minFloor ?? 0) <= depth);
}

function pickByTier(pool: ItemDefinition[], tiers: readonly ItemTier[], anchor: Partial<Record<ItemTier, number>>, rng: Rng, depth: number): ItemDefinition | null {
  const usable = tiers.filter((tier) => pool.some((i) => i.tier === tier));
  if (usable.length === 0) return null;
  const available = Object.fromEntries(usable.map((tier) => [tier, anchor[tier] ?? 0])) as Partial<Record<ItemTier, number>>;
  const weights = tierWeightsByDepth(tiers, available, depth, BALANCE.shop);
  const tier = rng.weightedPick(usable, (candidate) => weights[candidate]);
  return rng.pick(pool.filter((i) => i.tier === tier));
}

/** The trophy kinds the Runner will trade for a buff: `barter.offerCount` different ones that can drop at `depth`, Legendary included. */
export function rollBarterOffers(rng: Rng, depth: number): BarterOffer[] {
  const pool = ITEMS.filter((i) => i.archetypeIds?.length && trophyAvailableAt(i, depth));
  const offers: BarterOffer[] = [];
  while (offers.length < BALANCE.barter.offerCount && pool.length > 0) {
    const [item] = pool.splice(rng.int(0, pool.length - 1), 1);
    offers.push({ itemId: item!.id });
  }
  return offers;
}

/**
 * The Runner's stock for a visit at floor `depth`: `runner.offerCount` distinct items. Each is a
 * trophy with `runner.trophyOfferChance`, otherwise a consumable from the general pool; its tier is
 * rolled with the depth curve in `BALANCE.shop`, and a tier with nothing left to offer is dropped
 * from the roll. Exploration Kit (Unique) and Legendary trophies are never offered.
 */
export function rollShopOffers(rng: Rng, depth: number): ShopOffer[] {
  const { offerCount, trophyOfferChance, singleChance } = BALANCE.runner;
  const consumables = ITEMS.filter((i) => !i.archetypeIds?.length && CONSUMABLE_TIERS.includes(i.tier));
  const trophies = ITEMS.filter((i) => i.archetypeIds?.length && TROPHY_TIERS.includes(i.tier) && trophyAvailableAt(i, depth));
  const offers: ShopOffer[] = [];
  const taken = new Set<string>();
  for (let n = 0; n < offerCount; n++) {
    const fresh = (pool: ItemDefinition[]) => pool.filter((i) => !taken.has(i.id));
    const wantTrophy = rng.chance(trophyOfferChance);
    const item =
      (wantTrophy ? pickByTier(fresh(trophies), TROPHY_TIERS, BALANCE.shop.anchorWeights.trophy, rng, depth) : null) ??
      pickByTier(fresh(consumables), CONSUMABLE_TIERS, BALANCE.shop.anchorWeights.consumable, rng, depth);
    if (!item) break;
    taken.add(item.id);
    offers.push({ itemId: item.id, lot: !rng.chance(singleChance) });
  }
  return offers;
}
