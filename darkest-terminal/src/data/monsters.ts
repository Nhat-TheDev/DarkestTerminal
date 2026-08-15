import type { MonsterArchetype, Monster } from "../types";
import monstersJson from "../../data/monsters.json";
import { growthBonus, ELITE_MULTIPLIER } from "./levelGrowth";

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
 * Spawns a Monster instance from an archetype, scaled by floor depth using
 * the same 5-tier growth curve as character levels (docs/gameplay-
 * decisions.md §6.3/§6.6) — depth 1 = base archetype stats, no bonus yet.
 *
 * Boss rooms use an elite instance of one archetype rather than inventing a
 * 4th monster type ("3 loại quái vật khác nhau"). The elite multiplier is
 * asymmetric — heavy on HP, light on defense (§6.5): a uniform x2 on every
 * stat let boss defense stack high enough to nearly negate all incoming
 * damage at deep floors.
 */
export function spawnMonster(archetypeId: string, floorDepth: number, opts?: { boss?: boolean }): Monster {
  const archetype = getArchetype(archetypeId);
  const isBoss = opts?.boss ?? false;

  const scaledMaxHp = archetype.baseHp + growthBonus("maxHp", floorDepth);
  const scaledAttack = archetype.baseAttack + growthBonus("attack", floorDepth);
  const scaledDefense = archetype.baseDefense + growthBonus("defense", floorDepth);

  const maxHp = isBoss ? Math.round(scaledMaxHp * ELITE_MULTIPLIER.maxHp) : scaledMaxHp;
  monsterCounter += 1;
  return {
    id: `${archetypeId}-${monsterCounter}`,
    archetypeId,
    name: isBoss ? `${archetype.name} (Đại Tướng)` : archetype.name,
    hp: maxHp,
    maxHp,
    attack: isBoss ? Math.round(scaledAttack * ELITE_MULTIPLIER.attack) : scaledAttack,
    defense: isBoss ? Math.round(scaledDefense * ELITE_MULTIPLIER.defense) : scaledDefense,
    speed: archetype.baseSpeed,
    skillIds: archetype.skillIds,
    isBoss,
    aiPattern: archetype.aiPattern,
    activeStatusEffects: [],
  };
}
