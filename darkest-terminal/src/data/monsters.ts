import type { MonsterArchetype, Monster } from "../types";
import monstersJson from "../../data/monsters.json";

// Design data now lives in ../../data/monsters.json — see
// docs/gameplay-decisions.md §2. spawnMonster() below is behavior (scaling
// formula), not data, so it stays in code.
export const MONSTER_ARCHETYPES = monstersJson as unknown as MonsterArchetype[];

if (MONSTER_ARCHETYPES.length === 0) throw new Error("data/monsters.json: no monster archetypes defined");

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
