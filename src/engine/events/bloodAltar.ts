import type { GameState, Id } from "../../types";
import type { PartyActionError } from "../party";
import { grantArtifact } from "../party";
import type { EngineContext } from "../combat";
import { getArtifact, rollArtifact } from "../../data/artifacts";
import { t } from "../../data/strings";
import { BALANCE } from "../../data/balanceConfig";
import { payHpPercent, closeEvent, findPartyMemberOrError } from "./shared";

export const BLOOD_ALTAR_HP_PERCENT = BALANCE.events.bloodAltarHpPercent;

export function bloodAltarPay(state: GameState, ctx: EngineContext, characterId: Id): PartyActionError | null {
  const character = findPartyMemberOrError(state, characterId);
  if ("reason" in character) return character;
  const cost = payHpPercent(character, BLOOD_ALTAR_HP_PERCENT);
  if (cost === null) return { reason: t("errors.notEnoughHpToPay") };
  // Counted before this payment's own increment.
  const allowShard = state.narrativeCounters.altarPaymentsCount >= BALANCE.events.bloodDebtThreshold2 ? "blood-altar" : undefined;
  const artifactId = rollArtifact("treasureOrEvent", ctx.rng, state.floor.depth, allowShard);
  state.message = t("game.paidHpForArtifact", { payer: character.name, cost, artifact: getArtifact(artifactId).name });
  grantArtifact(state, artifactId);
  state.narrativeCounters.altarPaymentsCount += 1;
  state.eventOutcomes["blood-altar"] = "paid";
  closeEvent(state);
  return null;
}

export function bloodAltarLeave(state: GameState): void {
  state.message = t("game.leftWithoutPaying");
  state.eventOutcomes["blood-altar"] = "declined";
  closeEvent(state);
}
