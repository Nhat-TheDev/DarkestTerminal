import type { Character, GameState, Id } from "../../types";
import type { PartyActionError } from "../party";
import { t } from "../../data/strings";
import { getRoom } from "../dungeon";
import { getEvent } from "../../data/events";

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

export function findPartyMemberOrError(state: GameState, characterId: Id): Character | PartyActionError {
  const character = state.party.find((c) => c.id === characterId);
  return character ?? { reason: t("errors.characterNotFound") };
}

export function findArtifactOwner(state: GameState, artifactId: Id): Character | undefined {
  return state.party.find((c) => c.equippedArtifactIds.includes(artifactId));
}
