import type { Game } from "../../engine/game";
import { autoSave } from "../../engine/save";
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

export function advanceFloorWithAutoSave(ctx: ScreenContext): void {
  const depthBefore = ctx.game.state.floor.depth;
  ctx.game.advanceToNextFloor();
  if (ctx.game.state.floor.depth > depthBefore) autoSave(ctx.game);
}
