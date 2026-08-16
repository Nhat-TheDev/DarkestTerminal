import type { Character, CharacterClass } from "../types";
import { classGrowthBonus } from "../data/levelGrowth";

// Matches docs/gameplay-decisions.md §3: identical starting survival stats
// for every class.
export const INITIAL_SURVIVAL_STATS = { hunger: 100, thirst: 100, fear: 0 };

// docs/gameplay-decisions.md §6: attack/defense/maxHp/maxMp grow with level
// via the shared 5-tier curve, weighted per class (§6.8) so growth
// reinforces each class's identity instead of converging toward identical
// stats at high level (level 1 = base, no bonus). aggro/speed never scale
// with level (§5) — they're fixed role/tempo identifiers per class.
export function createCharacter(id: string, name: string, cls: CharacterClass, level = 1): Character {
  const unlockedSkillIds = cls.skills.filter((s) => s.unlockLevel <= level).map((s) => s.id);
  const maxHp = cls.baseMaxHp + classGrowthBonus("maxHp", level, cls.growthWeights);
  const maxMp = cls.baseMaxMp + classGrowthBonus("maxMp", level, cls.growthWeights);
  return {
    id,
    name,
    classId: cls.id,
    level,
    hp: maxHp,
    maxHp,
    mp: maxMp,
    maxMp,
    attack: cls.baseAttack + classGrowthBonus("attack", level, cls.growthWeights),
    defense: cls.baseDefense + classGrowthBonus("defense", level, cls.growthWeights),
    aggro: cls.baseAggro,
    speed: cls.baseSpeed,
    survival: { ...INITIAL_SURVIVAL_STATS },
    unlockedSkillIds,
    activeStatusEffects: [],
    isAlive: true,
    usesRemainingThisCombat: {},
    cooldownsRemaining: {},
  };
}
