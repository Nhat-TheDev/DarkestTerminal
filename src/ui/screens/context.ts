import type { Game } from "../../engine/game";
import type { UiState } from "../state";

export interface ScreenContext {
  game: Game;
  setUi(next: UiState): void;
  reportUnusable(reason: string): void;
  logInfo(text: string): void;
  syncUiToGameState(): void;
  pushToast(text: string): void;
  quit(): void;
  getPendingFloorAdvance(): boolean;
  setPendingFloorAdvance(value: boolean): void;
}
