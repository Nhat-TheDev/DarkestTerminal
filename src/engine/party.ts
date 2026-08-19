import type { Character, CharacterClass, GameState, Id } from "../types";
import { classGrowthBonus, levelForTotalExp } from "../data/levelGrowth";
import { getClass } from "../data/classes";
import { artifactStatBoostSum, curseAggroBoostSum } from "./artifacts";
import { t } from "../data/strings";

/** Max equipped artifacts per character (docs/gameplay-decisions/07-items-artifacts.md §7.2). */
export const MAX_EQUIPPED_ARTIFACTS = 3;

export interface PartyActionError {
  reason: string;
}

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
export function statsForLevel(cls: CharacterClass, level: number): LevelStats {
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
    equippedArtifactIds: [],
  };
}

/**
 * Recomputes attack/defense/maxHp/maxMp/aggro from scratch (class+level base,
 * plus every equipped artifact's statBoost/curseAggroBoost) and reclamps
 * current hp/mp to the new max — called after equip, unequip, AND level-up
 * (docs/gameplay-decisions/07-items-artifacts.md §7.2, docs/gameplay-decisions/08-events.md
 * §8.6 for curseAggroBoost). Recomputing from scratch instead of tracking
 * incremental deltas means it's safe to call redundantly and can't drift,
 * and it's the only way artifact bonuses survive applyPartyExp's level-up,
 * which recomputes base stats from the class curve directly.
 */
export function recomputeCharacterStats(character: Character): void {
  const cls = getClass(character.classId);
  const base = statsForLevel(cls, character.level);
  const boost = artifactStatBoostSum(character);
  character.attack = base.attack + boost.attack;
  character.defense = base.defense + boost.defense;
  character.maxHp = base.maxHp + boost.maxHp;
  character.maxMp = base.maxMp + boost.maxMp;
  character.aggro = cls.baseAggro + curseAggroBoostSum(character);
  character.hp = Math.min(character.hp, character.maxHp);
  character.mp = Math.min(character.mp, character.maxMp);
}

/** Equips `artifactId` from the shared unequipped pool onto `characterId` — free, unlimited, max 3/character (§7.2). */
export function equipArtifact(state: GameState, characterId: Id, artifactId: Id): PartyActionError | null {
  const character = state.party.find((c) => c.id === characterId);
  if (!character) return { reason: t("errors.characterNotFound") };
  if (!state.unequippedArtifactIds.includes(artifactId)) return { reason: t("errors.artifactNotInPool") };
  if (character.equippedArtifactIds.length >= MAX_EQUIPPED_ARTIFACTS) return { reason: t("errors.maxArtifactsEquipped", { max: MAX_EQUIPPED_ARTIFACTS }) };

  state.unequippedArtifactIds.splice(state.unequippedArtifactIds.indexOf(artifactId), 1);
  character.equippedArtifactIds.push(artifactId);
  recomputeCharacterStats(character);
  return null;
}

/** Unequips `artifactId` from `characterId` back into the shared pool — free, unlimited (§7.2). */
export function unequipArtifact(state: GameState, characterId: Id, artifactId: Id): PartyActionError | null {
  const character = state.party.find((c) => c.id === characterId);
  if (!character) return { reason: t("errors.characterNotFound") };
  const idx = character.equippedArtifactIds.indexOf(artifactId);
  if (idx === -1) return { reason: t("errors.artifactNotEquippedOnCharacter") };

  character.equippedArtifactIds.splice(idx, 1);
  state.unequippedArtifactIds.push(artifactId);
  recomputeCharacterStats(character);
  return null;
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
    character.unlockedSkillIds = stats.unlockedSkillIds;
    // recomputeCharacterStats sets attack/defense/maxHp/maxMp from the new level
    // *plus* any equipped artifacts' statBoost (docs/gameplay-decisions/07-items-artifacts.md
    // §7.2) — a plain reassignment here would silently wipe artifact bonuses on every level-up.
    recomputeCharacterStats(character);
    if (character.isAlive) {
      character.hp = character.maxHp;
      character.mp = character.maxMp;
    }
  }
}
