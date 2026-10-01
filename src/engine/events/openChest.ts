import type { GameState } from "../../types";
import { grantArtifact, type PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { rollArtifact } from "../../data/artifacts";
import { getEvent } from "../../data/events";
import { getItem } from "../../data/items";
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
    const artifactId = event.guaranteedArtifactId ?? rollArtifact("treasureOrEvent", ctx.rng, state.floor.depth);
    grantArtifact(state, artifactId);
  }
  if (event.guaranteedItems?.length) {
    for (const { itemId, count } of event.guaranteedItems) state.inventory[itemId] = (state.inventory[itemId] ?? 0) + count;
    const received = event.guaranteedItems.map(({ itemId, count }) => `${getItem(itemId).name} ×${count}`).join(", ");
    state.message = t("game.receivedItems", { items: received });
  }
  closeEvent(state);
  return null;
}
