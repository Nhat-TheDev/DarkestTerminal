import type { Game } from "../../engine/game";
import { t } from "../../data/strings";

const ENDING_SCREENS: Partial<Record<NonNullable<Game["state"]["gameOver"]>, string>> = {
  victory: "ui.victoryScreen",
  stay: "ui.endingStayScreen",
  letGo: "ui.endingLetGoScreen",
  leaveAmbushed: "ui.endingLeaveAmbushedScreen",
  leaveEscaped: "ui.endingLeaveEscapedScreen",
};

export function renderMain(game: Game): string {
  const key = game.state.gameOver && ENDING_SCREENS[game.state.gameOver];
  return t(key ?? "ui.defeatScreen");
}

export function renderFooter(): string {
  return t("ui.footerGameOver");
}
