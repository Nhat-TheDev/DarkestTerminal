import type { GameState, Id } from "../../types";
import { removeArtifactFromCharacter, grantArtifact, type PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { getArtifact, rollArtifactWithMinRarity } from "../../data/artifacts";
import { t } from "../../data/strings";
import { getEvent } from "../../data/events";
import { getRoom } from "../dungeon";
import { closeEvent, recordEventOutcome, findArtifactOwner } from "./shared";

export function sacrifice(state: GameState, ctx: EngineContext, sacrificeArtifactId: Id): PartyActionError | null {
  const room = getRoom(state.floor, state.currentRoomId);
  if (room.cleared || !room.rolledEventId || getEvent(room.rolledEventId).kind !== "artifactSacrifice") return { reason: t("errors.nothingToDecide") };
  const owner = findArtifactOwner(state, sacrificeArtifactId);
  if (!owner) return { reason: t("errors.artifactNotOwned") };
  const rarity = getArtifact(sacrificeArtifactId).rarity;
  const err = removeArtifactFromCharacter(state, owner.id, sacrificeArtifactId);
  if (err) return err;
  const newArtifactId = rollArtifactWithMinRarity(rarity, ctx.rng);
  state.message = t("game.sacrificeResult", { old: getArtifact(sacrificeArtifactId).name, new: getArtifact(newArtifactId).name });
  grantArtifact(state, newArtifactId);
  state.narrativeCounters.artifactsSacrificed += 1;
  recordEventOutcome(state, "sacrificed");
  closeEvent(state);
  return null;
}

export function sacrificeLeave(state: GameState): void {
  state.message = t("game.leftRitual");
  closeEvent(state);
}
