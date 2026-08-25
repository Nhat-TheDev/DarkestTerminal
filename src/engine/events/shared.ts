import type { Character, GameState, Id } from "../../types";
import type { PartyActionError } from "../party";
import { t } from "../../data/strings";
import { getRoom } from "../dungeon";

export function payHpPercent(character: Character, percent: number): number | null {
  const cost = Math.floor((character.maxHp * percent) / 100);
  if (cost >= character.hp) return null;
  character.hp -= cost;
  return cost;
}

export function closeEvent(state: GameState): void {
  getRoom(state.floor, state.currentRoomId).cleared = true;
  state.activeEvent = null;
}

export function findPartyMemberOrError(state: GameState, characterId: Id): Character | PartyActionError {
  const character = state.party.find((c) => c.id === characterId);
  return character ?? { reason: t("errors.characterNotFound") };
}

export function findArtifactOwner(state: GameState, artifactId: Id): Character | undefined {
  return state.party.find((c) => c.equippedArtifactIds.includes(artifactId));
}
