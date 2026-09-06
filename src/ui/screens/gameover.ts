import type { Game } from "../../engine/game";
import { getAbility } from "../../data/abilities";
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
  const base = t(key ?? "ui.defeatScreen");
  const results = game.state.abilityDeathResults;
  if (!results || results.length === 0) return base;

  const lines = [base, "", t("ui.abilityResultsTitle")];
  for (const result of results) {
    const character = game.state.party.find((c) => c.id === result.characterId);
    const ability = getAbility(result.lostAbilityId);
    lines.push(
      result.outcome === "reclaimed"
        ? t("ui.abilityResultReclaimed", { character: character?.name ?? "", ability: ability.name })
        : t("ui.abilityResultLost", { character: character?.name ?? "", ability: ability.name })
    );
  }
  return lines.join("\n");
}

export function renderFooter(): string {
  return t("ui.footerGameOver");
}
