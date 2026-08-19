import type { ItemDefinition, Id } from "../types";
import itemsJson from "../../data/items.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";

// Design data now lives in ../../data/items.json — see
// docs/gameplay-decisions/07-items-artifacts.md §7.1.
export const ITEMS = itemsJson as unknown as ItemDefinition[];

export function getItem(id: Id): ItemDefinition {
  const found = ITEMS.find((i) => i.id === id);
  if (!found) throw new Error(`Unknown item: ${id}`);
  return found;
}

/** The 10 shared-pool items — every item without an `archetypeIds` list (§7.1 "Catalog — 10 item"). */
const BASE_ITEM_IDS = ITEMS.filter((i) => !i.archetypeIds || i.archetypeIds.length === 0).map((i) => i.id);

/** §7.1 "Nguồn rơi" — 60% per kill (any tier). Value: data/balance-config.json BALANCE.items.itemDropChance. */
const ITEM_DROP_CHANCE = BALANCE.items.itemDropChance;

/** Per floor of depth beyond 1, an item's weight below 1 grows toward its full weight of 1 — stronger items become progressively easier to find deeper in the dungeon. Value: data/balance-config.json BALANCE.items.itemWeightDepthGrowth. */
const ITEM_WEIGHT_DEPTH_GROWTH = BALANCE.items.itemWeightDepthGrowth;

function effectiveWeight(item: ItemDefinition, floorDepth: number): number {
  const base = item.weight ?? 1;
  if (base >= 1) return base;
  return Math.min(1, base + ITEM_WEIGHT_DEPTH_GROWTH * (floorDepth - 1));
}

/**
 * Rolls whether killing a monster of `archetypeId` drops an item, and which
 * one. On the 60% success: 50% of the weight goes to the archetype's
 * signature items (split by relative `weight` if it has more than 1 — e.g.
 * Zombie Knight has both Rotten Flesh and Broken Blade Fragment), the
 * remaining 50% is split by relative `weight` across the 10 base-pool items
 * (§7.1). Items with weight < 1 (stronger effects) drop less often, growing
 * toward full weight as `floorDepth` increases.
 */
export function rollItemDrop(archetypeId: Id, rng: Rng, floorDepth = 1): Id | null {
  if (!rng.chance(ITEM_DROP_CHANCE)) return null;

  const signatureIds = ITEMS.filter((i) => i.archetypeIds?.includes(archetypeId)).map((i) => i.id);
  const weighted: { id: Id; weight: number }[] = [];
  if (signatureIds.length > 0) {
    const signatureTotal = signatureIds.reduce((sum, id) => sum + effectiveWeight(getItem(id), floorDepth), 0);
    for (const id of signatureIds) weighted.push({ id, weight: (effectiveWeight(getItem(id), floorDepth) / signatureTotal) * 50 });
  }
  const baseTotal = BASE_ITEM_IDS.reduce((sum, id) => sum + effectiveWeight(getItem(id), floorDepth), 0);
  for (const id of BASE_ITEM_IDS) weighted.push({ id, weight: (effectiveWeight(getItem(id), floorDepth) / baseTotal) * 50 });

  return rng.weightedPick(weighted, (w) => w.weight).id;
}
