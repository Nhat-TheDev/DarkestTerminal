import type { Character, EventDefinition, EventKind, GameState, Id, Room } from "../../types";
import type { PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { t } from "../../data/strings";
import { getRoom } from "../dungeon";
import { escalationThreshold, getEvent } from "../../data/events";
import { BALANCE } from "../../data/balanceConfig";
import { LORE_EXPOSURE_EVENT_IDS } from "../../data/loreExposure";

export function payHpPercent(character: Character, percent: number): number | null {
  const cost = Math.floor((character.maxHp * percent) / 100);
  if (cost >= character.hp) return null;
  character.hp -= cost;
  return cost;
}

/** Tags the current room's event with how the party resolved it (`GameState.eventOutcomes`). */
export function recordEventOutcome(state: GameState, outcome: string): void {
  const eventId = getRoom(state.floor, state.currentRoomId).rolledEventId;
  if (eventId) state.eventOutcomes[eventId] = outcome;
}

/** The pending offer state, only while it belongs to an event of `kind`. */
export function activeEventOfKind(state: GameState, kind: EventKind): NonNullable<GameState["activeEvent"]> | null {
  const active = state.activeEvent;
  return active && getEvent(active.eventId).kind === kind ? active : null;
}

export function closeEvent(state: GameState): void {
  const room = getRoom(state.floor, state.currentRoomId);
  room.cleared = true;
  state.activeEvent = null;
  // Marked only once the visit closes: the events screen re-derives alreadyMet on every re-render, so
  // marking it earlier would switch to the return text mid-way through the first visit.
  if (room.rolledEventId) {
    const event = getEvent(room.rolledEventId);
    if (event.returnDescription && !state.metNarrativeNpcIds.includes(event.id)) {
      state.metNarrativeNpcIds.push(event.id);
    }
    if (event.onceLifetime && !state.firedOnceEventIds.includes(event.id)) {
      state.firedOnceEventIds.push(event.id);
    }
    if (state.eventOutcomes[event.id] === undefined) {
      state.eventOutcomes[event.id] = "resolved";
    }
    if (event.freeTake) {
      state.narrativeCounters.freeRewardsTakenCount += 1;
    }
    if (LORE_EXPOSURE_EVENT_IDS.has(event.id)) {
      state.loreExposureCount += 1;
    }
  }
}

/**
 * Safe to call after any event action: until the room is cleared it no-ops and draws no rng.
 * `discard` (a journal scene took the reflection's place) still draws the roll, so the run's rng stream doesn't depend on the journal.
 */
export function maybeTriggerReflection(state: GameState, ctx: EngineContext, discard = false): void {
  if (state.pendingReflection) return;
  const room = getRoom(state.floor, state.currentRoomId);
  if (!room.cleared || !room.rolledEventId) return;
  const event = getEvent(room.rolledEventId);
  // A reflection may describe the event's core action; `reflectionRequiresOutcome` skips it when the party merely left.
  if (!event.reflection) return;
  if (event.reflectionRequiresOutcome && state.eventOutcomes[event.id] !== event.reflectionRequiresOutcome) return;
  const alreadySeen = event.id in state.eventReflectionStances;
  const chance = alreadySeen ? BALANCE.events.reflectionRepeatChance : 1;
  if (ctx.rng.chance(chance) && !discard) state.pendingReflection = { eventId: event.id };
}

/** How far an event's `escalation` has gone: 0 below its first threshold; tiers 2 and 3 also need their floor depth. Counters never reset, so no room-level flag is needed. */
export function escalationTier(state: GameState, event: EventDefinition): 0 | 1 | 2 | 3 {
  if (!event.escalation) return 0;
  const counter = state.narrativeCounters[event.escalation.counter];
  const [first, second, third] = event.escalation.thresholds.map(escalationThreshold) as [number, number, number];
  if (counter >= third && state.floor.depth >= BALANCE.events.chainTier3MinFloorDepth) return 3;
  if (counter >= second && state.floor.depth >= BALANCE.events.chainTier2MinFloorDepth) return 2;
  return counter >= first ? 1 : 0;
}

export function pickReflectionPrompt(state: GameState, room: Room, event: EventDefinition): string | undefined {
  if (!event.reflection) return undefined;

  const tier = escalationTier(state, event);
  const escalated3 = room.chainVariant === "forced3" || tier >= 3;
  if (escalated3 && event.reflection.escalated3Prompt) return event.reflection.escalated3Prompt;

  const escalated2 = room.chainVariant === "forced2" || room.chainVariant === "forced3" || tier >= 2;
  if (escalated2 && event.reflection.escalated2Prompt) return event.reflection.escalated2Prompt;

  const escalated = room.chainVariant === "forced" || room.chainVariant === "forced2" || room.chainVariant === "forced3" || tier >= 1;
  return (escalated && event.reflection.escalatedPrompt) || event.reflection.prompt;
}

export function findPartyMemberOrError(state: GameState, characterId: Id): Character | PartyActionError {
  const character = state.party.find((c) => c.id === characterId);
  return character ?? { reason: t("errors.characterNotFound") };
}

export function findArtifactOwner(state: GameState, artifactId: Id): Character | undefined {
  return state.party.find((c) => c.equippedArtifactIds.includes(artifactId));
}
