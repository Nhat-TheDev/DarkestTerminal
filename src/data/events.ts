import type { EventDefinition, EventTier, GameState, Id } from "../types";
import eventsJson from "../../data/events.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";

export const EVENTS = eventsJson as unknown as EventDefinition[];

/** Outcomes written only when the party engaged, so the only ones `reflectionRequiresOutcome` can usefully name. */
const ENGAGEMENT_OUTCOMES: ReadonlySet<string> = new Set(["paid", "sacrificed", "traded", "resolved"]);

const NARRATIVE_COUNTERS: ReadonlySet<string> = new Set<keyof GameState["narrativeCounters"]>([
  "guardianFightsSkipped",
  "artifactsSacrificed",
  "altarPaymentsCount",
  "guardianGrudgeFiredCount",
  "freeRewardsTakenCount",
]);

export function assertEventDataConsistent(events: EventDefinition[]): void {
  for (const event of events) {
    if (event.escalation) {
      if (!NARRATIVE_COUNTERS.has(event.escalation.counter)) throw new Error(`data/events.json: "${event.id}" escalation counter "${event.escalation.counter}" is not a narrative counter`);
      for (const key of event.escalation.thresholds) {
        if (typeof (BALANCE.events as Record<string, unknown>)[key] !== "number") {
          throw new Error(`data/events.json: "${event.id}" escalation threshold "${key}" is not a number in balance-config events`);
        }
      }
    }
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

/** The event shown at a fixed point (the run's opening scene) instead of being rolled into a room. */
const scriptedEvents = EVENTS.filter((e) => e.kind === "scripted");
if (scriptedEvents.length !== 1) throw new Error(`data/events.json: exactly 1 event must have kind "scripted" (found ${scriptedEvents.length})`);
export const SCRIPTED_EVENT_ID: Id = scriptedEvents[0]!.id;

export const RETIRED_CHARACTER_EVENT_IDS: Id[] = EVENTS.filter((e) => e.retiredCharacterEvent).map((e) => e.id);

/** The `events.*` balance value an escalation threshold names. */
export function escalationThreshold(key: string): number {
  return (BALANCE.events as unknown as Record<string, number>)[key]!;
}

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
