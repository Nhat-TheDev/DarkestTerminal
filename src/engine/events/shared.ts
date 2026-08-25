import type { Character, GameState } from "../../types";
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
