import type { Game } from "../../src/engine/game";
import type { Id, Room } from "../../src/types";
import { BALANCE } from "../../src/data/balanceConfig";
import { createFloor } from "../../src/data/floor";
import { getClass } from "../../src/data/classes";
import { getRoom, enterRoom } from "../../src/engine/dungeon";
import { statsForLevel, recomputeAllPartyStats } from "../../src/engine/party";
import { expCostForLevel, MAX_LEVEL } from "../../src/data/levelGrowth";
import { FOUNDER_FLOOR_DEPTH } from "../../src/data/endings";
import { getEvent } from "../../src/data/events";
import { resolveRoomId } from "./args";

export interface DumpOptions {
  level: number;
  floorDepth: number;
  roomArg: string;
  /** Pins the event room's roll, bypassing `isEligible`. Scripted events are refused. */
  forceEventId?: Id;
  /** Sets the party's Faith (0-100); left alone when omitted. */
  faith?: number;
}

/** A temple argument needs a temple on the floor: the floor is rolled with the temple chance raised to certain. */
function createFloorFor(game: Game, floorDepth: number, withTemple: boolean) {
  if (!withTemple) return createFloor(game.ctx.rng, floorDepth);
  const saved = BALANCE.temple.chance;
  BALANCE.temple.chance = 1;
  try {
    return createFloor(game.ctx.rng, floorDepth);
  } finally {
    BALANCE.temple.chance = saved;
  }
}

export function applyDump(game: Game, opts: DumpOptions): Room {
  if (opts.forceEventId && getEvent(opts.forceEventId).kind === "scripted") {
    throw new Error(`"${opts.forceEventId}" is a scripted scene, not a room event.`);
  }
  const level = Math.max(1, Math.min(MAX_LEVEL, opts.level));
  const floorDepth = Math.max(1, opts.floorDepth);

  const { floor, monsters } = createFloorFor(game, floorDepth, opts.roomArg === "temple");
  game.ctx.monsters = monsters;
  game.state.floor = floor;
  // Clears the constructor's floor-1 entry ambush, stale now that the floor is replaced.
  game.state.combat = null;
  // A dump lands mid-run, past the gate: the Gatekeeper scene never shows and counts as refused.
  game.state.pendingGatekeeper = false;
  game.state.gatekeeperAnswer = "refused";

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

  // Set after the room is entered, so the arrival's own Faith decay does not move the requested value.
  const setFaith = () => {
    if (opts.faith !== undefined) game.state.faith = Math.max(0, Math.min(100, opts.faith));
  };

  const roomId = resolveRoomId(floor, opts.roomArg);
  game.state.currentRoomId = roomId;
  game.state.roomPath = roomId === floor.entryRoomId ? [roomId] : [floor.entryRoomId, roomId];
  const room = getRoom(floor, roomId);

  // Mirrors Game.advanceToNextFloor(): the founder encounter preempts any room logic.
  if (floorDepth === FOUNDER_FLOOR_DEPTH && game.state.continuedPastCheckpoint) {
    game.state.pendingFounderDialogue = true;
    setFaith();
    return room;
  }

  if (opts.forceEventId) room.rolledEventId = opts.forceEventId;
  enterRoom(game.state, room, game.ctx);
  setFaith();
  return room;
}
