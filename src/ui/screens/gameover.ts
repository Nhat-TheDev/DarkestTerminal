import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import { getAbility } from "../../data/abilities";
import { t } from "../../data/strings";
import type { ScreenContext } from "./context";

const ENDING_SCREENS: Partial<Record<NonNullable<Game["state"]["gameOver"]>, string>> = {
  victory: "ui.victoryScreen",
  stay: "ui.endingStayScreen",
  letGo: "ui.endingLetGoScreen",
  leaveAmbushed: "ui.endingLeaveAmbushedScreen",
  leaveEscaped: "ui.endingLeaveEscapedScreen",
};

export function renderMain(game: Game): string {
  const key = game.state.gameOver && ENDING_SCREENS[game.state.gameOver];
  const base = t(key ?? "ui.defeatScreen");
  const lines = [base];
  const results = game.state.abilityDeathResults ?? [];
  if (results.length > 0) lines.push("", t("ui.abilityResultsTitle"));
  for (const result of results) {
    const character = game.state.party.find((c) => c.id === result.characterId);
    const ability = getAbility(result.lostAbilityId);
    lines.push(
      result.outcome === "reclaimed"
        ? t("ui.abilityResultReclaimed", { character: character?.name ?? "", ability: ability.name })
        : t("ui.abilityResultLost", { character: character?.name ?? "", ability: ability.name })
    );
  }
  lines.push("", t("ui.gameOverNewRunOption"), t("ui.gameOverMenuOption"));
  return lines.join("\n");
}

export function renderFooter(): string {
  return t("ui.footerGameOver");
}

export function handleKey(ctx: ScreenContext, key: KeyEvent): void {
  if (key.name === "n") ctx.exitRun("newRun");
  else if (key.name === "escape") ctx.exitRun("menu");
}
