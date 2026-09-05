import type { GameState } from "../../types";
import { grantArtifact, type PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { rollArtifact } from "../../data/artifacts";
import { getEvent } from "../../data/events";
import { t } from "../../data/strings";
import { getRoom } from "../dungeon";
import { closeEvent } from "./shared";

export function openChest(state: GameState, ctx: EngineContext): PartyActionError | null {
  const room = getRoom(state.floor, state.currentRoomId);
  if (room.cleared || !room.rolledEventId) return { reason: t("errors.nothingToDecide") };
  const event = getEvent(room.rolledEventId);
  if (event.kind !== "instantReward") return { reason: t("errors.nothingToDecide") };
  // Part C.4 — still-breathing is deliberately "no artifact, no stat effect of any kind."
  if (!event.noArtifactReward) {
    // A scene whose reward is a specific object described in the text itself (waiting-supplies'
    // bundle, vigil-candle's offering) grants exactly that artifact, not a random roll.
    const artifactId = event.guaranteedArtifactId ?? rollArtifact("treasureOrEvent", ctx.rng);
    grantArtifact(state, artifactId);
  }
  closeEvent(state);
  return null;
}
