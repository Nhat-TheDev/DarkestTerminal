import type { Character, ArtifactEffect, AbilityEffect, AbilityOnlyEffect } from "../types";
import { getArtifact } from "../data/artifacts";
import { getAbility } from "../data/abilities";
import type { Rng } from "./rng";

/** The part of `AbilityEffect` that isn't `AbilityOnlyEffect` — structurally identical to `Exclude<ArtifactEffect, { kind: "curseAggroBoost" }>`, so it's safely usable wherever `ArtifactEffect[]` is expected below. */
type AbilitySharedEffect = Exclude<AbilityEffect, AbilityOnlyEffect>;

function isArtifactCompatible(effect: AbilityEffect): effect is AbilitySharedEffect {
  if (effect.kind === "alwaysHit") return false;
  if (effect.kind === "statBoost") return effect.stat === "attack" || effect.stat === "defense" || effect.stat === "maxHp" || effect.stat === "maxMp";
  return true;
}

/** The character's 1 equipped Ability's effects that share a kind with `ArtifactEffect` — everything except `alwaysHit` and the Ability-only `statBoost` targets (`aggro`/`speed`/`magicPower`, handled separately in `party.ts`/`combat.ts`). Reusing the exact `ArtifactEffect` shape here is what lets every sum function below (and every engine hook in `07-items-artifacts.md` §7.2) apply to Abilities with zero changes to their own logic — `11-abilities.md` §11.1. */
function abilitySharedEffects(character: Character): ArtifactEffect[] {
  if (!character.equippedAbilityId) return [];
  return getAbility(character.equippedAbilityId).effects.filter(isArtifactCompatible);
}

function equippedEffects(character: Character): ArtifactEffect[] {
  return [...character.equippedArtifactIds.flatMap((id) => getArtifact(id).effects), ...abilitySharedEffects(character)];
}

/** Every stat an Ability's `statBoost` can name: the Ability-only trio plus the 4 it shares with Artifacts. */
export type AbilityStatBoostTarget = Extract<AbilityEffect, { kind: "statBoost" }>["stat"];

/** `effect.amount` unless `effect.minPercent` is set and `base * minPercent / 100` has the larger magnitude — see
 *  `ArtifactEffect`'s `statBoost` doc comment. `base` is the caller-supplied pre-equipment value for that stat. */
function statBoostDelta(base: number, effect: { amount: number; minPercent?: number }): number {
  if (!effect.minPercent) return effect.amount;
  const floor = Math.round((base * effect.minPercent) / 100);
  return Math.abs(floor) > Math.abs(effect.amount) ? floor : effect.amount;
}

/**
 * The equipped Ability's `statBoost` on `stat` — 0 if no Ability is equipped or it doesn't touch
 * `stat`. `party.ts` calls it for the stats only Abilities can touch (`aggro`/`speed`/`magicPower`);
 * for the 4 shared with Artifacts it is the only way to tell an Ability's contribution apart from an
 * Artifact's, since `artifactStatBoostSum` deliberately sums both together. `base` is `stat`'s own
 * pre-equipment value (post-level-growth/Exhausted, pre-Artifact/Ability) — the `minPercent` floor's
 * reference point; pass the constant `cls.baseAggro`/`cls.baseSpeed` for those 2 (never scale with
 * level, so no ability there needs `minPercent` in practice, but the reference still has to be right).
 */
export function abilityWidenedStatBoost(character: Character, stat: AbilityStatBoostTarget, base: number): number {
  if (!character.equippedAbilityId) return 0;
  return getAbility(character.equippedAbilityId)
    .effects.filter((e): e is Extract<AbilityEffect, { kind: "statBoost" }> => e.kind === "statBoost" && e.stat === stat)
    .reduce((sum, e) => sum + statBoostDelta(base, e), 0);
}

/** The equipped Ability's `alwaysHit` chance (a percent, e.g. `20` for 20%) — 0 if none equipped or it isn't an `alwaysHit` Ability. */
export function alwaysHitChance(character: Character): number {
  if (!character.equippedAbilityId) return 0;
  const effect = getAbility(character.equippedAbilityId).effects.find((e): e is Extract<AbilityEffect, { kind: "alwaysHit" }> => e.kind === "alwaysHit");
  return effect?.chance ?? 0;
}

function sumOf<K extends ArtifactEffect["kind"]>(character: Character, kind: K, field: "amount" | "percent" | "turns"): number {
  return equippedEffects(character)
    .filter((e): e is Extract<ArtifactEffect, { kind: K }> => e.kind === kind)
    .reduce((sum, e) => sum + ((e as unknown as Record<string, number>)[field] ?? 0), 0);
}

/** `base` is each stat's own pre-equipment value (post-level-growth/Exhausted) — the `minPercent` floor's
 *  reference point for any Ability `statBoost` in the mix (Artifacts never set `minPercent`, so theirs always
 *  fall through to the flat `amount`). */
export function artifactStatBoostSum(
  character: Character,
  base: { attack: number; defense: number; maxHp: number; maxMp: number }
): { attack: number; defense: number; maxHp: number; maxMp: number } {
  const sums = { attack: 0, defense: 0, maxHp: 0, maxMp: 0 };
  for (const effect of equippedEffects(character)) {
    if (effect.kind === "statBoost") sums[effect.stat] += statBoostDelta(base[effect.stat], effect);
  }
  return sums;
}

export function rollDodge(character: Character, rng: Rng): boolean {
  return equippedEffects(character).some((e) => e.kind === "dodgeChance" && rng.chance(e.chance / 100));
}

export function rollPoisonOnHit(character: Character, rng: Rng): boolean {
  return equippedEffects(character).some((e) => e.kind === "poisonOnHit" && rng.chance(e.chance / 100));
}

export function totalReflectDamagePercent(character: Character): number {
  return sumOf(character, "reflectDamage", "percent");
}

export function totalLifestealPercent(character: Character): number {
  return sumOf(character, "lifesteal", "percent");
}

export function totalHealOnKill(character: Character): number {
  return sumOf(character, "healOnKill", "amount");
}

export function autoDamageAmounts(character: Character): number[] {
  return equippedEffects(character)
    .filter((e) => e.kind === "autoDamage")
    .map((e) => (e as Extract<ArtifactEffect, { kind: "autoDamage" }>).amount);
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
