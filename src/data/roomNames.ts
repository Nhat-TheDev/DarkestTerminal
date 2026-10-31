import type { RoomType } from "../types";
import roomNamesJson from "../../data/room-names.json";

export interface RoomNameEntry {
  name: string;
  backdrop: string;
}

const ROOM_TYPES = ["combat", "rest", "boss", "event"] satisfies RoomType[];

export function parseRoomNames(raw: unknown): Record<RoomType, RoomNameEntry[]> {
  const pools = (raw ?? {}) as Record<RoomType, unknown>;
  const seen = new Set<string>();
  for (const type of ROOM_TYPES) {
    const pool = pools[type];
    if (
      !Array.isArray(pool) ||
      pool.length === 0 ||
      pool.some((e) => typeof e?.name !== "string" || typeof e?.backdrop !== "string")
    ) {
      throw new Error(`data/room-names.json: "${type}" must be a non-empty list of { name, backdrop }`);
    }
    for (const { name } of pool as RoomNameEntry[]) {
      if (seen.has(name)) throw new Error(`data/room-names.json: duplicate room name "${name}"`);
      seen.add(name);
    }
  }
  return pools as Record<RoomType, RoomNameEntry[]>;
}

const RAW = parseRoomNames(roomNamesJson);
const ENTRIES = ROOM_TYPES.flatMap((type) => RAW[type]);
const BACKDROP_BY_NAME = new Map(ENTRIES.map((e) => [e.name, e.backdrop]));

export function roomNamePool(type: RoomType): string[] {
  return RAW[type].map((e) => e.name);
}

export function allRoomNameEntries(): RoomNameEntry[] {
  return ENTRIES;
}

export function backdropIdForRoomName(name: string): string | null {
  return BACKDROP_BY_NAME.get(name) ?? null;
}
