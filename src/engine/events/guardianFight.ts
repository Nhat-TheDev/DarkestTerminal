import type { GameState, Room } from "../../types";
import type { PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { startCombat } from "../combat";
import { getEvent } from "../../data/events";
import { spawnEventGuardianMonsters } from "../../data/floor";
import { t } from "../../data/strings";
import { getRoom } from "../dungeon";
import { closeEvent } from "./shared";

function guardianFightRoomOrError(state: GameState): Room | PartyActionError {
  const room = getRoom(state.floor, state.currentRoomId);
  if (room.cleared || !room.rolledEventId || getEvent(room.rolledEventId).kind !== "combatReward") {
    return { reason: t("errors.nothingToDecide") };
  }
  return room;
}

export function guardianFightEnter(state: GameState, ctx: EngineContext): PartyActionError | null {
  const room = guardianFightRoomOrError(state);
  if ("reason" in room) return room;
  // §10.3 Chain 1: this is the "forced" encounter the player kept skipping — reset the counter now
  // that they're finally taking it, so the chain can fire again later rather than exactly once.
  // `guardianGrudgeFiredCount` never resets (11-world-bible.md §11.13 tier 2, Part C.3 tier 3) —
  // it's how a later firing of this same chain can tell it isn't the first.
  if (room.chainVariant === "forced" || room.chainVariant === "forced2" || room.chainVariant === "forced3") {
    state.narrativeCounters.guardianFightsSkipped = 0;
    state.narrativeCounters.guardianGrudgeFiredCount += 1;
  }
  const monsters = spawnEventGuardianMonsters(ctx.rng, state.floor.depth);
  ctx.monsters.push(...monsters);
  room.monsterIds = monsters.map((m) => m.id);
  state.combat = startCombat(room.id, room.monsterIds, ctx, false);
  state.message = t("dungeon.ambush", { room: room.name });
  return null;
}

export function guardianFightSkip(state: GameState): PartyActionError | null {
  const room = guardianFightRoomOrError(state);
  if ("reason" in room) return room;
  // §10.3 Chain 1: past the forced threshold, Skip isn't offered — this is a 2nd line of defense
  // behind the UI hiding the option, not the primary gate. Tier 2/3 ("forced2"/"forced3") stay just
  // as non-skippable as tier 1.
  if (room.chainVariant === "forced" || room.chainVariant === "forced2" || room.chainVariant === "forced3") return { reason: t("errors.nothingToDecide") };
  state.narrativeCounters.guardianFightsSkipped += 1;
  state.message = t("dungeon.skippedGuardianFight", { room: room.name });
  closeEvent(state);
  return null;
}
