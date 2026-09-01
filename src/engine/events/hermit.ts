import type { GameState, Id } from "../../types";
import { removeArtifactFromCharacter, grantArtifact, type PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { getArtifact, rollArtifactWithMinRarity } from "../../data/artifacts";
import { t } from "../../data/strings";
import { BALANCE } from "../../data/balanceConfig";
import { closeEvent, findArtifactOwner } from "./shared";

const HERMIT_EXCHANGE_COST_COINS = BALANCE.events.wanderingHermitExchangeCostCoins;

/** The room's only service; also the sole way a Cursed artifact can leave a character. */
export function hermitExchangeFortune(state: GameState, ctx: EngineContext, artifactId: Id): PartyActionError | null {
  const owner = findArtifactOwner(state, artifactId);
  if (!owner) return { reason: t("errors.artifactNotOwned") };
  if (state.coins < HERMIT_EXCHANGE_COST_COINS) return { reason: t("errors.notEnoughCoins") };
  const rarity = getArtifact(artifactId).rarity;
  state.coins -= HERMIT_EXCHANGE_COST_COINS;
  const err = removeArtifactFromCharacter(state, owner.id, artifactId);
  if (err) return err;
  const newArtifactId = rollArtifactWithMinRarity(rarity, ctx.rng);
  state.message = t("game.hermitExchanged", { old: getArtifact(artifactId).name, new: getArtifact(newArtifactId).name, cost: HERMIT_EXCHANGE_COST_COINS });
  grantArtifact(state, newArtifactId);
  closeEvent(state);
  return null;
}

export function hermitLeave(state: GameState): void {
  state.message = t("game.leftGeneric");
  closeEvent(state);
}
