import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { t } from "../../data/strings";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";

/** 10-event-narrative.md §F.5 — the founder's pre-fight dialogue, floor 120. A single confirm
    action starts the fight itself (`Game.enterFounderFight()`), matching every other "read this,
    then act" scene in the game rather than inventing a new interaction shape for 1 encounter. */
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
  return t("ui.footerChoose");
}
