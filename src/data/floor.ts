import type { Floor, Monster, Room, RoomType, MonsterArchetype } from "../types";
import { spawnMonster } from "./monsters";
import { COMBAT_ROOM_ARCHETYPES, GUARD_ROOM_ARCHETYPES } from "./monsters";
import { generateFloorLayout, type LayoutRoom } from "./floorPatterns";
import { BOSS_FLOOR_INTERVAL } from "./levelGrowth";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";
import { roomNamePool } from "./roomNames";
import { RELIGIONS } from "./religions";

function pickRoomName(type: RoomType, used: Set<string>, rng: Rng): string {
  const pool = roomNamePool(type);
  const fresh = pool.filter((n) => !used.has(n));
  const name = rng.pick(fresh.length > 0 ? fresh : pool);
  used.add(name);
  return name;
}

type PowerTier = NonNullable<MonsterArchetype["powerTier"]>;

const ARCHETYPES_BY_TIER: Record<PowerTier, MonsterArchetype[]> = {
  weak: COMBAT_ROOM_ARCHETYPES.filter((a) => a.powerTier === "weak"),
  medium: COMBAT_ROOM_ARCHETYPES.filter((a) => a.powerTier === "medium"),
  strong: COMBAT_ROOM_ARCHETYPES.filter((a) => a.powerTier === "strong"),
};

const ROOM_COMPOSITION_TEMPLATES: PowerTier[][] = BALANCE.floorGeneration.roomCompositionTemplates;

function eligibleAtDepth(pool: MonsterArchetype[], depth: number): MonsterArchetype[] {
  return pool.filter((a) => (a.minFloor ?? 0) <= depth);
}

/** What may spawn at one depth. */
interface DepthPools {
  templates: PowerTier[][];
  byTier: Record<PowerTier, MonsterArchetype[]>;
  guards: MonsterArchetype[];
}

function poolsAtDepth(depth: number): DepthPools {
  const byTier: Record<PowerTier, MonsterArchetype[]> = {
    weak: eligibleAtDepth(ARCHETYPES_BY_TIER.weak, depth),
    medium: eligibleAtDepth(ARCHETYPES_BY_TIER.medium, depth),
    strong: eligibleAtDepth(ARCHETYPES_BY_TIER.strong, depth),
  };
  return {
    templates: ROOM_COMPOSITION_TEMPLATES.filter((template) => template.every((tier) => byTier[tier].length > 0)),
    byTier,
    guards: eligibleAtDepth(GUARD_ROOM_ARCHETYPES, depth),
  };
}

type RoomSpawnFn = (rng: Rng, depth: number, pools: DepthPools) => Monster[];

function spawnCombatRoomMonsters(rng: Rng, depth: number, pools: DepthPools): Monster[] {
  const template = rng.pick(pools.templates);
  return template.map((tier) => spawnMonster(rng.pick(pools.byTier[tier]).id, depth));
}

function spawnBossRoomMonsters(rng: Rng, depth: number, pools: DepthPools): Monster[] {
  const tier = depth % BOSS_FLOOR_INTERVAL === 0 ? "boss" : "elite";
  return [spawnMonster(rng.pick(pools.guards).id, depth, { tier })];
}

const EVENT_GUARDIAN_STAT_MULTIPLIER = BALANCE.events.eventGuardianStatMultiplier;

const EVENT_GUARDIAN_ARCHETYPES = [...ARCHETYPES_BY_TIER.medium, ...ARCHETYPES_BY_TIER.strong];

export function spawnEventGuardianMonsters(rng: Rng, depth: number): Monster[] {
  const count = rng.int(BALANCE.events.eventGuardianCount.min, BALANCE.events.eventGuardianCount.max);
  const eligible = eligibleAtDepth(EVENT_GUARDIAN_ARCHETYPES, depth);
  return Array.from({ length: count }, () => {
    const archetype = rng.pick(eligible).id;
    const m = spawnMonster(archetype, depth);
    m.maxHp = Math.round(m.maxHp * EVENT_GUARDIAN_STAT_MULTIPLIER.maxHp);
    m.hp = m.maxHp;
    m.attack = Math.round(m.attack * EVENT_GUARDIAN_STAT_MULTIPLIER.attack);
    m.defense = Math.round(m.defense * EVENT_GUARDIAN_STAT_MULTIPLIER.defense);
    return m;
  });
}

const ROOM_SPAWN_STRATEGIES: Partial<Record<RoomType, RoomSpawnFn>> = {
  combat: spawnCombatRoomMonsters,
  boss: spawnBossRoomMonsters,
};

export function buildFloorFromLayout(layout: LayoutRoom[], rng: Rng, depth = 1): { floor: Floor; monsters: Monster[] } {
  const monsters: Monster[] = [];
  const usedNames = new Set<string>();
  const pools = poolsAtDepth(depth);

  const rooms: Room[] = layout.map((token) => {
    const roomMonsters = ROOM_SPAWN_STRATEGIES[token.type]?.(rng, depth, pools) ?? [];
    monsters.push(...roomMonsters);
    return {
      id: token.id,
      name: pickRoomName(token.type, usedNames, rng),
      type: token.type,
      connectedRoomIds: [...token.next],
      monsterIds: roomMonsters.map((m) => m.id),
      cleared: false,
      ...(token.hidden ? { hidden: true } : {}),
    };
  });

  return { floor: { depth, rooms, entryRoomId: rooms[0]!.id }, monsters };
}

const TEMPLE_ROOM_ID = "temple";

export function prependTemple(floor: Floor, rng: Rng): void {
  if (floor.depth === BALANCE.endings.founderFloorDepth || BALANCE.temple.chance <= 0 || !rng.chance(BALANCE.temple.chance)) return;
  const religion = rng.pick(RELIGIONS);
  const name = rng.pick(roomNamePool("temple"));
  floor.rooms.unshift({
    id: TEMPLE_ROOM_ID,
    name,
    type: "temple",
    connectedRoomIds: [floor.entryRoomId],
    monsterIds: [],
    cleared: false,
    templeReligionId: religion.id,
  });
  floor.entryRoomId = TEMPLE_ROOM_ID;
}

export function createFloor(rng: Rng, depth = 1): { floor: Floor; monsters: Monster[] } {
  const built = buildFloorFromLayout(generateFloorLayout(rng, depth), rng, depth);
  prependTemple(built.floor, rng);
  return built;
}
