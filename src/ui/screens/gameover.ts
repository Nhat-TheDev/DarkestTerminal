import type { Game } from "../../engine/game";
import { getAbility } from "../../data/abilities";
import { t } from "../../data/strings";

export function renderMain(game: Game): string {
  const base = game.state.gameOver === "victory" ? t("ui.victoryScreen") : t("ui.defeatScreen");
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
