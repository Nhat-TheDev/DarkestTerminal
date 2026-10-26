import type { Character, ArtifactEffect, AbilityEffect, AbilityOnlyEffect } from "../types";
import { getArtifact } from "../data/artifacts";
import { getAbility } from "../data/abilities";
import { ownPassiveRank } from "../data/classes";
import { getStatusEffect } from "../data/statusEffects";
import type { Rng } from "./rng";

/** Structurally identical to `Exclude<ArtifactEffect, { kind: "curseAggroBoost" }>`, so usable wherever `ArtifactEffect[]` is expected. */
type AbilitySharedEffect = Exclude<AbilityEffect, AbilityOnlyEffect>;

function isArtifactCompatible(effect: AbilityEffect): effect is AbilitySharedEffect {
  return !(effect.kind === "statBoost" && effect.stat === "aggro");
}

/** Everything but the Ability-only aggro `statBoost`, in `ArtifactEffect` shape so every artifact hook applies to Abilities unchanged. */
function abilitySharedEffects(character: Character): ArtifactEffect[] {
  if (!character.equippedAbilityId) return [];
  return getAbility(character.equippedAbilityId).effects.filter(isArtifactCompatible);
}

function equippedEntries(character: Character): { effect: ArtifactEffect; sourceName: string }[] {
  const fromArtifacts = character.equippedArtifactIds.flatMap((id) => {
    const artifact = getArtifact(id);
    return artifact.effects.map((effect) => ({ effect, sourceName: artifact.name }));
  });
  const ability = character.equippedAbilityId ? getAbility(character.equippedAbilityId) : null;
  const fromAbility = ability ? abilitySharedEffects(character).map((effect) => ({ effect, sourceName: ability.name })) : [];
  return [...fromArtifacts, ...fromAbility];
}

function equippedEffects(character: Character): ArtifactEffect[] {
  return equippedEntries(character).map((e) => e.effect);
}

export type AbilityStatBoostTarget = Extract<AbilityEffect, { kind: "statBoost" }>["stat"];

function amountWithFloor(base: number, effect: { amount: number; minPercent?: number }): number {
  if (!effect.minPercent) return effect.amount;
  const floor = Math.round((base * effect.minPercent) / 100);
  return Math.abs(floor) > Math.abs(effect.amount) ? floor : effect.amount;
}

/**
 * The only way to tell an Ability's share from an Artifact's, which `artifactStatBoostSum` sums together.
 * `base` is the stat's class-base-plus-level value, the `minPercent` reference.
 */
export function abilityWidenedStatBoost(character: Character, stat: AbilityStatBoostTarget, base: number): number {
  if (!character.equippedAbilityId) return 0;
  return getAbility(character.equippedAbilityId)
    .effects.filter((e): e is Extract<AbilityEffect, { kind: "statBoost" }> => e.kind === "statBoost" && e.stat === stat)
    .reduce((sum, e) => sum + amountWithFloor(base, e), 0);
}

/** Percent chance that at least one of two independent percent chances succeeds. */
export function combinePercents(a: number, b: number): number {
  return a + b - (a * b) / 100;
}

export function alwaysHitChance(character: Character): number {
  return equippedEffects(character).reduce((total, e) => (e.kind === "alwaysHit" ? combinePercents(total, e.chance) : total), 0);
}

export function debuffResistPercent(character: Character): number {
  return equippedEffects(character).reduce((total, e) => (e.kind === "debuffResist" ? combinePercents(total, e.percent) : total), 0);
}

function sumOf<K extends ArtifactEffect["kind"]>(character: Character, kind: K, field: "amount" | "percent" | "turns"): number {
  return equippedEffects(character)
    .filter((e): e is Extract<ArtifactEffect, { kind: K }> => e.kind === kind)
    .reduce((sum, e) => sum + ((e as unknown as Record<string, number>)[field] ?? 0), 0);
}

type StatBoostStat = Extract<ArtifactEffect, { kind: "statBoost" }>["stat"];

/** `base` is each stat's class-base-plus-level value, the `minPercent` reference. Artifacts never set `minPercent`. */
export function artifactStatBoostSum(character: Character, base: Record<StatBoostStat, number>): Record<StatBoostStat, number> {
  const sums: Record<StatBoostStat, number> = { attack: 0, defense: 0, maxHp: 0, maxMp: 0, magicPower: 0, speed: 0 };
  for (const effect of equippedEffects(character)) {
    if (effect.kind === "statBoost") sums[effect.stat] += amountWithFloor(base[effect.stat], effect);
  }
  return sums;
}

export function rollDodge(character: Character, rng: Rng): boolean {
  if (equippedEffects(character).some((e) => e.kind === "dodgeChance" && rng.chance(e.chance / 100))) return true;
  for (const active of character.activeStatusEffects) {
    const percent = getStatusEffect(active.statusEffectId).dodgePercent ?? 0;
    if (percent > 0 && rng.chance(percent / 100)) return true;
  }
  const dodgePercent = ownPassiveRank(character)?.dodgePercent ?? 0;
  return dodgePercent > 0 && rng.chance(dodgePercent / 100);
}

export function rollPoisonOnHit(character: Character, rng: Rng): Extract<ArtifactEffect, { kind: "poisonOnHit" }> | undefined {
  return equippedEffects(character).find((e): e is Extract<ArtifactEffect, { kind: "poisonOnHit" }> => e.kind === "poisonOnHit" && rng.chance(e.chance / 100));
}

export function totalReflectDamagePercent(character: Character): number {
  return sumOf(character, "reflectDamage", "percent");
}

export function totalLifestealPercent(character: Character): number {
  return sumOf(character, "lifesteal", "percent");
}

/** `baseMaxHp` (class base plus level) is the `minPercent` reference. */
export function totalHealOnKill(character: Character, baseMaxHp: number): number {
  return equippedEffects(character)
    .filter((e): e is Extract<ArtifactEffect, { kind: "healOnKill" }> => e.kind === "healOnKill")
    .reduce((sum, e) => sum + amountWithFloor(baseMaxHp, e), 0);
}

export function autoDamageEntries(character: Character): { effect: Extract<ArtifactEffect, { kind: "autoDamage" }>; sourceName: string }[] {
  return equippedEntries(character).filter(
    (e): e is { effect: Extract<ArtifactEffect, { kind: "autoDamage" }>; sourceName: string } => e.effect.kind === "autoDamage"
  );
}

export function totalExpBoostPercent(party: Character[]): number {
  return party.reduce((sum, c) => sum + sumOf(c, "expBoost", "percent"), 0);
}

export function fearResistMultiplier(character: Character): number {
  return 1 - Math.min(1, sumOf(character, "fearResist", "percent") / 100);
}

export function totalCooldownReduction(character: Character): number {
  return sumOf(character, "cooldownReduction", "turns");
}

export function curseAggroBoostSum(character: Character): number {
  return sumOf(character, "curseAggroBoost", "amount");
}
