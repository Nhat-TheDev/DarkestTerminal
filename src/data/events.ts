import type { EventDefinition, EventTier, Id } from "../types";
import eventsJson from "../../data/events.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";

export const EVENTS = eventsJson as unknown as EventDefinition[];

export function getEvent(id: Id): EventDefinition {
  const found = EVENTS.find((e) => e.id === id);
  if (!found) throw new Error(`Unknown event: ${id}`);
  return found;
}

const EVENTS_BY_TIER: Record<EventTier, EventDefinition[]> = {
  common: EVENTS.filter((e) => e.tier === "common"),
  rare: EVENTS.filter((e) => e.tier === "rare"),
};

const COMMON_TIER_WEIGHT = BALANCE.events.commonTierWeight;
const RARE_TIER_WEIGHT = BALANCE.events.rareTierWeight;

/** Part C.4/C.5 — an event is eligible to be rolled if the run's floor depth meets its
    `minFloorDepth` (if any) and it isn't a spent `onceLifetime` event. */
function isEligible(event: EventDefinition, depth: number, firedOnceEventIds: Id[]): boolean {
  if (event.minFloorDepth !== undefined && depth < event.minFloorDepth) return false;
  if (event.onceLifetime && firedOnceEventIds.includes(event.id)) return false;
  return true;
}

export function rollEvent(rng: Rng, depth: number, firedOnceEventIds: Id[]): Id {
  const commonPool = EVENTS_BY_TIER.common.filter((e) => isEligible(e, depth, firedOnceEventIds));
  const rarePool = EVENTS_BY_TIER.rare.filter((e) => isEligible(e, depth, firedOnceEventIds));
  const tier: EventTier = rng.chance(COMMON_TIER_WEIGHT / (COMMON_TIER_WEIGHT + RARE_TIER_WEIGHT)) ? "common" : "rare";
  const pool = tier === "common" ? commonPool : rarePool;
  // Depth/once-lifetime gates should never empty both pools at once given today's event roster —
  // if the rolled tier's pool is empty, fall back to the other tier rather than crashing.
  const fallback = tier === "common" ? rarePool : commonPool;
  return rng.pick(pool.length > 0 ? pool : fallback).id;
}
