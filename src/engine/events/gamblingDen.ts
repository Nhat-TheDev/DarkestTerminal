import type { GameState, Id } from "../../types";
import type { PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { getArtifact, pickArtifactOfRarity } from "../../data/artifacts";
import { t } from "../../data/strings";
import { closeEvent } from "./shared";

export function gamblingDenBet(state: GameState, ctx: EngineContext, artifactId: Id): PartyActionError | null {
  const idx = state.unequippedArtifactIds.indexOf(artifactId);
  if (idx === -1) return { reason: t("errors.artifactMustBeUnequippedToBet") };
  const rarity = getArtifact(artifactId).rarity;
  if (ctx.rng.chance(0.5)) {
    const wonArtifactId = pickArtifactOfRarity(rarity, ctx.rng);
    state.unequippedArtifactIds.push(wonArtifactId);
    state.message = t("game.gambleWin", { artifact: getArtifact(wonArtifactId).name });
  } else {
    state.unequippedArtifactIds.splice(idx, 1);
    state.message = t("game.gambleLose", { artifact: getArtifact(artifactId).name });
  }
  closeEvent(state);
  return null;
}

export function gamblingDenLeave(state: GameState): void {
  state.message = t("game.leftNoBet");
  closeEvent(state);
}
