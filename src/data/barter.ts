import type { Id } from "../types";
import barterJson from "../../data/barter.json";
import { ITEMS, getItem } from "./items";
import { getStatusEffect } from "./statusEffects";

export type BarterBoostStat = "attack" | "defense" | "speed";

/**
 * One piece of a buff. `statBoost` adds `percent` of the stat's effect once, when the fight starts
 * (`attack` also raises magic power; `defense` is a share of effective HP). `healOverTime` heals that
 * percent of max HP at the start of each round of the fight.
 */
export type BarterEffect = { kind: "statBoost"; stat: BarterBoostStat; percent: number } | { kind: "healOverTime"; maxHpPercentPerTurn: number };

/** What one trophy kind buys from the Runner: how many of it a trade takes, and the buff it gives. */
export interface BarterEntry {
  itemId: Id;
  cost: number;
  effects: BarterEffect[];
}

export const BARTER_ENTRIES = barterJson as unknown as BarterEntry[];

const BOOST_STATS: readonly BarterBoostStat[] = ["attack", "defense", "speed"];

const seen = new Set<Id>();
for (const entry of BARTER_ENTRIES) {
  const item = getItem(entry.itemId);
  if (!item.archetypeIds?.length) throw new Error(`data/barter.json: "${entry.itemId}" is not a trophy`);
  if (seen.has(entry.itemId)) throw new Error(`data/barter.json: "${entry.itemId}" appears twice`);
  seen.add(entry.itemId);
  if (!Number.isInteger(entry.cost) || entry.cost < 1) throw new Error(`data/barter.json: "${entry.itemId}" needs a whole "cost" of at least 1`);
  if (entry.effects.length === 0) throw new Error(`data/barter.json: "${entry.itemId}" has no effects`);
  for (const effect of entry.effects) {
    if (effect.kind === "statBoost") {
      if (!BOOST_STATS.includes(effect.stat)) throw new Error(`data/barter.json: "${entry.itemId}" has an unknown stat "${effect.stat}"`);
      if (!(effect.percent > 0)) throw new Error(`data/barter.json: "${entry.itemId}" needs a positive percent for "${effect.stat}"`);
    } else if (effect.kind === "healOverTime") {
      // Healing runs through one status per tier (data/status-effects.json), so the entry's percent must be that status's.
      if (getStatusEffect(`barter-regen-${item.tier}`).perTurnEffects[0]?.maxHpPercent !== effect.maxHpPercentPerTurn) {
        throw new Error(`data/barter.json: "${entry.itemId}" maxHpPercentPerTurn must equal barter-regen-${item.tier}'s maxHpPercent`);
      }
    } else {
      throw new Error(`data/barter.json: "${entry.itemId}" has an unknown effect kind "${(effect as { kind: string }).kind}"`);
    }
  }
}
for (const item of ITEMS) {
  if (item.archetypeIds?.length && !seen.has(item.id)) throw new Error(`data/barter.json: trophy "${item.id}" has no entry`);
}

export function getBarterEntry(itemId: Id): BarterEntry {
  const entry = BARTER_ENTRIES.find((e) => e.itemId === itemId);
  if (!entry) throw new Error(`"${itemId}" is not a trophy the runner trades for`);
  return entry;
}
