import type { Floor, GameState, Room } from "../types";
import type { EngineContext } from "./combat";
import { startCombat } from "./combat";
import { tickSurvivalOnAction, applyAmbientFear } from "./survival";

export function getRoom(floor: Floor, roomId: string): Room {
  const room = floor.rooms.find((r) => r.id === roomId);
  if (!room) throw new Error(`Unknown room: ${roomId}`);
  return room;
}

export function connectedRooms(floor: Floor, roomId: string): Room[] {
  const room = getRoom(floor, roomId);
  return room.connectedRoomIds.map((id) => getRoom(floor, id));
}

function roomHasLivingMonsters(room: Room, ctx: EngineContext): boolean {
  return room.monsterIds.some((id) => {
    const m = ctx.monsters.find((mo) => mo.id === id);
    return m && m.hp > 0;
  });
}

/**
 * Moves the party into `targetRoomId` (must be connected to the current
 * room). Counts as 1 dungeon action for survival stats, applies ambient
 * fear from darkness, and triggers combat/rest as appropriate.
 */
export function moveToRoom(state: GameState, targetRoomId: string, ctx: EngineContext): void {
  const current = getRoom(state.floor, state.currentRoomId);
  if (!current.connectedRoomIds.includes(targetRoomId)) {
    state.message = "Không thể đi thẳng tới phòng đó.";
    return;
  }

  for (const c of state.party) tickSurvivalOnAction(c, state.combat?.log ?? []);
  for (const c of state.party) applyAmbientFear(c, state.floor.darknessLevel);

  state.currentRoomId = targetRoomId;
  const room = getRoom(state.floor, targetRoomId);

  if ((room.type === "combat" || room.type === "boss") && !room.cleared && roomHasLivingMonsters(room, ctx)) {
    state.combat = startCombat(room.id, room.monsterIds, ctx, room.type === "boss");
    state.message = `Bị phục kích tại ${room.name}!`;
    return;
  }

  if (room.type === "rest" && !room.cleared) {
    state.message = `Cả đội dừng chân tại ${room.name}, quây quần bên lửa trại.`;
    return;
  }

  state.message = `Đã tới ${room.name}.`;
}

export function checkPartyWipe(state: GameState): boolean {
  return state.party.every((c) => !c.isAlive);
}
