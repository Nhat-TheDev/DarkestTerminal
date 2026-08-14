import type { Floor, Monster, Room } from "../types";
import { spawnMonster } from "./monsters";

// Fixed (hand-authored, not procedurally generated) 7-room floor per the
// user's spec: 1 rest room, 1 boss room, 5 normal (combat) rooms, laid out
// as a branching graph (docs/technical-decisions.md §1 shape, just not
// randomly generated for this prototype):
//
//   R1(entry) --- R2 --- R4(rest) --- R7(boss)
//    |             |
//   R3            R5
//    |
//   R6
//
// R7 is the farthest room from the entry by graph distance (matches the
// "boss = farthest node" rule); R4 sits directly before it (rest right
// before the boss, a deliberate deviation-friendly placement).

export function createFloor(): { floor: Floor; monsters: Monster[] } {
  const depth = 1;
  const monsters: Monster[] = [];

  const spawnInto = (archetypeId: string, count: number, opts?: { boss?: boolean }) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const m = spawnMonster(archetypeId, depth, opts);
      monsters.push(m);
      ids.push(m.id);
    }
    return ids;
  };

  const rooms: Room[] = [
    {
      id: "r1",
      name: "Cửa Hầm Ngục",
      type: "combat",
      connectedRoomIds: ["r2", "r3"],
      monsterIds: spawnInto("dungeon-rat", 2),
      cleared: false,
    },
    {
      id: "r2",
      name: "Hành Lang Ẩm Ướt",
      type: "combat",
      connectedRoomIds: ["r1", "r4", "r5"],
      monsterIds: spawnInto("black-bat", 2),
      cleared: false,
    },
    {
      id: "r3",
      name: "Phòng Giam Cũ",
      type: "combat",
      connectedRoomIds: ["r1", "r6"],
      monsterIds: [...spawnInto("dungeon-rat", 1), ...spawnInto("black-bat", 1)],
      cleared: false,
    },
    {
      id: "r4",
      name: "Nơi Trú Ẩn",
      type: "rest",
      connectedRoomIds: ["r2", "r7"],
      monsterIds: [],
      cleared: false,
    },
    {
      id: "r5",
      name: "Kho Đổ Nát",
      type: "combat",
      connectedRoomIds: ["r2"],
      monsterIds: spawnInto("skeleton-guard", 1),
      cleared: false,
    },
    {
      id: "r6",
      name: "Ngách Tối",
      type: "combat",
      connectedRoomIds: ["r3"],
      monsterIds: [...spawnInto("black-bat", 2), ...spawnInto("dungeon-rat", 1)],
      cleared: false,
    },
    {
      id: "r7",
      name: "Sảnh Đường Chúa Ngục",
      type: "boss",
      connectedRoomIds: ["r4"],
      monsterIds: spawnInto("skeleton-guard", 1, { boss: true }),
      cleared: false,
    },
  ];

  const floor: Floor = {
    depth,
    rooms,
    entryRoomId: "r1",
    darknessLevel: 10,
  };

  return { floor, monsters };
}
