import type { Character, CharacterClass } from "../types";

// Matches docs/gameplay-decisions.md §3: identical starting survival stats
// for every class.
export const INITIAL_SURVIVAL_STATS = { hunger: 100, thirst: 100, fear: 0 };

export function createCharacter(id: string, name: string, cls: CharacterClass, level = 1): Character {
  const unlockedSkillIds = cls.skills.filter((s) => s.unlockLevel <= level).map((s) => s.id);
  return {
    id,
    name,
    classId: cls.id,
    level,
    hp: cls.baseMaxHp,
    maxHp: cls.baseMaxHp,
    mp: cls.baseMaxMp,
    maxMp: cls.baseMaxMp,
    attack: cls.baseAttack,
    defense: cls.baseDefense,
    aggro: cls.baseAggro,
    speed: cls.baseSpeed,
    survival: { ...INITIAL_SURVIVAL_STATS },
    unlockedSkillIds,
    activeStatusEffects: [],
    isAlive: true,
    usesRemainingThisCombat: {},
  };
}
