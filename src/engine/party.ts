import type { Character, CharacterClass, GameState } from "../types";
import { classGrowthBonus, levelForTotalExp } from "../data/levelGrowth";
import { getClass } from "../data/classes";

// Matches docs/gameplay-decisions.md §3: identical starting survival stats
// for every class.
export const INITIAL_SURVIVAL_STATS = { hunger: 100, thirst: 100, fear: 0 };

interface LevelStats {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  unlockedSkillIds: string[];
}

// docs/gameplay-decisions.md §6: attack/defense/maxHp/maxMp grow with level
// via the shared 5-tier curve, weighted per class (§6.8) so growth
// reinforces each class's identity instead of converging toward identical
// stats at high level (level 1 = base, no bonus). aggro/speed never scale
// with level (§5) — they're fixed role/tempo identifiers per class.
function statsForLevel(cls: CharacterClass, level: number): LevelStats {
  return {
    maxHp: cls.baseMaxHp + classGrowthBonus("maxHp", level, cls.growthWeights),
    maxMp: cls.baseMaxMp + classGrowthBonus("maxMp", level, cls.growthWeights),
    attack: cls.baseAttack + classGrowthBonus("attack", level, cls.growthWeights),
    defense: cls.baseDefense + classGrowthBonus("defense", level, cls.growthWeights),
    unlockedSkillIds: cls.skills.filter((s) => s.unlockLevel <= level).map((s) => s.id),
  };
}

export function createCharacter(id: string, name: string, cls: CharacterClass, level = 1): Character {
  const stats = statsForLevel(cls, level);
  return {
    id,
    name,
    classId: cls.id,
    level,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    mp: stats.maxMp,
    maxMp: stats.maxMp,
    attack: stats.attack,
    defense: stats.defense,
    aggro: cls.baseAggro,
    speed: cls.baseSpeed,
    survival: { ...INITIAL_SURVIVAL_STATS },
    unlockedSkillIds: stats.unlockedSkillIds,
    activeStatusEffects: [],
    isAlive: true,
    usesRemainingThisCombat: {},
    cooldownsRemaining: {},
  };
}

/**
 * Adds `gained` EXP to the shared party pool and levels the whole party up
 * to match (docs/gameplay-decisions.md §6.9) — level is still shared across
 * the party, only the trigger changed from floor depth to EXP. A level-up
 * fully heals hp/mp and unlocks any skill whose unlockLevel is now met,
 * matching the existing "lên cấp = hồi phục toàn phần" rule (§5).
 */
export function applyPartyExp(state: GameState, gained: number): void {
  state.partyExp += gained;
  const newLevel = levelForTotalExp(state.partyExp);
  for (const character of state.party) {
    if (character.level === newLevel) continue;
    const cls = getClass(character.classId);
    const stats = statsForLevel(cls, newLevel);
    character.level = newLevel;
    character.maxHp = stats.maxHp;
    character.maxMp = stats.maxMp;
    character.attack = stats.attack;
    character.defense = stats.defense;
    character.unlockedSkillIds = stats.unlockedSkillIds;
    if (character.isAlive) {
      character.hp = stats.maxHp;
      character.mp = stats.maxMp;
    }
  }
}
