import type { GameState } from "../../types";
import { grantArtifact, type PartyActionError } from "../party";
import { t } from "../../data/strings";
import { closeEvent } from "./shared";

/** The forced equip happens later, through the pending-artifact-decision flow. */
export function twinAltarsChoose(state: GameState, offerIndex: 0 | 1): PartyActionError | null {
  const active = state.activeEvent;
  if (!active || active.eventId !== "twin-altars") return { reason: t("errors.noActiveChoice") };
  const artifactId = active.offerArtifactIds[offerIndex];
  if (!artifactId) return { reason: t("errors.noSuchOffer") };
  grantArtifact(state, artifactId, true);
  closeEvent(state);
  return null;
}
