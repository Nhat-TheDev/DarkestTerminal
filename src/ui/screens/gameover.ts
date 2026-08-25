import type { Game } from "../../engine/game";
import { t } from "../../data/strings";

export function renderMain(game: Game): string {
  return game.state.gameOver === "victory" ? t("ui.victoryScreen") : t("ui.defeatScreen");
}

export function renderFooter(): string {
  return t("ui.footerGameOver");
}
