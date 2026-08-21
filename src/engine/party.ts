import type { Character, CharacterClass, GameState, Id } from "../types";
import { classGrowthBonus, levelForTotalExp } from "../data/levelGrowth";
import { getClass } from "../data/classes";
import { artifactStatBoostSum, curseAggroBoostSum } from "./artifacts";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";

export const MAX_EQUIPPED_ARTIFACTS = BALANCE.party.maxEquippedArtifacts;

export interface PartyActionError {
  reason: string;
}

export const INITIAL_SURVIVAL_STATS = {
  hunger: BALANCE.survival.initialHunger,
  thirst: BALANCE.survival.initialThirst,
  fear: BALANCE.survival.initialFear,
};

interface LevelStats {
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  magicPower: number;
  unlockedSkillIds: string[];
}

export function statsForLevel(cls: CharacterClass, level: number): LevelStats {
  return {
    maxHp: cls.baseMaxHp + classGrowthBonus("maxHp", level, cls.growthWeights),
    maxMp: cls.baseMaxMp + classGrowthBonus("maxMp", level, cls.growthWeights),
    attack: cls.baseAttack + classGrowthBonus("attack", level, cls.growthWeights),
    defense: cls.baseDefense + classGrowthBonus("defense", level, cls.growthWeights),
    magicPower: cls.baseMagicPower + classGrowthBonus("magicPower", level, cls.growthWeights),
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
    magicPower: stats.magicPower,
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

export function recomputeCharacterStats(character: Character): void {
  const cls = getClass(character.classId);
  const base = statsForLevel(cls, character.level);
  const boost = artifactStatBoostSum(character);
  character.attack = base.attack + boost.attack;
  character.defense = base.defense + boost.defense;
  character.magicPower = base.magicPower;
  character.maxHp = base.maxHp + boost.maxHp;
  character.maxMp = base.maxMp + boost.maxMp;
  character.aggro = cls.baseAggro + curseAggroBoostSum(character);
  character.hp = Math.min(character.hp, character.maxHp);
  character.mp = Math.min(character.mp, character.maxMp);
}

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

export function applyPartyExp(state: GameState, gained: number): void {
  state.partyExp += gained;
  const newLevel = levelForTotalExp(state.partyExp);
  for (const character of state.party) {
    if (character.level === newLevel) continue;
    const cls = getClass(character.classId);
    const stats = statsForLevel(cls, newLevel);
    character.level = newLevel;
    character.unlockedSkillIds = stats.unlockedSkillIds;
    recomputeCharacterStats(character);
    if (character.isAlive) {
      character.hp = character.maxHp;
      character.mp = character.maxMp;
    }
  }
}
