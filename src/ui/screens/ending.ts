import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { t } from "../../data/strings";
import { endingCheckpointMode } from "../../data/endings";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";

/** 10-event-narrative.md Part F.1's floor-100 checkpoint. Which options are shown is computed live
    from existing state (`endingCheckpointMode`) — nothing about the mode is ever stored, and none
    of it is ever hinted to the player beyond the options actually offered. */
export type EndingCheckpointUiState = Extract<UiState, { kind: "endingCheckpoint" }>;

export function handleKey(ctx: ScreenContext, _ui: EndingCheckpointUiState, _key: KeyEvent, digit: number | null): void {
  const mode = endingCheckpointMode(ctx.game.state);
  if (mode === "leaveOnly") {
    if (digit === 1) ctx.game.pickEndingChoice("leave");
  } else if (digit === 1) {
    ctx.game.pickEndingChoice("stay");
  } else if (digit === 2) {
    ctx.game.pickEndingChoice("letGo");
  } else if (digit === 3 && mode === "full") {
    ctx.game.pickEndingChoice("continue");
  }
  ctx.syncUiToGameState();
}

export function renderMain(game: Game, _ui: EndingCheckpointUiState): string {
  const mode = endingCheckpointMode(game.state);
  if (mode === "leaveOnly") {
    return [t("ui.endingLeaveOnlyPrompt"), "", t("ui.endingLeaveOnlyOption")].join("\n");
  }
  const options = [t("ui.endingStayOption"), t("ui.endingLetGoOption")];
  if (mode === "full") options.push(t("ui.endingContinueOption"));
  return [t("ui.endingCheckpointPrompt"), "", ...options].join("\n");
}

export function renderFooter(_ui: EndingCheckpointUiState): string {
  return t("ui.footerChoose");
}
