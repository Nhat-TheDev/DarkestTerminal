import type { KeyEvent, StyledText } from "@opentui/core";
import type { Game } from "../../engine/game";
import { shownOptions } from "../../engine/reflection";
import { campReflectionContent } from "../../data/loreExposure";
import { t } from "../../data/strings";
import { answerLines, formatEffectLine } from "../effectLine";
import { digitHint } from "../keyHints";
import { PALETTE, colorChunk, joinLines } from "../theme";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";

export type CampReflectionUiState = Extract<UiState, { kind: "campReflection" }>;

function shownAnswers(game: Game) {
  const tier = game.state.pendingCampReflectionTier;
  return tier === null ? [] : shownOptions(game.state, campReflectionContent(tier).options);
}

export function handleKey(ctx: ScreenContext, _ui: CampReflectionUiState, _key: KeyEvent, digit: number | null): void {
  if (digit === null || digit > shownAnswers(ctx.game).length) return;
  const outcome = ctx.game.pickCampReflectionChoice(digit - 1);
  if (outcome) ctx.logInfo(t("reflection.result", { effects: formatEffectLine(ctx.game.state, [outcome]) }));
  ctx.syncUiToGameState();
}

export function renderMain(game: Game, _ui: CampReflectionUiState): StyledText | string {
  const tier = game.state.pendingCampReflectionTier;
  if (tier === null) return "";
  return joinLines([[colorChunk(campReflectionContent(tier).prompt, PALETTE.text)], [], ...answerLines(game.state, shownAnswers(game))]);
}

export function renderFooter(game: Game): string {
  return digitHint("ui.footerCampReflection", shownAnswers(game).length);
}
