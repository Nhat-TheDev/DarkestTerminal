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

/**
 * Moves the party into `targetRoomId` (must be connected to the current
 * room). Counts as 1 dungeon action for survival stats and triggers
 * combat/rest as appropriate. Fear no longer accrues from room movement —
 * see docs/gameplay-decisions/03-survival-stats.md §3 for the round-based
 * combat mechanic instead.
 */
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

/**
 * docs/gameplay-decisions/08-events.md §8.1 — rolls the room's event on
 * first entry only (Room.rolledEventId persists it), then auto-resolves the
 * 2 kinds that need no player decision: instantReward (open-chest, grants
 * immediately) and combatReward (guardian-fight/desecrated-altar, starts
 * combat immediately, same as a combat-room ambush). Every other kind just
 * surfaces its flavor text and description — the player resolves it via the
 * matching Game.* method from the UI's dedicated event screen.
 */
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

  // merchant/cursed-shrine/twin-altars "reveal before decide" — pre-roll the
  // offer(s) once and cache them so the UI can show a fixed choice; every
  // other kind (hpGamble/artifactExchange/rescueGamble) rolls atomically
  // inside its Game.* method instead, no pre-roll needed. Guarded by
  // `!state.activeEvent` so re-entering an already-open event (shouldn't
  // happen — the UI has no room-navigation path out of an unresolved event,
  // same as "rest") can't reroll the offer.
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
