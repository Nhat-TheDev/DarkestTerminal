import type { Character, EventDefinition, GameState, Id, Room } from "../../types";
import type { PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { t } from "../../data/strings";
import { getRoom } from "../dungeon";
import { getEvent } from "../../data/events";
import { BALANCE } from "../../data/balanceConfig";
import { LORE_EXPOSURE_EVENT_IDS } from "../../data/loreExposure";
import { markRetiredCharacterEventShown } from "../profile";

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
    if (event.id === "the-one-who-stayed") {
      markRetiredCharacterEventShown();
    }
  }
}

/** Safe to call after any event action: until the room is cleared it no-ops and draws no rng. */
export function maybeTriggerReflection(state: GameState, ctx: EngineContext): void {
  if (state.pendingReflection) return;
  const room = getRoom(state.floor, state.currentRoomId);
  if (!room.cleared || !room.rolledEventId) return;
  const event = getEvent(room.rolledEventId);
  // A reflection may describe the event's core action; `reflectionRequiresOutcome` skips it when the party merely left.
  if (!event.reflection) return;
  if (event.reflectionRequiresOutcome && state.eventOutcomes[event.id] !== event.reflectionRequiresOutcome) return;
  const alreadySeen = event.id in state.eventReflectionStances;
  const chance = alreadySeen ? BALANCE.events.reflectionRepeatChance : 1;
  if (ctx.rng.chance(chance)) state.pendingReflection = { eventId: event.id };
}

function isTier2Escalated(state: GameState, counter: number, threshold2: number): boolean {
  return counter >= threshold2 && state.floor.depth >= BALANCE.events.chainTier2MinFloorDepth;
}

function isTier3Escalated(state: GameState, counter: number, threshold3: number): boolean {
  return counter >= threshold3 && state.floor.depth >= BALANCE.events.chainTier3MinFloorDepth;
}

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
