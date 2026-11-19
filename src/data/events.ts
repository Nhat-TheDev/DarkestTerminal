import type { EventDefinition, EventKind, EventTier, GameState, Id, ReflectionCondition } from "../types";
import eventsJson from "../../data/events.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";
import { catalogRuleErrors } from "./reflectionCatalog";
import { RELIGIONS } from "./religions";

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

export function assertConditionValid(where: string, c: ReflectionCondition): void {
  if ("religionInParty" in c) {
    if (!RELIGIONS.some((r) => r.id === c.religionInParty)) throw new Error(`${where} names an unknown religion "${c.religionInParty}"`);
  } else if ("counterAtLeast" in c) {
    if (!NARRATIVE_COUNTERS.has(c.counterAtLeast.counter)) throw new Error(`${where} counter "${c.counterAtLeast.counter}" is not a narrative counter`);
    if (typeof (BALANCE.events as Record<string, unknown>)[c.counterAtLeast.threshold] !== "number") {
      throw new Error(`${where} threshold "${c.counterAtLeast.threshold}" is not a number in balance-config events`);
    }
  } else if (!["won", "lost", "declined"].includes(c.lastGambleOutcome)) {
    throw new Error(`${where} lastGambleOutcome "${c.lastGambleOutcome}" is not won, lost or declined`);
  }
}

/** A run of an event text, `highlight` when it sat between `[[` and `]]` in the data. */
export interface EventTextPart {
  text: string;
  highlight: boolean;
}

/** Splits an event text on its `[[...]]` marks; `null` when they don't open and close in pairs. */
function splitHighlights(text: string): EventTextPart[] | null {
  const parts: EventTextPart[] = [];
  let rest = text;
  while (rest.length > 0) {
    const open = rest.indexOf("[[");
    const close = rest.indexOf("]]");
    if (open < 0) {
      if (close >= 0) return null;
      parts.push({ text: rest, highlight: false });
      break;
    }
    const end = rest.indexOf("]]", open + 2);
    const nested = rest.indexOf("[[", open + 2);
    if (close < open || end < 0 || (nested >= 0 && nested < end)) return null;
    if (open > 0) parts.push({ text: rest.slice(0, open), highlight: false });
    parts.push({ text: rest.slice(open + 2, end), highlight: true });
    rest = rest.slice(end + 2);
  }
  return parts;
}

export function eventTextParts(text: string): EventTextPart[] {
  return splitHighlights(text) ?? [{ text, highlight: false }];
}

/** The text as a log line or journal reads it: the `[[...]]` marks dropped. */
export function plainEventText(text: string): string {
  return eventTextParts(text)
    .map((part) => part.text)
    .join("");
}

/** Every text an event can show in place of its description: variants, chain texts and return visits. */
export function eventTexts(event: EventDefinition): string[] {
  const returns = typeof event.returnDescription === "string" ? [event.returnDescription] : Object.values(event.returnDescription ?? {});
  return [
    event.description,
    ...(event.descriptionVariants ?? []),
    ...(event.crossEventVariants ?? []).map((v) => v.description),
    event.chainBuildupDescription,
    event.chainEscalatedDescription,
    event.chainEscalated2Description,
    event.chainEscalated3Description,
    event.chainForcedDescription,
    event.chainForced2Description,
    event.chainForced3Description,
    ...returns,
  ].filter((text): text is string => typeof text === "string");
}

const NARRATION_CASES: Record<Exclude<EventKind, "scripted">, readonly string[]> = {
  instantReward: [],
  combatReward: ["fight", "leave"],
  artifactShop: ["purchase", "refresh", "leave"],
  hpGamble: ["pay", "leave"],
  cursedOffer: ["accept", "decline"],
  pairedOffer: ["chooseFirst", "chooseSecond"],
  artifactSacrifice: ["sacrifice", "leave.untouched", "leave.afterOffering", "leave.legacy"],
  fortuneExchange: ["exchange", "leave"],
  rescueGamble: ["rescue.success", "rescue.failure", "leave"],
  coinGamble: ["enter.win", "enter.loss", "continue.win", "continue.loss", "jackpot", "stop", "leave"],
};

