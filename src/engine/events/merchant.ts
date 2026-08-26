import type { GameState, ArtifactRarity } from "../../types";
import { grantArtifact, type PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { getArtifact, rollArtifact } from "../../data/artifacts";
import { t } from "../../data/strings";
import { BALANCE } from "../../data/balanceConfig";
import { closeEvent } from "./shared";

export const MERCHANT_PRICE_COINS: Record<ArtifactRarity, number> = BALANCE.events.merchantPriceCoins;
const MERCHANT_OFFER_COUNT = BALANCE.events.merchantOfferCount;
const MERCHANT_REFRESH_COST_COINS = BALANCE.events.merchantRefreshCostCoins;
const MERCHANT_MAX_REFRESHES = BALANCE.events.merchantMaxRefreshes;

export function merchantPurchase(state: GameState, offerIndex: number): PartyActionError | null {
  const active = state.activeEvent;
  if (!active || active.eventId !== "merchant") return { reason: t("errors.noActiveTrade") };
  const artifactId = active.offerArtifactIds[offerIndex];
  if (!artifactId) return { reason: t("errors.noSuchOffer") };
  const cost = MERCHANT_PRICE_COINS[getArtifact(artifactId).rarity];
  if (state.coins < cost) return { reason: t("errors.notEnoughCoins") };
  state.coins -= cost;
  state.message = t("game.merchantPurchaseCoins", { cost, artifact: getArtifact(artifactId).name });
  grantArtifact(state, artifactId, "event");
  closeEvent(state);
  return null;
}

export function merchantRefresh(state: GameState, ctx: EngineContext): PartyActionError | null {
  const active = state.activeEvent;
  if (!active || active.eventId !== "merchant") return { reason: t("errors.noActiveTrade") };
  const refreshCount = active.refreshCount ?? 0;
  if (refreshCount >= MERCHANT_MAX_REFRESHES) return { reason: t("errors.merchantMaxRefreshesReached") };
  if (state.coins < MERCHANT_REFRESH_COST_COINS) return { reason: t("errors.notEnoughCoins") };
  state.coins -= MERCHANT_REFRESH_COST_COINS;
  active.offerArtifactIds = Array.from({ length: MERCHANT_OFFER_COUNT }, () => rollArtifact("treasureOrEvent", ctx.rng));
  active.refreshCount = refreshCount + 1;
  state.message = t("game.merchantRefreshed");
  return null;
}

export function merchantLeave(state: GameState): void {
  state.message = t("game.leftEmptyHanded");
  closeEvent(state);
}
