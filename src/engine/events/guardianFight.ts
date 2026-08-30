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
  state.message = t("dungeon.skippedGuardianFight", { room: room.name });
  closeEvent(state);
  return null;
}