function assertEventNarrationValid(event: EventDefinition): void {
  if (event.kind === "scripted") return;
  const where = `data/events.json: "${event.id}" narration`;
  const narration = event.narration;
  if (!narration || typeof narration !== "object" || Array.isArray(narration)) throw new Error(`${where} must be a case-to-text map`);
  const required = [...NARRATION_CASES[event.kind]];
  const sourceCases: [string, boolean][] = [];
  if (event.kind === "instantReward") {
    if (Object.hasOwn(narration, "moveOn")) {
      required.push("moveOn");
    } else {
      if ((event.descriptionVariants?.length ?? 0) > 2) throw new Error(`${where} has unsupported descriptionVariants beyond the lockbox and gear cases`);
      required.push("take.chest");
      sourceCases.push(
        ["take.lockbox", (event.descriptionVariants?.length ?? 0) >= 1],
        ["take.gear", (event.descriptionVariants?.length ?? 0) >= 2],
        ["take.habit", !!event.chainEscalatedDescription],
      );
    }
  }
  if (event.kind === "combatReward") {
    sourceCases.push(
      ["fight.forced1", !!event.chainForcedDescription],
      ["fight.forced2", !!event.chainForced2Description],
      ["fight.forced3", !!event.chainForced3Description],
    );
  }
  if (event.kind === "hpGamble" || event.kind === "artifactSacrifice") {
    const action = event.kind === "hpGamble" ? "pay" : "sacrifice";
    sourceCases.push(
      [`${action}.tier1`, !!event.escalation && !!event.chainEscalatedDescription],
      [`${action}.tier2`, !!event.escalation && !!event.chainEscalated2Description],
      [`${action}.tier3`, !!event.escalation && !!event.chainEscalated3Description],
    );
  }
  for (const [key, applies] of sourceCases) if (applies) required.push(key);
  const allowed = new Set(required);
  if (event.kind === "instantReward" && Object.hasOwn(narration, "moveOn") && event.chainEscalatedDescription) allowed.add("moveOn.habit");
  for (const key of required) {
    if (!Object.hasOwn(narration, key)) throw new Error(`${where} is missing case "${key}"`);
  }
  for (const [key, text] of Object.entries(narration)) {
    if (!allowed.has(key)) throw new Error(`${where} has unsupported case "${key}"`);
    if (typeof text !== "string" || !text.trim()) throw new Error(`${where} case "${key}" must be nonempty text`);
    if (/[{}]/.test(text.replace(/\{\{(?:character|artifact|oldArtifact|newArtifact)\}\}/g, ""))) {
      throw new Error(`${where} case "${key}" has an unsupported placeholder`);
    }
  }
}

export function assertEventDataConsistent(events: EventDefinition[]): void {
  for (const event of events) {
    const unpaired = eventTexts(event).find((text) => splitHighlights(text) === null);
    if (unpaired !== undefined) throw new Error(`data/events.json: "${event.id}" has a text whose [[ ]] marks don't pair up: ${unpaired}`);
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
    if (event.reflection) {
      const { options } = event.reflection;
      if (!Array.isArray(options)) throw new Error(`data/events.json: "${event.id}" reflection options must be a list`);
      for (const option of options) {
        for (const c of [...(option.requires ?? []), ...option.outcomes.flatMap((o) => o.when ?? [])]) assertConditionValid(`data/events.json: "${event.id}" reflection condition`, c);
      }
      const errors = catalogRuleErrors(options);
      if (errors.length > 0) throw new Error(`data/events.json: "${event.id}" reflection breaks the catalog rules: ${errors.join("; ")}`);
    }
    if (event.reflectionRequiresOutcome !== undefined) {
      if (!event.reflection) throw new Error(`data/events.json: "${event.id}" sets reflectionRequiresOutcome but has no reflection`);
      if (!ENGAGEMENT_OUTCOMES.has(event.reflectionRequiresOutcome)) {
        throw new Error(`data/events.json: "${event.id}" reflectionRequiresOutcome "${event.reflectionRequiresOutcome}" is not one of ${[...ENGAGEMENT_OUTCOMES].join(", ")}`);
      }
    }
    assertEventNarrationValid(event);
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
