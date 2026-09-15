import type { Game } from "../../src/engine/game";
import type { Id, Room } from "../../src/types";
import { createFloor } from "../../src/data/floor";
import { getClass } from "../../src/data/classes";
import { getRoom, resolveEventEntry } from "../../src/engine/dungeon";
import { startCombat } from "../../src/engine/combat";
import { statsForLevel, recomputeAllPartyStats } from "../../src/engine/party";
import { expCostForLevel, MAX_LEVEL } from "../../src/data/levelGrowth";
import { t } from "../../src/data/strings";
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
  const hasLivingMonsters = room.monsterIds.some((id) => (monsters.find((m) => m.id === id)?.hp ?? 0) > 0);
  if ((room.type === "combat" || room.type === "boss") && !room.cleared && hasLivingMonsters) {
    game.state.combat = startCombat(room.id, room.monsterIds, game.ctx, room.type === "boss");
    game.state.message = t("dungeon.ambush", { room: room.name });
  } else if (room.type === "event" && !room.cleared) {
    if (opts.forceEventId) room.rolledEventId = opts.forceEventId;
    resolveEventEntry(game.state, room, game.ctx);
  } else {
    game.state.message = t("dungeon.arrived", { room: room.name });
  }
  return room;
}
