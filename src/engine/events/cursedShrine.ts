import type { GameState } from "../../types";
import type { PartyActionError } from "../party";
import { getArtifact } from "../../data/artifacts";
import { t } from "../../data/strings";
import { closeEvent } from "./shared";

export function cursedShrineDecide(state: GameState, accept: boolean): PartyActionError | null {
  const active = state.activeEvent;
  if (!active || active.eventId !== "cursed-shrine") return { reason: t("errors.nothingToDecide") };
  const artifactId = active.offerArtifactIds[0]!;
  if (accept) {
    state.unequippedArtifactIds.push(artifactId);
    state.message = t("game.receivedArtifact", { artifact: getArtifact(artifactId).name });
  } else {
    state.message = t("game.declinedLeft");
  }
  closeEvent(state);
  return null;
}
