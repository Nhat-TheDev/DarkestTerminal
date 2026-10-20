import type { GameState, Room } from "../../types";
import type { PartyActionError } from "../party";
import type { EngineContext } from "../combat";
import { startCombat } from "../combat";
import { getEvent } from "../../data/events";
import { spawnEventGuardianMonsters } from "../../data/floor";
import { t } from "../../data/strings";
import { getRoom } from "../dungeon";
import { applyBlessing } from "./gatekeeper";
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
  // Reset so the chain can fire again later; `guardianGrudgeFiredCount` never resets.
  if (room.chainVariant === "forced" || room.chainVariant === "forced2" || room.chainVariant === "forced3") {
    state.narrativeCounters.guardianFightsSkipped = 0;
    state.narrativeCounters.guardianGrudgeFiredCount += 1;
  }
  const monsters = spawnEventGuardianMonsters(ctx.rng, state.floor.depth);
  ctx.monsters.push(...monsters);
  room.monsterIds = monsters.map((m) => m.id);
  state.combat = startCombat(room.id, room.monsterIds, ctx, false);
  applyBlessing(state, ctx, room.id);
  state.message = t("dungeon.ambush", { room: room.name });
  return null;
}

export function guardianFightSkip(state: GameState): PartyActionError | null {
  const room = guardianFightRoomOrError(state);
  if ("reason" in room) return room;
  // Backstop: the UI already hides Skip for forced variants.
  if (room.chainVariant === "forced" || room.chainVariant === "forced2" || room.chainVariant === "forced3") return { reason: t("errors.nothingToDecide") };
  state.narrativeCounters.guardianFightsSkipped += 1;
  state.message = t("dungeon.skippedGuardianFight", { room: room.name });
  // Distinct from the win path's "resolved", so outcome-gated text written for a won fight never follows a skip.
  state.eventOutcomes[room.rolledEventId!] = "skipped";
  closeEvent(state);
  return null;
}
