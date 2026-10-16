import type { Character, CharacterClass, CombatStat, GameState, Id } from "../types";
import { classGrowthBonus, levelForTotalExp } from "../data/levelGrowth";
import { getClass, passiveRankDef } from "../data/classes";
import { getArtifact } from "../data/artifacts";
import { getStatusEffect } from "../data/statusEffects";
import { artifactStatBoostSum, curseAggroBoostSum, abilityWidenedStatBoost } from "./artifacts";
import { applyExhaustedMultiplier } from "./survival";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";
import { GROWTH_WEIGHTS } from "../data/growthWeights";

export const MAX_EQUIPPED_ARTIFACTS = BALANCE.party.maxEquippedArtifacts;

/** Sums the stored `appliedAmounts` (what `expireStatusEffect` will undo); the JSON `amount` is only a fallback for entries saved without them. */
export function activeStatusCombatStatSum(character: Character, stat: CombatStat): number {
  let sum = 0;
  for (const active of character.activeStatusEffects) {
    const applied = active.appliedAmounts?.[stat];
    if (applied !== undefined) {
      sum += applied;
      continue;
    }
    for (const e of getStatusEffect(active.statusEffectId).perTurnEffects) {
      if (e.kind === "modifyCombatStat" && e.combatStat === stat) sum += e.amount ?? 0;
    }
  }
  return sum;
}

export interface PartyActionError {
  reason: string;
}

