import type { Character, EventDefinition, GameState, Id, Room } from "../../types";
import type { PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { t } from "../../data/strings";
import { getRoom } from "../dungeon";
import { getEvent } from "../../data/events";
import { BALANCE } from "../../data/balanceConfig";

/** Events in scope for §10.5's post-event reflection choice — every event except the 2 deliberately
    mundane ones (open-chest, collapsed-floor), which stay unreflected on purpose. */
const REFLECTION_EVENT_IDS: ReadonlySet<Id> = new Set([
  "guardian-fight",
  "merchant",
  "desecrated-altar",
  "blood-altar",
  "cursed-shrine",
  "twin-altars",
  "sacrificial-circle",
  "gambling-den",
  "wandering-hermit",
  "old-count",
  "doubled-back",
  "the-delay",
  "waiting-supplies",
  "vigil-candle",
  "broken-seal",
  "half-a-warning",
  "still-breathing",
]);

export function payHpPercent(character: Character, percent: number): number | null {
  const cost = Math.floor((character.maxHp * percent) / 100);
  if (cost >= character.hp) return null;
  character.hp -= cost;
  return cost;
}

export function closeEvent(state: GameState): void {
  const room = getRoom(state.floor, state.currentRoomId);
  room.cleared = true;
  state.activeEvent = null;
  // Mark personified events (10-event-narrative.md §10.2) as met only once the visit fully closes,
  // not on room entry — currentEventDescription() re-derives the same alreadyMet check on every
  // re-render within a visit, so marking it "met" any earlier would flip the header to the "return"
  // text mid-way through the player's 1st ever visit.
  if (room.rolledEventId) {
    const event = getEvent(room.rolledEventId);
    if (event.returnDescription && !state.metNarrativeNpcIds.includes(event.id)) {
      state.metNarrativeNpcIds.push(event.id);
    }
    // Part C.4/C.5 — spent once-lifetime events never roll again this run.
    if (event.onceLifetime && !state.firedOnceEventIds.includes(event.id)) {
      state.firedOnceEventIds.push(event.id);
    }
    // Part C.1 — generic fallback outcome tag; a handler that already wrote a specific tag
    // (bloodAltarPay/Leave, collapsedFloorAttempt/Leave, sacrifice) is never overwritten.
    if (state.eventOutcomes[event.id] === undefined) {
      state.eventOutcomes[event.id] = "resolved";
    }
  }
}

/** These 5 events' reflection text (base prompt, and every escalated tier for the 2 that chain)
    describes the event's core action having happened — a payment taken, a trade struck, a
    guardian fought and beaten. Showing that text after the party merely left (voluntarily, or
    because they couldn't meet the cost) would describe something that never occurred. Gate
    reflection on the specific outcome tag that only gets written when the action actually
    succeeded, so a decline skips reflection entirely — the same reasoning open-chest/
    collapsed-floor are excluded for: nothing happened, nothing to reflect on. */
const REQUIRES_ENGAGEMENT: Partial<Record<Id, string>> = {
  "blood-altar": "paid",
  "sacrificial-circle": "sacrificed",
  "wandering-hermit": "traded",
  "guardian-fight": "resolved",
  "desecrated-altar": "resolved",
};

/**
 * §10.5 — call after any action that might have just closed an event room. Safe to call
 * unconditionally, including after actions that DON'T close the event (e.g. a Gambling Den round
 * that continues rather than ending the visit): it no-ops until `room.cleared` is actually true, so
 * it never consumes an `rng` draw when it isn't applicable.
 */
export function maybeTriggerReflection(state: GameState, ctx: EngineContext): void {
  if (state.pendingReflection) return;
  const room = getRoom(state.floor, state.currentRoomId);
  if (!room.cleared || !room.rolledEventId) return;
  const event = getEvent(room.rolledEventId);
  if (!event.reflection || !REFLECTION_EVENT_IDS.has(event.id)) return;
  const requiredOutcome = REQUIRES_ENGAGEMENT[event.id];
  if (requiredOutcome && state.eventOutcomes[event.id] !== requiredOutcome) return;
  const alreadySeen = event.id in state.eventReflectionStances;
  const chance = alreadySeen ? BALANCE.events.reflectionRepeatChance : 1;
  if (ctx.rng.chance(chance)) state.pendingReflection = { eventId: event.id };
}

function isTier2Escalated(state: GameState, counter: number, threshold2: number): boolean {
  return counter >= threshold2 && state.floor.depth >= BALANCE.events.chainTier2MinFloorDepth;
}

/** 10-event-narrative.md Part C.3 — same shape as `isTier2Escalated`, one gate deeper. */
function isTier3Escalated(state: GameState, counter: number, threshold3: number): boolean {
  return counter >= threshold3 && state.floor.depth >= BALANCE.events.chainTier3MinFloorDepth;
}

/** Picks the reflection prompt for the event pending in `state.pendingReflection` — the tier-3
    escalated variant (Part C.3) if that's what just resolved, else tier-2 (11-world-bible.md
    §11.13), else the tier-1 escalated variant if this resolution was a §10.3 chain-escalated one,
    otherwise the base prompt. */
export function pickReflectionPrompt(state: GameState, room: Room, event: EventDefinition): string | undefined {
  if (!event.reflection) return undefined;

  const escalated3 =
    room.chainVariant === "forced3" ||
    (event.id === "sacrificial-circle" && isTier3Escalated(state, state.narrativeCounters.artifactsSacrificed, BALANCE.events.circleRemembersThreshold3)) ||
    (event.id === "blood-altar" && isTier3Escalated(state, state.narrativeCounters.altarPaymentsCount, BALANCE.events.bloodDebtThreshold3));
  if (escalated3 && event.reflection.escalated3Prompt) return event.reflection.escalated3Prompt;

  const escalated2 =
    room.chainVariant === "forced2" ||
    room.chainVariant === "forced3" ||
    (event.id === "sacrificial-circle" && isTier2Escalated(state, state.narrativeCounters.artifactsSacrificed, BALANCE.events.circleRemembersThreshold2)) ||
    (event.id === "blood-altar" && isTier2Escalated(state, state.narrativeCounters.altarPaymentsCount, BALANCE.events.bloodDebtThreshold2));
  if (escalated2 && event.reflection.escalated2Prompt) return event.reflection.escalated2Prompt;

  const escalated =
    room.chainVariant === "forced" ||
    room.chainVariant === "forced2" ||
    room.chainVariant === "forced3" ||
    (event.id === "sacrificial-circle" && state.narrativeCounters.artifactsSacrificed >= BALANCE.events.circleRemembersThreshold) ||
    (event.id === "blood-altar" && state.narrativeCounters.altarPaymentsCount >= BALANCE.events.bloodDebtThreshold);
  return (escalated && event.reflection.escalatedPrompt) || event.reflection.prompt;
}

export function findPartyMemberOrError(state: GameState, characterId: Id): Character | PartyActionError {
  const character = state.party.find((c) => c.id === characterId);
  return character ?? { reason: t("errors.characterNotFound") };
}

export function findArtifactOwner(state: GameState, artifactId: Id): Character | undefined {
  return state.party.find((c) => c.equippedArtifactIds.includes(artifactId));
}
