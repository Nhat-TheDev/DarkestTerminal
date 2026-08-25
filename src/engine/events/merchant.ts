import type { GameState, Id, ArtifactRarity } from "../../types";
import type { PartyActionError } from "../party";
import { getArtifact } from "../../data/artifacts";
import { t } from "../../data/strings";
import { BALANCE } from "../../data/balanceConfig";
import { payHpPercent, closeEvent, findPartyMemberOrError } from "./shared";

export const MERCHANT_PRICE_PERCENT: Record<ArtifactRarity, number> = BALANCE.events.merchantPricePercent;

export function merchantPurchase(state: GameState, offerIndex: number, payerCharacterId: Id): PartyActionError | null {
  const active = state.activeEvent;
  if (!active || active.eventId !== "merchant") return { reason: t("errors.noActiveTrade") };
  const artifactId = active.offerArtifactIds[offerIndex];
  if (!artifactId) return { reason: t("errors.noSuchOffer") };
  const payer = findPartyMemberOrError(state, payerCharacterId);
  if ("reason" in payer) return payer;
  const cost = payHpPercent(payer, MERCHANT_PRICE_PERCENT[getArtifact(artifactId).rarity]);
  if (cost === null) return { reason: t("errors.notEnoughHpToPay") };
  state.unequippedArtifactIds.push(artifactId);
  state.message = t("game.paidHpForArtifact", { payer: payer.name, cost, artifact: getArtifact(artifactId).name });
  closeEvent(state);
  return null;
}

export function merchantLeave(state: GameState): void {
  state.message = t("game.leftEmptyHanded");
  closeEvent(state);
}
