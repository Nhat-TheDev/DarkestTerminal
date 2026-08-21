import type { Floor, GameState, Room } from "../types";
import type { EngineContext } from "./combat";
import { startCombat } from "./combat";
import { tickSurvivalOnAction } from "./survival";
import { getEvent, rollEvent } from "../data/events";
import { rollArtifact, rollArtifactOrCursed, getArtifact } from "../data/artifacts";
import { spawnEventGuardianMonsters } from "../data/floor";
import { t } from "../data/strings";

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

export function moveToRoom(state: GameState, targetRoomId: string, ctx: EngineContext): void {
  const current = getRoom(state.floor, state.currentRoomId);
  if (!current.connectedRoomIds.includes(targetRoomId)) {
    state.message = t("errors.roomNotConnected");
    return;
  }

  for (const c of state.party) tickSurvivalOnAction(c, state.combat?.log ?? []);

  state.currentRoomId = targetRoomId;
  const room = getRoom(state.floor, targetRoomId);

  if ((room.type === "combat" || room.type === "boss") && !room.cleared && roomHasLivingMonsters(room, ctx)) {
    state.combat = startCombat(room.id, room.monsterIds, ctx, room.type === "boss");
    state.message = t("dungeon.ambush", { room: room.name });
    return;
  }

  if (room.type === "rest" && !room.cleared) {
    state.message = t("dungeon.restEnter", { room: room.name });
    return;
  }

  if (room.type === "event" && !room.cleared) {
    resolveEventEntry(state, room, ctx);
    return;
  }

  state.message = t("dungeon.arrived", { room: room.name });
}

function resolveEventEntry(state: GameState, room: Room, ctx: EngineContext): void {
  if (!room.rolledEventId) room.rolledEventId = rollEvent(ctx.rng);
  const event = getEvent(room.rolledEventId);
  state.message = event.description;

  if (event.kind === "instantReward") {
    const artifactId = rollArtifact("treasureOrEvent", ctx.rng);
    state.unequippedArtifactIds.push(artifactId);
    state.message += t("dungeon.artifactRewardSuffix", { artifact: getArtifact(artifactId).name });
    room.cleared = true;
    return;
  }

  if (event.kind === "combatReward") {
    const monsters = spawnEventGuardianMonsters(ctx.rng, state.floor.depth);
    ctx.monsters.push(...monsters);
    room.monsterIds = monsters.map((m) => m.id);
    state.combat = startCombat(room.id, room.monsterIds, ctx, false);
    return;
  }

  if (!state.activeEvent) {
    if (event.id === "merchant") {
      const offerCount = ctx.rng.int(2, 3);
      state.activeEvent = { eventId: event.id, offerArtifactIds: Array.from({ length: offerCount }, () => rollArtifact("treasureOrEvent", ctx.rng)) };
    } else if (event.id === "cursed-shrine") {
      state.activeEvent = { eventId: event.id, offerArtifactIds: [rollArtifactOrCursed(ctx.rng)] };
    } else if (event.id === "twin-altars") {
      state.activeEvent = { eventId: event.id, offerArtifactIds: [rollArtifact("treasureOrEvent", ctx.rng), rollArtifact("treasureOrEvent", ctx.rng)] };
    }
  }
}

export function checkPartyWipe(state: GameState): boolean {
  return state.party.every((c) => !c.isAlive);
}
