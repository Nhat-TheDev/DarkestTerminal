import type { Id, ItemTier } from "../types";
import barterJson from "../../data/barter.json";
import { ITEMS, getItem } from "./items";
import { getStatusEffect } from "./statusEffects";
import { BALANCE } from "./balanceConfig";

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

type BarterConfig = typeof BALANCE.barter;

// Every key each map must have; typed as a full Record so a new stat or tier fails to compile until it is listed.
const STATUS_STATS: Record<keyof BarterConfig["statStatusIds"], true> = { attack: true, magicPower: true, defense: true, speed: true };
const ITEM_TIERS: Record<ItemTier, true> = { common: true, uncommon: true, rare: true, unique: true, epic: true, legendary: true };

/** Every stat and every tier names a status, and each status exists, so a typo or a missing key fails at load rather than mid-fight. */
export function validateBarterStatusIds(config: BarterConfig): void {
  const check = (field: string, map: Record<string, string>, keys: string[]) => {
    for (const key of keys) {
      const id = map[key];
      if (!id) throw new Error(`data/balance-config.json: barter.${field} has no entry for "${key}"`);
      getStatusEffect(id);
    }
  };
  check("statStatusIds", config.statStatusIds, Object.keys(STATUS_STATS));
  check("regenStatusIdByTier", config.regenStatusIdByTier, Object.keys(ITEM_TIERS));
}
validateBarterStatusIds(BALANCE.barter);

const seen = new Set<Id>();
for (const entry of BARTER_ENTRIES) {
  const item = getItem(entry.itemId);
  if (!item.archetypeIds?.length) throw new Error(`data/barter.json: "${entry.itemId}" is not a trophy`);
  if (seen.has(entry.itemId)) throw new Error(`data/barter.json: "${entry.itemId}" appears twice`);
  seen.add(entry.itemId);
  if (!Number.isInteger(entry.cost) || entry.cost < 1) throw new Error(`data/barter.json: "${entry.itemId}" needs a whole "cost" of at least 1`);
  if (!Array.isArray(entry.effects) || entry.effects.length === 0) throw new Error(`data/barter.json: "${entry.itemId}" has no effects`);
  if (entry.effects.filter((e) => e.kind === "healOverTime").length > 1) throw new Error(`data/barter.json: "${entry.itemId}" has more than one healOverTime effect`);
  for (const effect of entry.effects) {
    if (effect.kind === "statBoost") {
      if (!BOOST_STATS.includes(effect.stat)) throw new Error(`data/barter.json: "${entry.itemId}" has an unknown stat "${effect.stat}"`);
      if (!(effect.percent > 0)) throw new Error(`data/barter.json: "${entry.itemId}" needs a positive percent for "${effect.stat}"`);
    } else if (effect.kind === "healOverTime") {
      // Healing runs through one status per tier (data/status-effects.json), so the entry's percent must be that status's.
      const regenId = BALANCE.barter.regenStatusIdByTier[item.tier];
      if (getStatusEffect(regenId).perTurnEffects[0]?.maxHpPercent !== effect.maxHpPercentPerTurn) {
        throw new Error(`data/barter.json: "${entry.itemId}" maxHpPercentPerTurn must equal ${regenId}'s maxHpPercent`);
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
