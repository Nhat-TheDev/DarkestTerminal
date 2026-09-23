import type { Game } from "../../src/engine/game";
import type { Id, Room } from "../../src/types";
import { createFloor } from "../../src/data/floor";
import { getClass } from "../../src/data/classes";
import { getRoom, enterRoom } from "../../src/engine/dungeon";
import { statsForLevel, recomputeAllPartyStats } from "../../src/engine/party";
import { expCostForLevel, MAX_LEVEL } from "../../src/data/levelGrowth";
import { FOUNDER_FLOOR_DEPTH } from "../../src/data/endings";
import { resolveRoomId } from "./args";

export interface DumpOptions {
  level: number;
  floorDepth: number;
  roomArg: string;
  /** Pins the event room's roll instead of letting `resolveEventEntry` pick one at random — lets a
      caller jump straight to a specific event id for testing, bypassing its own `isEligible` gate. */
  forceEventId?: Id;
}

/** Mutates `game` in place to the requested level/floor/room, returning the room it landed in. */
export function applyDump(game: Game, opts: DumpOptions): Room {
  const level = Math.max(1, Math.min(MAX_LEVEL, opts.level));
  const floorDepth = Math.max(1, opts.floorDepth);

  const { floor, monsters } = createFloor(game.ctx.rng, floorDepth);
  game.ctx.monsters = monsters;
  game.state.floor = floor;
  // The Game constructor already ran its own entry-room ambush check against floor 1's monsters —
  // stale here since we just replaced both the floor and the monster list.
  game.state.combat = null;

  game.state.partyExp = expCostForLevel(level);
  for (const c of game.state.party) {
    c.level = level;
    c.unlockedSkillIds = statsForLevel(getClass(c.classId), level).unlockedSkillIds;
  }
  recomputeAllPartyStats(game.state);
  for (const c of game.state.party) {
    c.hp = c.maxHp;
    c.mp = c.maxMp;
  }

  const roomId = resolveRoomId(floor, opts.roomArg);
  game.state.currentRoomId = roomId;
  const room = getRoom(floor, roomId);

  // Mirrors `Game.advanceToNextFloor()`'s own precedence: the founder encounter is a guaranteed
  // story beat that blocks everything else the moment the party reaches that depth, checked before
  // any room-type logic. The floor-100 checkpoint has no equivalent here — it now fires only after
  // floor 100's own boss is defeated (Part F.1), not on arrival, so dumping to depth 100 lands on it
  // like any ordinary floor.
  if (floorDepth === FOUNDER_FLOOR_DEPTH && game.state.continuedPastCheckpoint) {
    game.state.pendingFounderDialogue = true;
    return room;
  }

  if (opts.forceEventId) room.rolledEventId = opts.forceEventId;
  enterRoom(game.state, room, game.ctx);
  return room;
}
