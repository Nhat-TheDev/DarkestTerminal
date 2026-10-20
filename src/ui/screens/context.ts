import type { Game } from "../../engine/game";
import { saveRun } from "../../engine/save";
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
  getPendingCampOffer(): boolean;
  setPendingCampOffer(value: boolean): void;
  getListPage(): number;
  setListPage(value: number): void;
}

export function advanceFloorWithAutoSave(ctx: ScreenContext): void {
  const depthBefore = ctx.game.state.floor.depth;
  ctx.game.advanceToNextFloor();
  if (ctx.game.state.floor.depth > depthBefore) saveRun(ctx.game);
}

/** A pending artifact decision resolves before the floor advances, or the new floor's entry ambush could bury it; that screen calls this again. */
export function finishVictorySequence(ctx: ScreenContext): void {
  if (ctx.game.state.pendingArtifactDecision) {
    ctx.syncUiToGameState();
    return;
  }
  if (ctx.getPendingFloorAdvance()) {
    ctx.setPendingFloorAdvance(false);
    advanceFloorWithAutoSave(ctx);
  }
  ctx.syncUiToGameState();
}

/** The camp-offer flag is left set so it still fires once a pending artifact decision resolves. */
export function proceedAfterVictory(ctx: ScreenContext): void {
  if (ctx.game.state.pendingArtifactDecision) {
    ctx.syncUiToGameState();
    return;
  }
  if (ctx.getPendingCampOffer()) {
    ctx.setPendingCampOffer(false);
    if ((ctx.game.state.inventory["exploration-kit"] ?? 0) > 0) {
      ctx.setUi({ kind: "campPrompt" });
      return;
    }
  }
  finishVictorySequence(ctx);
}
