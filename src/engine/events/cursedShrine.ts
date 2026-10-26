import type { GameState } from "../../types";
import type { PartyActionError } from "../party";
import { grantArtifact } from "../party";
import { t } from "../../data/strings";
import { activeEventOfKind, closeEvent } from "./shared";

export function cursedShrineDecide(state: GameState, accept: boolean): PartyActionError | null {
  const active = activeEventOfKind(state, "cursedOffer");
  if (!active) return { reason: t("errors.nothingToDecide") };
  const artifactId = active.offerArtifactIds[0]!;
  if (accept) {
    grantArtifact(state, artifactId);
  } else {
    state.message = t("game.declinedLeft");
  }
  closeEvent(state);
  return null;
}
