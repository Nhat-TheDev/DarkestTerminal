import type { EventDefinition, EventTier, Id } from "../types";
import eventsJson from "../../data/events.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";

export const EVENTS = eventsJson as unknown as EventDefinition[];

/** Outcomes written only when the party engaged, so the only ones `reflectionRequiresOutcome` can usefully name. */
const ENGAGEMENT_OUTCOMES: ReadonlySet<string> = new Set(["paid", "sacrificed", "traded", "resolved"]);

export function assertEventDataConsistent(events: EventDefinition[]): void {
  for (const event of events) {
    if (event.freeTake && (event.kind !== "instantReward" || event.noArtifactReward)) {
      throw new Error(`data/events.json: "${event.id}" sets freeTake but is not an instantReward that grants an artifact`);
    }
    if (event.reflectionRequiresOutcome !== undefined) {
      if (!event.reflection) throw new Error(`data/events.json: "${event.id}" sets reflectionRequiresOutcome but has no reflection`);
      if (!ENGAGEMENT_OUTCOMES.has(event.reflectionRequiresOutcome)) {
        throw new Error(`data/events.json: "${event.id}" reflectionRequiresOutcome "${event.reflectionRequiresOutcome}" is not one of ${[...ENGAGEMENT_OUTCOMES].join(", ")}`);
      }
    }
  }
}

assertEventDataConsistent(EVENTS);

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

function isEligible(event: EventDefinition, depth: number, firedOnceEventIds: Id[]): boolean {
  if (event.kind === "scripted") return false;
  if (event.minFloorDepth !== undefined && depth < event.minFloorDepth) return false;
  if ((event.onceLifetime || event.removedOnFounderVictory) && firedOnceEventIds.includes(event.id)) return false;
  return true;
}

export function rollEvent(rng: Rng, depth: number, firedOnceEventIds: Id[]): Id {
  const commonPool = EVENTS_BY_TIER.common.filter((e) => isEligible(e, depth, firedOnceEventIds));
  const rarePool = EVENTS_BY_TIER.rare.filter((e) => isEligible(e, depth, firedOnceEventIds));
  const tier: EventTier = rng.chance(COMMON_TIER_WEIGHT / (COMMON_TIER_WEIGHT + RARE_TIER_WEIGHT)) ? "common" : "rare";
  const pool = tier === "common" ? commonPool : rarePool;
  // Depth and once-lifetime gates can empty the rolled tier's pool; fall back to the other tier.
  const fallback = tier === "common" ? rarePool : commonPool;
  return rng.pick(pool.length > 0 ? pool : fallback).id;
}
