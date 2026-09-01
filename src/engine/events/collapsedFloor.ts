import type { GameState, Id } from "../../types";
import { grantArtifact, type PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { getArtifact, rollArtifact } from "../../data/artifacts";
import { t } from "../../data/strings";
import { BALANCE } from "../../data/balanceConfig";
import { payHpPercent, closeEvent, findPartyMemberOrError } from "./shared";

export const COLLAPSED_FLOOR_HP_PERCENT = BALANCE.events.collapsedFloorHpPercent;
const COLLAPSED_FLOOR_SUCCESS_CHANCE = BALANCE.events.collapsedFloorSuccessChance;

export function collapsedFloorAttempt(state: GameState, ctx: EngineContext, characterId: Id): PartyActionError | null {
  const character = findPartyMemberOrError(state, characterId);
  if ("reason" in character) return character;
  const cost = payHpPercent(character, COLLAPSED_FLOOR_HP_PERCENT);
  if (cost === null) return { reason: t("errors.notEnoughHpToPay") };
  state.narrativeCounters.altarPaymentsCount += 1; // §10.3 Chain 3 — counts the HP payment itself, not the 60% roll outcome
  if (ctx.rng.chance(COLLAPSED_FLOOR_SUCCESS_CHANCE)) {
    const artifactId = rollArtifact("boss", ctx.rng);
    state.message = t("game.collapsedFloorSuccess", { character: character.name, cost, artifact: getArtifact(artifactId).name });
    grantArtifact(state, artifactId);
  } else {
    state.message = t("game.collapsedFloorFail", { character: character.name, cost });
  }
  closeEvent(state);
  return null;
}

export function collapsedFloorLeave(state: GameState): void {
  state.message = t("game.skippedAttempt");
  closeEvent(state);
}
