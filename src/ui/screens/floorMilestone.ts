import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import { proceedAfterVictory, type ScreenContext } from "./context";

/** §4 of the design spec — shown right after clearing a floor-10-multiple's boss/guard room,
    before the normal post-victory sequence (artifact decision -> camp offer -> floor advance)
    resumes. Purely atmospheric, no mechanical effect of its own. */
export type FloorMilestoneUiState = Extract<UiState, { kind: "floorMilestone" }>;

export function handleKey(ctx: ScreenContext, _ui: FloorMilestoneUiState, key: KeyEvent, _digit: number | null): void {
  if (key.name !== "return") return;
  ctx.game.dismissFloorMilestoneMessage();
  proceedAfterVictory(ctx);
}

export function renderMain(game: Game, _ui: FloorMilestoneUiState): string {
  return game.state.pendingFloorMilestoneMessage ?? "";
}

export function renderFooter(_ui: FloorMilestoneUiState): string {
  return t("ui.footerFloorMilestone");
}
