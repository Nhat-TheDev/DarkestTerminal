import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import { finishVictorySequence, type ScreenContext } from "./context";

export type CampUiState = Extract<UiState, { kind: "campPrompt" }>;

export function handleKey(ctx: ScreenContext, _ui: CampUiState, _key: KeyEvent, digit: number | null): void {
  if (digit === 1) {
    const err = ctx.game.camp();
    if (err) ctx.reportUnusable(err.reason);
    else ctx.logInfo(ctx.game.state.message);
  }
  if (digit === 1 || digit === 2) finishVictorySequence(ctx);
}

export function renderMain(game: Game, _ui: CampUiState): string {
  const remaining = game.state.inventory["exploration-kit"] ?? 0;
  return [t("ui.campOption", { i: 1, remaining }), t("ui.campSkipOption")].join("\n");
}

export function renderFooter(_ui: CampUiState): string {
  return t("ui.footerChoose");
}
