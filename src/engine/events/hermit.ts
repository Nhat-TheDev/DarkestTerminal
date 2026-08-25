import type { GameState, Id } from "../../types";
import { recomputeCharacterStats, unequipArtifact as unequipArtifactFromCharacter, type PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { getArtifact, rollArtifact } from "../../data/artifacts";
import { t } from "../../data/strings";
import { closeEvent, findPartyMemberOrError, findArtifactOwner } from "./shared";

export function hermitRemoveCurse(state: GameState, characterId: Id, artifactId: Id): PartyActionError | null {
  const character = findPartyMemberOrError(state, characterId);
  if ("reason" in character) return character;
  if (!getArtifact(artifactId).isCursed) return { reason: t("errors.artifactNotCursed") };
  const idx = character.equippedArtifactIds.indexOf(artifactId);
  if (idx === -1) return { reason: t("errors.artifactNotEquippedOnCharacter") };
  character.equippedArtifactIds.splice(idx, 1);
  recomputeCharacterStats(character);
  state.message = t("game.curseRemoved", { artifact: getArtifact(artifactId).name, character: character.name });
  closeEvent(state);
  return null;
}

export function hermitRerollFortune(state: GameState, ctx: EngineContext, artifactId: Id): PartyActionError | null {
  const owner = findArtifactOwner(state, artifactId);
  if (owner) {
    const err = unequipArtifactFromCharacter(state, owner.id, artifactId);
    if (err) return err;
  }
  const idx = state.unequippedArtifactIds.indexOf(artifactId);
  if (idx === -1) return { reason: t("errors.artifactNotOwned") };
  state.unequippedArtifactIds.splice(idx, 1);
  const newArtifactId = rollArtifact("treasureOrEvent", ctx.rng);
  state.unequippedArtifactIds.push(newArtifactId);
  state.message = t("game.fortuneTraded", { old: getArtifact(artifactId).name, new: getArtifact(newArtifactId).name });
  closeEvent(state);
  return null;
}

export function hermitLeave(state: GameState): void {
  state.message = t("game.leftGeneric");
  closeEvent(state);
}
