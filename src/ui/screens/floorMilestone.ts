import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { t } from "../../data/strings";
import { getFloorMilestoneOmen } from "../../data/floorMilestones";
import type { UiState } from "../state";
import { proceedAfterVictory, type ScreenContext } from "./context";

export type FloorMilestoneUiState = Extract<UiState, { kind: "floorMilestone" }>;

export function handleKey(ctx: ScreenContext, _ui: FloorMilestoneUiState, key: KeyEvent, _digit: number | null): void {
  if (key.name !== "return") return;
  ctx.game.dismissFloorMilestoneMessage();
  proceedAfterVictory(ctx);
}

export function renderMain(game: Game, _ui: FloorMilestoneUiState): string {
  const id = game.state.pendingFloorMilestoneOmenId;
  return (id && getFloorMilestoneOmen(id)?.text) || "";
}

export function renderFooter(_ui: FloorMilestoneUiState): string {
  return t("ui.footerFloorMilestone");
}
