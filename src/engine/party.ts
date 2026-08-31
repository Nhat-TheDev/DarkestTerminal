import type { Character, CharacterClass, CombatStat, GameState, Id } from "../types";
import { classGrowthBonus, levelForTotalExp } from "../data/levelGrowth";
import { getClass } from "../data/classes";
import { getArtifact } from "../data/artifacts";
import { getStatusEffect } from "../data/statusEffects";
import { artifactStatBoostSum, curseAggroBoostSum } from "./artifacts";
import { applyExhaustedMultiplier } from "./survival";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";

export const MAX_EQUIPPED_ARTIFACTS = BALANCE.party.maxEquippedArtifacts;

/** Net modifyCombatStat delta from the character's active status effects, so recomputeCharacterStats can rebuild `stat` from scratch without dropping them. */
function activeStatusCombatStatSum(character: Character, stat: CombatStat): number {
  let sum = 0;
  for (const active of character.activeStatusEffects) {
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

/** `satiety`'s Exhausted penalty applies to base stats before artifact/curse bonuses are added; maxHp/maxMp are unaffected. */
export function recomputeCharacterStats(character: Character, satiety: number): void {
  const cls = getClass(character.classId);
  const base = statsForLevel(cls, character.level);
  const boost = artifactStatBoostSum(character);
  character.attack = applyExhaustedMultiplier(base.attack, satiety) + boost.attack + activeStatusCombatStatSum(character, "attack");
  character.defense = applyExhaustedMultiplier(base.defense, satiety) + boost.defense + activeStatusCombatStatSum(character, "defense");
  character.magicPower = applyExhaustedMultiplier(base.magicPower, satiety);
  character.maxHp = base.maxHp + boost.maxHp;
  character.maxMp = base.maxMp + boost.maxMp;
  character.aggro = applyExhaustedMultiplier(cls.baseAggro, satiety) + curseAggroBoostSum(character) + activeStatusCombatStatSum(character, "aggro");
  character.speed = applyExhaustedMultiplier(cls.baseSpeed, satiety) + activeStatusCombatStatSum(character, "speed");
  character.hp = Math.min(character.hp, character.maxHp);
  character.mp = Math.min(character.mp, character.maxMp);
}

/** Call whenever `GameState.satiety` changes — Exhausted is party-wide, so every character needs refreshing. */
export function recomputeAllPartyStats(state: GameState): void {
  for (const c of state.party) recomputeCharacterStats(c, state.satiety);
}

/** Removes an artifact from wherever it's equipped, permanently — no pool to return it to. Used only by Wandering Hermit exchange, Sacrificial Circle, and the forced-replacement step of the pending-artifact-decision flow; never a free-standing player action. */
export function removeArtifactFromCharacter(state: GameState, characterId: Id, artifactId: Id): PartyActionError | null {
  const character = state.party.find((c) => c.id === characterId);
  if (!character) return { reason: t("errors.characterNotFound") };
  const idx = character.equippedArtifactIds.indexOf(artifactId);
  if (idx === -1) return { reason: t("errors.artifactNotEquippedOnCharacter") };

  character.equippedArtifactIds.splice(idx, 1);
  recomputeCharacterStats(character, state.satiety);
  return null;
}

/** An artifact was just rolled/revealed; sets it awaiting the player's equip/discard decision. `forceEquip` covers events (Twin Altars) that force the flow regardless of the artifact's own `isCursed` flag. */
export function grantArtifact(state: GameState, artifactId: Id, source: "elite" | "boss" | "treasureOrEvent" | "event", forceEquip = false): void {
  state.pendingArtifactDecision = { artifactId, forceEquip: forceEquip || getArtifact(artifactId).isCursed === true, source };
}

/** Called after a pending decision resolves — chains in Gambling Den's 2nd jackpot artifact, since decisions resolve sequentially, never simultaneously. */
function chainNextGrantIfAny(state: GameState): void {
  if (!state.secondJackpotArtifactId) return;
  const nextId = state.secondJackpotArtifactId;
  state.secondJackpotArtifactId = null;
  grantArtifact(state, nextId, "event");
}

/** Discard branch. Only valid for an ordinary (non-Cursed, non-forceEquip) pending artifact. */
export function discardPendingArtifact(state: GameState): PartyActionError | null {
  const pending = state.pendingArtifactDecision;
  if (!pending) return { reason: t("errors.noPendingArtifactDecision") };
  if (pending.forceEquip) return { reason: t("errors.cannotDiscardForced") };
  state.message = t("game.artifactDiscarded", { artifact: getArtifact(pending.artifactId).name });
  state.pendingArtifactDecision = null;
  chainNextGrantIfAny(state);
  return null;
}

/**
 * Equip branch (voluntary and forced-equip paths). If the target character is already at
 * 3/3, `replaceArtifactId` must name 1 of their own equipped *ordinary* (non-Cursed) artifacts
 * to discard and make room — a Cursed artifact they wear can never be discarded this way.
 */
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
