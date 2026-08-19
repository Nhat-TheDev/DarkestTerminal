import type { ItemDefinition, Id } from "../types";
import itemsJson from "../../data/items.json";
import type { Rng } from "../engine/rng";

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

/** §7.1 "Nguồn rơi" — 60% per kill (any tier). */
const ITEM_DROP_CHANCE = 0.6;

/**
 * Rolls whether killing a monster of `archetypeId` drops an item, and which
 * one. On the 60% success: 50% of the weight goes to the archetype's
 * signature items (split evenly if it has more than 1 — e.g. Zombie Knight
 * has both Rotten Flesh and Broken Blade Fragment, 25% each), the remaining
 * 50% is split evenly across the 10 base-pool items (§7.1).
 */
export function rollItemDrop(archetypeId: Id, rng: Rng): Id | null {
  if (!rng.chance(ITEM_DROP_CHANCE)) return null;

  const signatureIds = ITEMS.filter((i) => i.archetypeIds?.includes(archetypeId)).map((i) => i.id);
  const weighted: { id: Id; weight: number }[] = [];
  if (signatureIds.length > 0) {
    const perSignature = 50 / signatureIds.length;
    for (const id of signatureIds) weighted.push({ id, weight: perSignature });
  }
  const perBase = 50 / BASE_ITEM_IDS.length;
  for (const id of BASE_ITEM_IDS) weighted.push({ id, weight: perBase });

  return rng.weightedPick(weighted, (w) => w.weight).id;
}
