import type { Floor, Monster, Room, RoomType } from "../types";
import { spawnMonster } from "./monsters";
import { MONSTER_ARCHETYPES } from "./monsters";
import { FLOOR_PATTERNS, validatePattern, roomTypeForTag, pickRandomPattern, type FloorPatternDef } from "./floorPatterns";
import type { Rng } from "../engine/rng";

// Floor structure is randomly picked from data/floor-patterns.json (see
// src/data/floorPatterns.ts for the notation + the "<=2 branch stages,
// every branch reaches the boss" rules). This module turns the picked
// pattern into an actual Floor + spawned Monster[], choosing room names and
// monster composition randomly via the shared engine Rng.

const COMBAT_ROOM_NAMES = [
  "Cửa Hầm Ngục",
  "Hành Lang Ẩm Ướt",
  "Phòng Giam Cũ",
  "Kho Đổ Nát",
  "Ngách Tối",
  "Hầm Chứa Xương",
  "Đại Sảnh Đổ Nát",
  "Lối Đi Sụp Lở",
  "Phòng Nghi Lễ Cũ",
  "Hang Ẩm Thấp",
];
const REST_ROOM_NAMES = ["Nơi Trú Ẩn", "Góc Nghỉ An Toàn", "Điện Thờ Bỏ Hoang"];
const BOSS_ROOM_NAMES = ["Sảnh Đường Chúa Ngục", "Ngai Vàng Bóng Tối", "Hầm Mộ Đại Tướng"];

function namePool(type: RoomType): string[] {
  if (type === "rest") return REST_ROOM_NAMES;
  if (type === "boss") return BOSS_ROOM_NAMES;
  return COMBAT_ROOM_NAMES;
}

function pickRoomName(type: RoomType, used: Set<string>, rng: Rng): string {
  const pool = namePool(type);
  const fresh = pool.filter((n) => !used.has(n));
  const name = rng.pick(fresh.length > 0 ? fresh : pool);
  used.add(name);
  return name;
}

const BOSS_ARCHETYPE_ID = "skeleton-guard";

/** Builds a Floor from one specific pattern — exported mainly so tests can cover every pattern in the library directly instead of relying on random picks. */
export function buildFloorFromPattern(pattern: FloorPatternDef, rng: Rng): { floor: Floor; monsters: Monster[] } {
  const depth = 1;
  const monsters: Monster[] = [];
  const usedNames = new Set<string>();

  const stages = validatePattern(pattern);

  const rooms: Room[] = [];
  for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
    const stage = stages[stageIdx]!;
    const nextStage = stages[stageIdx + 1];
    const nextIds = nextStage ? nextStage.map((r) => `r${r.roomId}`) : [];

    for (const token of stage) {
      const type = roomTypeForTag(token.tag);
      const id = `r${token.roomId}`;
      let monsterIds: string[] = [];

      if (type === "combat") {
        const count = rng.int(1, 3);
        for (let i = 0; i < count; i++) {
          const archetype = rng.pick(MONSTER_ARCHETYPES).id;
          const m = spawnMonster(archetype, depth);
          monsters.push(m);
          monsterIds.push(m.id);
        }
      } else if (type === "boss") {
        const m = spawnMonster(BOSS_ARCHETYPE_ID, depth, { boss: true });
        monsters.push(m);
        monsterIds = [m.id];
      }

      rooms.push({
        id,
        name: pickRoomName(type, usedNames, rng),
        type,
        connectedRoomIds: nextIds,
        monsterIds,
        cleared: false,
      });
    }
  }

  const floor: Floor = {
    depth,
    rooms,
    entryRoomId: rooms[0]!.id,
    darknessLevel: 10,
  };

  return { floor, monsters };
}

export function createFloor(rng: Rng): { floor: Floor; monsters: Monster[] } {
  const pattern = pickRandomPattern((patterns) => rng.pick(patterns));
  return buildFloorFromPattern(pattern, rng);
}

export { FLOOR_PATTERNS };
