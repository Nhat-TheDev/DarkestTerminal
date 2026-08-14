import type { MonsterArchetype, Monster } from "../types";

// Matches docs/gameplay-decisions.md §2, tier "1-3" and "4-6" archetypes
// (Bóng Ma Gào Thét / tier 7+ is out of scope: this prototype is 1 floor).
export const MONSTER_ARCHETYPES: MonsterArchetype[] = [
  {
    id: "dungeon-rat",
    name: "Chuột Hầm Ngục",
    baseHp: 18,
    baseAttack: 5,
    baseDefense: 2,
    baseSpeed: 7,
    aiPattern: "erratic",
    skillIds: [],
  },
  {
    id: "black-bat",
    name: "Dơi Đen",
    baseHp: 14,
    baseAttack: 6,
    baseDefense: 1,
    baseSpeed: 14,
    aiPattern: "aggressive",
    skillIds: [],
  },
  {
    id: "skeleton-guard",
    name: "Xương Sống Canh Gác",
    baseHp: 40,
    baseAttack: 10,
    baseDefense: 6,
    baseSpeed: 8,
    aiPattern: "defensive",
    skillIds: [],
  },
];

export function getArchetype(id: string): MonsterArchetype {
  const found = MONSTER_ARCHETYPES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown monster archetype: ${id}`);
  return found;
}

let monsterCounter = 0;

/**
 * Spawns a Monster instance from an archetype, scaled by floor depth per
 * docs/gameplay-decisions.md §2: attack +2/depth, defense +1/depth,
 * maxHp +8/depth, speed unscaled.
 */
export function spawnMonster(archetypeId: string, floorDepth: number, opts?: { boss?: boolean }): Monster {
  const archetype = getArchetype(archetypeId);
  const isBoss = opts?.boss ?? false;
  // Boss room uses an elite (2x stat) instance of one archetype rather than
  // inventing a 4th monster type, keeping to "3 loại quái vật khác nhau".
  const eliteMultiplier = isBoss ? 2 : 1;
  const maxHp = (archetype.baseHp + floorDepth * 8) * eliteMultiplier;
  monsterCounter += 1;
  return {
    id: `${archetypeId}-${monsterCounter}`,
    archetypeId,
    name: isBoss ? `${archetype.name} (Đại Tướng)` : archetype.name,
    hp: maxHp,
    maxHp,
    attack: (archetype.baseAttack + floorDepth * 2) * eliteMultiplier,
    defense: (archetype.baseDefense + floorDepth * 1) * eliteMultiplier,
    speed: archetype.baseSpeed,
    skillIds: archetype.skillIds,
    isBoss,
    aiPattern: archetype.aiPattern,
    activeStatusEffects: [],
  };
}
