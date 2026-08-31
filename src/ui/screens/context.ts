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
  getPendingCampOffer(): boolean;
  setPendingCampOffer(value: boolean): void;
  getListPage(): number;
  setListPage(value: number): void;
}

export function advanceFloorWithAutoSave(ctx: ScreenContext): void {
  const depthBefore = ctx.game.state.floor.depth;
  ctx.game.advanceToNextFloor();
  if (ctx.game.state.floor.depth > depthBefore) autoSave(ctx.game);
}

/**
 * A still-pending artifact decision must resolve before the floor advances — otherwise the new
 * floor's entry-room ambush could bury it under a fresh fight. If one is pending, show it and leave
 * `pendingFloorAdvance` set; the artifact-decision screen calls this again once resolved.
 */
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

/**
 * Post-victory order: artifact decision, then camp offer, then floor advance. A pending artifact
 * decision takes priority so the player judges it before being asked to spend an Exploration Kit;
 * the camp-offer flag is left untouched so it still fires once resolved.
 */
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
