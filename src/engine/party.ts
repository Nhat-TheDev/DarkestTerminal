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

/** Net modifyCombatStat delta the character's active status effects actually applied to `stat` — the
 *  `appliedAmounts` each application stored (minPercent floors, a caster's magnitude override and every
 *  stack included), which is exactly what `expireStatusEffect` will undo. The status's own JSON `amount`
 *  is only a fallback for an entry saved without `appliedAmounts`. */
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

/** The character's class base plus level growth — before any Artifact/Ability/status/Exhausted modifier. The reference every percentage scaling of an Ability is measured against. */
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

/** One stat split by source. `total` is always the sum of the other numbers. `base` is the class base plus
 *  level growth, already scaled down while Exhausted (`isExhausted`); `artifact`/`ability` are the equipped
 *  bonuses; `passive` is the class passive's own share; `status` is what active statuses applied. */
export interface StatBreakdown {
  base: number;
  isExhausted: boolean;
  artifact: number;
  ability: number;
  passive: number;
  status: number;
  total: number;
}

/** The single formula every character stat is built from — `recomputeCharacterStats` writes the totals, the
 *  Character Info screen shows the parts. `satiety`'s Exhausted penalty scales the base of every stat but
 *  maxHp/maxMp. A growth-swap passive's `Character.growthShift` (Jester) counts toward the passive share of
 *  attack/magicPower. Vanguard's passive (§11 of the design spec) multiplies maxHp/defense after equipment and adds
 *  flat aggro; status deltas come last and flat, the same way the resolver applies and undoes them mid-fight. */
export function characterStatBreakdown(character: Character, satiety: number): Record<CharacterStat, StatBreakdown> {
  const cls = getClass(character.classId);
  const base = statsForLevel(cls, character.level);
  const reference: Record<CharacterStat, number> = { ...base, speed: cls.baseSpeed, aggro: cls.baseAggro };
  // `artifactStatBoostSum` folds the equipped Ability's shared effects in with the Artifacts', so the
  // Ability's share is subtracted back out to tell the two apart.
  const boost = artifactStatBoostSum(character, { ...base, speed: cls.baseSpeed });
  const vanguardPassive = character.classId === "vanguard" ? passiveRankDef(cls.passiveSkill, character.level) : null;
  const passivePercent: Partial<Record<CharacterStat, number>> = {
    maxHp: vanguardPassive?.maxHpPercent ?? 0,
    defense: vanguardPassive?.defensePercent ?? 0,
  };
  const isExhausted = applyExhaustedMultiplier(100, satiety) !== 100;

  const build = (stat: CharacterStat): StatBreakdown => {
    const scalesWithExhausted = stat !== "maxHp" && stat !== "maxMp";
    const statBase = scalesWithExhausted ? applyExhaustedMultiplier(reference[stat], satiety) : reference[stat];
    const ability = abilityWidenedStatBoost(character, stat, reference[stat]);
    const artifact = stat === "aggro" ? curseAggroBoostSum(character) : boost[stat] - ability;
    const beforePassive = statBase + artifact + ability;
    const percent = passivePercent[stat] ?? 0;
    const growthShift = stat === "attack" || stat === "magicPower" ? (character.growthShift?.[stat] ?? 0) : 0;
    const passive = (percent ? Math.round(beforePassive * (1 + percent / 100)) - beforePassive : 0) + (stat === "aggro" ? (vanguardPassive?.aggroFlat ?? 0) : 0) + growthShift;
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
export function grantArtifact(state: GameState, artifactId: Id, forceEquip = false): void {
  state.pendingArtifactDecision = { artifactId, forceEquip: forceEquip || getArtifact(artifactId).isCursed === true };
}

/** Called after a pending decision resolves — chains in Gambling Den's 2nd jackpot artifact, since decisions resolve sequentially, never simultaneously. */
function chainNextGrantIfAny(state: GameState): void {
  if (!state.secondJackpotArtifactId) return;
  const nextId = state.secondJackpotArtifactId;
  state.secondJackpotArtifactId = null;
  grantArtifact(state, nextId);
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
