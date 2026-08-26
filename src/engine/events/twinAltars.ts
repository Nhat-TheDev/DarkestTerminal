import type { GameState } from "../../types";
import { grantArtifact, type PartyActionError } from "../party";
import { t } from "../../data/strings";
import { closeEvent } from "./shared";

/** Reveal-and-pick step only. The actual forced equip (character + possible replacement) happens through the same shared pending-artifact-decision flow every other source uses (A.2/A.4) — `forceEquip: true` skips the Discard option there. */
export function twinAltarsChoose(state: GameState, offerIndex: 0 | 1): PartyActionError | null {
  const active = state.activeEvent;
  if (!active || active.eventId !== "twin-altars") return { reason: t("errors.noActiveChoice") };
  const artifactId = active.offerArtifactIds[offerIndex];
  if (!artifactId) return { reason: t("errors.noSuchOffer") };
  grantArtifact(state, artifactId, "event", true);
  closeEvent(state);
  return null;
}
