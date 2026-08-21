import type { EventDefinition, EventTier, Id } from "../types";
import eventsJson from "../../data/events.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";

// Design data now lives in ../../data/events.json — see
// docs/gameplay-decisions/08-events.md §8.
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

/** §8.1 — 65% Common (roll evenly among its 4), 35% Rare (roll evenly among its 7). Values: data/balance-config.json BALANCE.events.*TierWeight. */
const COMMON_TIER_WEIGHT = BALANCE.events.commonTierWeight;
const RARE_TIER_WEIGHT = BALANCE.events.rareTierWeight;

export function rollEvent(rng: Rng): Id {
  const tier: EventTier = rng.chance(COMMON_TIER_WEIGHT / (COMMON_TIER_WEIGHT + RARE_TIER_WEIGHT)) ? "common" : "rare";
  return rng.pick(EVENTS_BY_TIER[tier]).id;
}
