import type { Floor, Monster, Room, RoomType, MonsterArchetype } from "../types";
import { spawnMonster } from "./monsters";
import { MONSTER_ARCHETYPES } from "./monsters";
import { generateFloorLayout, roomTypeForTag, type RoomToken } from "./floorPatterns";
import { BOSS_FLOOR_INTERVAL } from "./levelGrowth";
import type { Rng } from "../engine/rng";

// Floor structure is generated at runtime (see src/data/floorPatterns.ts for
// the stage/branch/rest/event rules). This module turns the generated
// stages into an actual Floor + spawned Monster[], choosing room names and
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

// Regular combat rooms pick from every archetype except guard-only ones (elite/boss-exclusive
// monsters like Dragon or Dark Knight never show up as a plain trash mob). The guard room itself
// picks among every archetype that actually has an elite/boss skill kit — guard-only archetypes
// plus skeleton-guard, which (unlike them) also doubles as a regular combat-room spawn.
const COMBAT_ROOM_ARCHETYPES = MONSTER_ARCHETYPES.filter((a) => !a.guardOnly);
const GUARD_ROOM_ARCHETYPES = MONSTER_ARCHETYPES.filter((a) => a.eliteSkillIds && a.bossSkillIds);

type PowerTier = NonNullable<MonsterArchetype["powerTier"]>;

const ARCHETYPES_BY_TIER: Record<PowerTier, MonsterArchetype[]> = {
  weak: COMBAT_ROOM_ARCHETYPES.filter((a) => a.powerTier === "weak"),
  medium: COMBAT_ROOM_ARCHETYPES.filter((a) => a.powerTier === "medium"),
  strong: COMBAT_ROOM_ARCHETYPES.filter((a) => a.powerTier === "strong"),
};

// Every allowed tier makeup for a combat room, chosen so the room's EXP stays
// balanced (docs/gameplay-decisions.md §2 update 2026-08-17 "monster power
// tiers"): no single-weak room (too trivial), no all-strong room (too punishing
// for the room count), and total representative EXP (weak=6, medium≈9,
// strong≈13) lands within [15, 35] — which also rules out any 1-monster room.
const ROOM_COMPOSITION_TEMPLATES: PowerTier[][] = [
  ["weak", "medium"],
  ["weak", "strong"],
  ["medium", "medium"],
  ["medium", "strong"],
  ["strong", "strong"],
  ["weak", "weak", "medium"],
  ["weak", "weak", "strong"],
  ["weak", "medium", "medium"],
  ["weak", "medium", "strong"],
  ["weak", "strong", "strong"],
  ["medium", "medium", "medium"],
  ["medium", "medium", "strong"],
  ["medium", "strong", "strong"],
];

/** Spawns the monsters for 1 room of a given type; returns [] for room types that spawn nothing. */
type RoomSpawnFn = (rng: Rng, depth: number) => Monster[];

function spawnCombatRoomMonsters(rng: Rng, depth: number): Monster[] {
  const template = rng.pick(ROOM_COMPOSITION_TEMPLATES);
  return template.map((tier) => {
    const archetype = rng.pick(ARCHETYPES_BY_TIER[tier]).id;
    return spawnMonster(archetype, depth);
  });
}

function spawnBossRoomMonsters(rng: Rng, depth: number): Monster[] {
  // "boss" here is the room tag (always the floor's single guard room) — the
  // monster inside is "elite" most floors, "boss" every BOSS_FLOOR_INTERVAL
  // floors instead (mutually exclusive, §6.11), not the room type.
  const tier = depth % BOSS_FLOOR_INTERVAL === 0 ? "boss" : "elite";
  const archetype = rng.pick(GUARD_ROOM_ARCHETYPES).id;
  return [spawnMonster(archetype, depth, { tier })];
}

// Room types not listed here spawn nothing (rest/treasure/empty/event) — adding
// a new type that spawns monsters is a single entry, no change to the loop below.
const ROOM_SPAWN_STRATEGIES: Partial<Record<RoomType, RoomSpawnFn>> = {
  combat: spawnCombatRoomMonsters,
  boss: spawnBossRoomMonsters,
};

/** Builds a Floor from a generated set of stages — exported mainly so tests can cover the generator's output directly instead of always going through `createFloor`. */
export function buildFloorFromStages(stages: RoomToken[][], rng: Rng, depth = 1): { floor: Floor; monsters: Monster[] } {
  const monsters: Monster[] = [];
  const usedNames = new Set<string>();

  const rooms: Room[] = [];
  for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
    const stage = stages[stageIdx]!;
    const nextStage = stages[stageIdx + 1];
    const nextIds = nextStage ? nextStage.map((r) => `r${r.roomId}`) : [];

    for (const token of stage) {
      const type = roomTypeForTag(token.tag);
      const id = `r${token.roomId}`;

      const roomMonsters = ROOM_SPAWN_STRATEGIES[type]?.(rng, depth) ?? [];
      monsters.push(...roomMonsters);
      const monsterIds = roomMonsters.map((m) => m.id);

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

export function createFloor(rng: Rng, depth = 1): { floor: Floor; monsters: Monster[] } {
  const stages = generateFloorLayout(rng);
  return buildFloorFromStages(stages, rng, depth);
}
