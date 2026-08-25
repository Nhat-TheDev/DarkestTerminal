import type { GameState, Id } from "../../types";
import { equipArtifact as equipArtifactOnCharacter, unequipArtifact as unequipArtifactFromCharacter, MAX_EQUIPPED_ARTIFACTS, type PartyActionError } from "../party";
import { getArtifact } from "../../data/artifacts";
import { t } from "../../data/strings";
import { closeEvent, findPartyMemberOrError } from "./shared";

export function twinAltarsChoose(state: GameState, offerIndex: 0 | 1, characterId: Id, unequipArtifactId?: Id): PartyActionError | null {
  const active = state.activeEvent;
  if (!active || active.eventId !== "twin-altars") return { reason: t("errors.noActiveChoice") };
  const artifactId = active.offerArtifactIds[offerIndex];
  if (!artifactId) return { reason: t("errors.noSuchOffer") };
  const character = findPartyMemberOrError(state, characterId);
  if ("reason" in character) return character;

  state.unequippedArtifactIds.push(artifactId);
  if (character.equippedArtifactIds.length >= MAX_EQUIPPED_ARTIFACTS) {
    if (!unequipArtifactId) return { reason: t("errors.needUnequipFirst") };
    const unequipErr = unequipArtifactFromCharacter(state, characterId, unequipArtifactId);
    if (unequipErr) return unequipErr;
  }
  const equipErr = equipArtifactOnCharacter(state, characterId, artifactId);
  if (equipErr) return equipErr;
  state.message = t("game.equippedImmediately", { character: character.name, artifact: getArtifact(artifactId).name });
  closeEvent(state);
  return null;
}
