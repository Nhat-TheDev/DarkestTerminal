import type { Character, CharacterClass } from "../types";
import { growthBonus } from "../data/levelGrowth";

// Matches docs/gameplay-decisions.md §3: identical starting survival stats
// for every class.
export const INITIAL_SURVIVAL_STATS = { hunger: 100, thirst: 100, fear: 0 };

// docs/gameplay-decisions.md §6: attack/defense/maxHp/maxMp grow with level
// via the shared 5-tier curve (level 1 = base, no bonus); aggro/speed never
// scale with level (§5) — they're fixed role/tempo identifiers per class.
export function createCharacter(id: string, name: string, cls: CharacterClass, level = 1): Character {
  const unlockedSkillIds = cls.skills.filter((s) => s.unlockLevel <= level).map((s) => s.id);
  const maxHp = cls.baseMaxHp + growthBonus("maxHp", level);
  const maxMp = cls.baseMaxMp + growthBonus("maxMp", level);
  return {
    id,
    name,
    classId: cls.id,
    level,
    hp: maxHp,
    maxHp,
    mp: maxMp,
    maxMp,
    attack: cls.baseAttack + growthBonus("attack", level),
    defense: cls.baseDefense + growthBonus("defense", level),
    aggro: cls.baseAggro,
    speed: cls.baseSpeed,
    survival: { ...INITIAL_SURVIVAL_STATS },
    unlockedSkillIds,
    activeStatusEffects: [],
    isAlive: true,
    usesRemainingThisCombat: {},
  };
}
