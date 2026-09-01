import type { GameState } from "../../types";
import { grantArtifact, type PartyActionError } from "../party";
import { t } from "../../data/strings";
import { closeEvent } from "./shared";

/** Reveal-and-pick step only. The forced equip happens through the shared pending-artifact-decision flow, which skips the Discard option. */
export function twinAltarsChoose(state: GameState, offerIndex: 0 | 1): PartyActionError | null {
  const active = state.activeEvent;
  if (!active || active.eventId !== "twin-altars") return { reason: t("errors.noActiveChoice") };
  const artifactId = active.offerArtifactIds[offerIndex];
  if (!artifactId) return { reason: t("errors.noSuchOffer") };
  grantArtifact(state, artifactId, true);
  closeEvent(state);
  return null;
}
