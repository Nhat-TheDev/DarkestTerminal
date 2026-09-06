import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { t } from "../../data/strings";
import { CAMP_REFLECTION_CONTENT } from "../../data/loreExposure";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";

/** 03-survival-stats.md's Camp Reflection — deliberately its own screen, not a variant of
    `eventReflection` (events.ts): different trigger (rest-room entry, not `closeEvent()`),
    different content source, no shared state with that mechanism. */
export type CampReflectionUiState = Extract<UiState, { kind: "campReflection" }>;

export function handleKey(ctx: ScreenContext, _ui: CampReflectionUiState, _key: KeyEvent, digit: number | null): void {
  if (digit === 1 || digit === 2 || digit === 3) {
    ctx.game.pickCampReflectionChoice((digit - 1) as 0 | 1 | 2);
    ctx.syncUiToGameState();
  }
}

export function renderMain(game: Game, _ui: CampReflectionUiState): string {
  const tier = game.state.pendingCampReflectionTier;
  if (tier === null) return "";
  const { prompt, options } = CAMP_REFLECTION_CONTENT[tier];
  return [prompt, "", `  [1] ${options[0]}`, `  [2] ${options[1]}`, `  [3] ${options[2]}`].join("\n");
}

export function renderFooter(_ui: CampReflectionUiState): string {
  return t("ui.footerChoose");
}
