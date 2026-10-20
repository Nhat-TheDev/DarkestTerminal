import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";

export type FounderDialogueUiState = Extract<UiState, { kind: "founderDialogue" }>;

export function handleKey(ctx: ScreenContext, _ui: FounderDialogueUiState, _key: KeyEvent, digit: number | null): void {
  if (digit === 1) {
    ctx.game.enterFounderFight();
    ctx.syncUiToGameState();
  }
}

export function renderMain(_game: Game, _ui: FounderDialogueUiState): string {
  return [t("ui.founderDialogue"), "", t("ui.founderDialogueOption")].join("\n");
}

export function renderFooter(_ui: FounderDialogueUiState): string {
  return t("ui.footerFounderDialogue");
}
