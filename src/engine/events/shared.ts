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
  }
}

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
  const alreadySeen = event.id in state.eventReflectionStances;
  const chance = alreadySeen ? BALANCE.events.reflectionRepeatChance : 1;
  if (ctx.rng.chance(chance)) state.pendingReflection = { eventId: event.id };
}

/** Picks the reflection prompt for the event pending in `state.pendingReflection` — the escalated
    variant if this resolution was a §10.3 chain-escalated one, otherwise the base prompt. */
export function pickReflectionPrompt(state: GameState, room: Room, event: EventDefinition): string | undefined {
  if (!event.reflection) return undefined;
  const escalated =
    room.chainVariant === "forced" ||
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
