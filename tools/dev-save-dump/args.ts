import type { Floor, Id, RoomType } from "../../src/types";

export const ROOM_TYPES: RoomType[] = ["combat", "rest", "boss", "event"];

export function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
    args[key] = value;
    i++;
  }
  return args;
}

export function resolveRoomId(floor: Floor, roomArg: string): Id {
  if (roomArg === "entry") return floor.entryRoomId;
  const exact = floor.rooms.find((r) => r.id === roomArg);
  if (exact) return exact.id;
  if ((ROOM_TYPES as string[]).includes(roomArg)) {
    const match = floor.rooms.find((r) => r.type === roomArg);
    if (match) return match.id;
    throw new Error(`No "${roomArg}" room on floor ${floor.depth}. Rooms: ${floor.rooms.map((r) => `${r.id}:${r.type}`).join(", ")}`);
  }
  throw new Error(`Unknown --room "${roomArg}". Use entry/${ROOM_TYPES.join("/")}, or one of: ${floor.rooms.map((r) => r.id).join(", ")}`);
}
