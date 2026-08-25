import type { GameState, Id } from "../../types";
import { unequipArtifact as unequipArtifactFromCharacter, type PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { getArtifact, rollArtifactWithMinRarity } from "../../data/artifacts";
import { t } from "../../data/strings";
import { closeEvent } from "./shared";

export function sacrifice(state: GameState, ctx: EngineContext, sacrificeArtifactId: Id): PartyActionError | null {
  const owner = state.party.find((c) => c.equippedArtifactIds.includes(sacrificeArtifactId));
  if (owner) {
    const err = unequipArtifactFromCharacter(state, owner.id, sacrificeArtifactId);
    if (err) return err;
  }
  const idx = state.unequippedArtifactIds.indexOf(sacrificeArtifactId);
  if (idx === -1) return { reason: t("errors.artifactNotOwned") };
  const rarity = getArtifact(sacrificeArtifactId).rarity;
  state.unequippedArtifactIds.splice(idx, 1);
  const newArtifactId = rollArtifactWithMinRarity(rarity, ctx.rng);
  state.unequippedArtifactIds.push(newArtifactId);
  state.message = t("game.sacrificeResult", { old: getArtifact(sacrificeArtifactId).name, new: getArtifact(newArtifactId).name });
  return null;
}

export function sacrificeLeave(state: GameState): void {
  state.message = t("game.leftRitual");
  closeEvent(state);
}