export const INITIAL_SURVIVAL_STATS = {
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

/** Before any Artifact/Ability/status/Exhausted modifier: what an Ability's percentage scaling is measured against. */
export function characterBaseStats(character: Character): LevelStats {
  return statsForLevel(getClass(character.classId), character.level);
}

export function statsForLevel(cls: CharacterClass, level: number): LevelStats {
  const gw = GROWTH_WEIGHTS.classGrowthWeights[cls.id]!;
  return {
    maxHp: cls.baseMaxHp + classGrowthBonus("maxHp", level, gw),
    maxMp: cls.baseMaxMp + classGrowthBonus("maxMp", level, gw),
    attack: cls.baseAttack + classGrowthBonus("attack", level, gw),
    defense: cls.baseDefense + classGrowthBonus("defense", level, gw),
    magicPower: cls.baseMagicPower + classGrowthBonus("magicPower", level, gw),
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
    equippedAbilityId: null,
  };
}

export type CharacterStat = "maxHp" | "maxMp" | "attack" | "defense" | "magicPower" | "speed" | "aggro";

/** `total` is the sum of the parts; `base` is already scaled down while Exhausted. */
export interface StatBreakdown {
  base: number;
  isExhausted: boolean;
  artifact: number;
  ability: number;
  passive: number;
  status: number;
  total: number;
}

/** Exhausted scales the base of every stat but maxHp/maxMp. Knight's passive multiplies maxHp/defense after
 *  equipment; status deltas come last and flat, the way the resolver applies and undoes them. */
export function characterStatBreakdown(character: Character, satiety: number): Record<CharacterStat, StatBreakdown> {
  const cls = getClass(character.classId);
  const base = statsForLevel(cls, character.level);
  const reference: Record<CharacterStat, number> = { ...base, speed: cls.baseSpeed, aggro: cls.baseAggro };
  // `artifactStatBoostSum` folds the equipped Ability's shared effects in with the Artifacts', so the
  // Ability's share is subtracted back out to tell the two apart.
  const boost = artifactStatBoostSum(character, { ...base, speed: cls.baseSpeed });
  const knightPassive = character.classId === "knight" ? passiveRankDef(cls.passiveSkill, character.level) : null;
  const passivePercent: Partial<Record<CharacterStat, number>> = {
    maxHp: knightPassive?.maxHpPercent ?? 0,
    defense: knightPassive?.defensePercent ?? 0,
  };
  const isExhausted = applyExhaustedMultiplier(100, satiety) !== 100;

  const build = (stat: CharacterStat): StatBreakdown => {
    const scalesWithExhausted = stat !== "maxHp" && stat !== "maxMp";
    const statBase = scalesWithExhausted ? applyExhaustedMultiplier(reference[stat], satiety) : reference[stat];
    const ability = abilityWidenedStatBoost(character, stat, reference[stat]);
    const artifact = stat === "aggro" ? curseAggroBoostSum(character) : boost[stat] - ability;
    const beforePassive = statBase + artifact + ability;
    const percent = passivePercent[stat] ?? 0;
    const passive = (percent ? Math.round(beforePassive * (1 + percent / 100)) - beforePassive : 0) + (stat === "aggro" ? (knightPassive?.aggroFlat ?? 0) : 0);
    const status = stat === "maxMp" ? 0 : activeStatusCombatStatSum(character, stat);
    return { base: statBase, isExhausted: scalesWithExhausted && isExhausted, artifact, ability, passive, status, total: beforePassive + passive + status };
  };
  return {
    maxHp: build("maxHp"),
    maxMp: build("maxMp"),
    attack: build("attack"),
    defense: build("defense"),
    magicPower: build("magicPower"),
    speed: build("speed"),
    aggro: build("aggro"),
  };
}

export function recomputeCharacterStats(character: Character, satiety: number): void {
  const stats = characterStatBreakdown(character, satiety);
  character.maxHp = stats.maxHp.total;
  character.maxMp = stats.maxMp.total;
  character.attack = stats.attack.total;
  character.defense = stats.defense.total;
  character.magicPower = stats.magicPower.total;
  character.speed = stats.speed.total;
  character.aggro = stats.aggro.total;
  character.hp = Math.min(character.hp, character.maxHp);
  character.mp = Math.min(character.mp, character.maxMp);
}

/** Call whenever `GameState.satiety` changes: Exhausted is party-wide. */
export function recomputeAllPartyStats(state: GameState): void {
  for (const c of state.party) recomputeCharacterStats(c, state.satiety);
}

/** Permanent: there is no pool to return it to. */
export function removeArtifactFromCharacter(state: GameState, characterId: Id, artifactId: Id): PartyActionError | null {
  const character = state.party.find((c) => c.id === characterId);
  if (!character) return { reason: t("errors.characterNotFound") };
  const idx = character.equippedArtifactIds.indexOf(artifactId);
  if (idx === -1) return { reason: t("errors.artifactNotEquippedOnCharacter") };

  character.equippedArtifactIds.splice(idx, 1);
  recomputeCharacterStats(character, state.satiety);
  return null;
}

export function grantArtifact(state: GameState, artifactId: Id, forceEquip = false): void {
  state.pendingArtifactDecision = { artifactId, forceEquip: forceEquip || getArtifact(artifactId).isCursed === true };
}

/** Decisions resolve one at a time, so Gambling Den's second jackpot artifact waits until this one is done. */
function chainNextGrantIfAny(state: GameState): void {
  if (!state.secondJackpotArtifactId) return;
  const nextId = state.secondJackpotArtifactId;
  state.secondJackpotArtifactId = null;
  grantArtifact(state, nextId);
}

export function discardPendingArtifact(state: GameState): PartyActionError | null {
  const pending = state.pendingArtifactDecision;
  if (!pending) return { reason: t("errors.noPendingArtifactDecision") };
  if (pending.forceEquip) return { reason: t("errors.cannotDiscardForced") };
  state.message = t("game.artifactDiscarded", { artifact: getArtifact(pending.artifactId).name });
  state.pendingArtifactDecision = null;
  chainNextGrantIfAny(state);
  return null;
}

export function resolveArtifactEquip(state: GameState, characterId: Id, replaceArtifactId?: Id): PartyActionError | null {
  const pending = state.pendingArtifactDecision;
  if (!pending) return { reason: t("errors.noPendingArtifactDecision") };
  const character = state.party.find((c) => c.id === characterId);
  if (!character) return { reason: t("errors.characterNotFound") };

  let replacedName: string | null = null;
  if (character.equippedArtifactIds.length >= MAX_EQUIPPED_ARTIFACTS) {
    if (!replaceArtifactId) return { reason: t("errors.needUnequipFirst") };
    if (!character.equippedArtifactIds.includes(replaceArtifactId)) return { reason: t("errors.artifactNotEquippedOnCharacter") };
    if (getArtifact(replaceArtifactId).isCursed) return { reason: t("errors.artifactIsCursed") };
    replacedName = getArtifact(replaceArtifactId).name;
    const err = removeArtifactFromCharacter(state, characterId, replaceArtifactId);
    if (err) return err;
  }

  character.equippedArtifactIds.push(pending.artifactId);
  recomputeCharacterStats(character, state.satiety);
  state.message = replacedName
    ? t("game.artifactReplaced", { character: character.name, old: replacedName, artifact: getArtifact(pending.artifactId).name })
    : t("game.artifactEquippedOn", { character: character.name, artifact: getArtifact(pending.artifactId).name });
  state.pendingArtifactDecision = null;
  chainNextGrantIfAny(state);
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
    recomputeCharacterStats(character, state.satiety);
    if (character.isAlive) {
      character.hp = character.maxHp;
      character.mp = character.maxMp;
    }
  }
}
