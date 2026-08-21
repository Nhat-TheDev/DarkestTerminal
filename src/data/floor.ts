import type { Floor, Monster, Room, RoomType, MonsterArchetype } from "../types";
import { spawnMonster } from "./monsters";
import { MONSTER_ARCHETYPES } from "./monsters";
import { generateFloorLayout, roomTypeForTag, type RoomToken } from "./floorPatterns";
import { BOSS_FLOOR_INTERVAL } from "./levelGrowth";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";

const COMBAT_ROOM_NAMES = [
  "Dungeon Gate",
  "Damp Corridor",
  "Old Cell",
  "Ruined Storeroom",
  "Dark Alcove",
  "Bone Vault",
  "Ruined Hall",
  "Collapsed Passage",
  "Old Ritual Chamber",
  "Damp Low Cave",
];
const REST_ROOM_NAMES = ["Shelter", "Safe Resting Corner", "Abandoned Shrine"];
const BOSS_ROOM_NAMES = ["Dungeon Lord's Hall", "Throne of Darkness", "General's Tomb"];

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

const COMBAT_ROOM_ARCHETYPES = MONSTER_ARCHETYPES.filter((a) => !a.guardOnly);
const GUARD_ROOM_ARCHETYPES = MONSTER_ARCHETYPES.filter((a) => a.eliteSkillIds && a.bossSkillIds);

type PowerTier = NonNullable<MonsterArchetype["powerTier"]>;

const ARCHETYPES_BY_TIER: Record<PowerTier, MonsterArchetype[]> = {
  weak: COMBAT_ROOM_ARCHETYPES.filter((a) => a.powerTier === "weak"),
  medium: COMBAT_ROOM_ARCHETYPES.filter((a) => a.powerTier === "medium"),
  strong: COMBAT_ROOM_ARCHETYPES.filter((a) => a.powerTier === "strong"),
};

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

type RoomSpawnFn = (rng: Rng, depth: number) => Monster[];

function spawnCombatRoomMonsters(rng: Rng, depth: number): Monster[] {
  const template = rng.pick(ROOM_COMPOSITION_TEMPLATES);
  return template.map((tier) => {
    const archetype = rng.pick(ARCHETYPES_BY_TIER[tier]).id;
    return spawnMonster(archetype, depth);
  });
}

function spawnBossRoomMonsters(rng: Rng, depth: number): Monster[] {
  const tier = depth % BOSS_FLOOR_INTERVAL === 0 ? "boss" : "elite";
  const archetype = rng.pick(GUARD_ROOM_ARCHETYPES).id;
  return [spawnMonster(archetype, depth, { tier })];
}

const EVENT_GUARDIAN_STAT_MULTIPLIER = BALANCE.events.eventGuardianStatMultiplier;

export function spawnEventGuardianMonsters(rng: Rng, depth: number): Monster[] {
  const count = rng.int(1, 2);
  return Array.from({ length: count }, () => {
    const archetype = rng.pick(COMBAT_ROOM_ARCHETYPES).id;
    const m = spawnMonster(archetype, depth);
    m.maxHp = Math.round(m.maxHp * EVENT_GUARDIAN_STAT_MULTIPLIER);
    m.hp = m.maxHp;
    m.attack = Math.round(m.attack * EVENT_GUARDIAN_STAT_MULTIPLIER);
    m.defense = Math.round(m.defense * EVENT_GUARDIAN_STAT_MULTIPLIER);
    return m;
  });
}

const ROOM_SPAWN_STRATEGIES: Partial<Record<RoomType, RoomSpawnFn>> = {
  combat: spawnCombatRoomMonsters,
  boss: spawnBossRoomMonsters,
};

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
  };

  return { floor, monsters };
}

export function createFloor(rng: Rng, depth = 1): { floor: Floor; monsters: Monster[] } {
  const stages = generateFloorLayout(rng);
  return buildFloorFromStages(stages, rng, depth);
}
