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
 * After a floor-advance check (roomReward/campPrompt already resolved), return to the normal
 * game-state-derived screen. A still-pending artifact decision (e.g. from the boss kill that just
 * ended the fight) must be resolved BEFORE the floor advances — otherwise the new floor's entry-room
 * ambush can start a fresh combat that buries the decision until that fight is over too. So: if one
 * is pending, show it now and leave `pendingFloorAdvance` set for next time — the artifact-decision
 * screen calls this same function again once the player resolves it, which is when the floor actually
 * advances.
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
 * Post-victory sequence: Artifact decision (if any) is shown first, then the Camp offer (C.5),
 * then the floor-advance check. A pending Artifact decision takes priority over the Camp prompt so
 * the player judges the new Artifact before being asked to spend an Exploration Kit; the camp-offer
 * flag is left untouched here so it still fires once the decision is resolved (this function is
 * called again from artifactDecision.ts).
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
