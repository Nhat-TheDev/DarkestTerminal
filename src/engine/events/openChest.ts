import type { GameState } from "../../types";
import { grantArtifact, type PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { rollArtifact } from "../../data/artifacts";
import { getEvent } from "../../data/events";
import { getItem } from "../../data/items";
import { t } from "../../data/strings";
import { getRoom } from "../dungeon";
import { addItem } from "../survival";
import { closeEvent } from "./shared";

export function openChest(state: GameState, ctx: EngineContext): PartyActionError | null {
  const room = getRoom(state.floor, state.currentRoomId);
  if (room.cleared || !room.rolledEventId) return { reason: t("errors.nothingToDecide") };
  const event = getEvent(room.rolledEventId);
  if (event.kind !== "instantReward") return { reason: t("errors.nothingToDecide") };
  if (!event.noArtifactReward) {
    const artifactId = event.guaranteedArtifactId ?? rollArtifact("treasureOrEvent", ctx.rng, state.floor.depth);
    grantArtifact(state, artifactId);
  }
  if (event.guaranteedItems?.length) {
    const received = event.guaranteedItems
      .map(({ itemId, count }) => ({ itemId, count: addItem(state, itemId, count) }))
      .filter(({ count }) => count > 0)
      .map(({ itemId, count }) => `${getItem(itemId).name} ×${count}`);
    if (received.length > 0) state.message = t("game.receivedItems", { items: received.join(", ") });
  }
  closeEvent(state);
  return null;
}
