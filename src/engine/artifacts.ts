import type { Character, ArtifactEffect, AbilityEffect, AbilityOnlyEffect } from "../types";
import { getArtifact } from "../data/artifacts";
import { getAbility } from "../data/abilities";
import type { Rng } from "./rng";

/** The part of `AbilityEffect` that isn't `AbilityOnlyEffect` — structurally identical to `Exclude<ArtifactEffect, { kind: "curseAggroBoost" }>`, so it's safely usable wherever `ArtifactEffect[]` is expected below. */
type AbilitySharedEffect = Exclude<AbilityEffect, AbilityOnlyEffect>;

function isArtifactCompatible(effect: AbilityEffect): effect is AbilitySharedEffect {
  return !(effect.kind === "statBoost" && effect.stat === "aggro");
}

/** The character's 1 equipped Ability's effects that share a kind with `ArtifactEffect` — everything except the Ability-only `statBoost` on `aggro` (handled separately in `party.ts`). Reusing the exact `ArtifactEffect` shape here is what lets every sum function below (and every engine hook in `07-items-artifacts.md` §7.2) apply to Abilities with zero changes to their own logic — `11-abilities.md` §11.1. */
function abilitySharedEffects(character: Character): ArtifactEffect[] {
  if (!character.equippedAbilityId) return [];
  return getAbility(character.equippedAbilityId).effects.filter(isArtifactCompatible);
}

/** Every equipped effect paired with the name of the Artifact/Ability it came from (for log lines). */
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

/** Every stat an Ability's `statBoost` can name: the 6 it shares with Artifacts plus `aggro`. */
export type AbilityStatBoostTarget = Extract<AbilityEffect, { kind: "statBoost" }>["stat"];

/** `effect.amount` unless `effect.minPercent` is set and `base * minPercent / 100` has the larger magnitude — see
 *  the `statBoost`/`healOnKill` doc comments on `ArtifactEffect`. `base` is the caller-supplied reference value
 *  (a stat's pre-equipment value for `statBoost`, the bearer's max HP for `healOnKill`). */
function amountWithFloor(base: number, effect: { amount: number; minPercent?: number }): number {
  if (!effect.minPercent) return effect.amount;
  const floor = Math.round((base * effect.minPercent) / 100);
  return Math.abs(floor) > Math.abs(effect.amount) ? floor : effect.amount;
}

/**
 * The equipped Ability's own `statBoost` on `stat` — 0 if no Ability is equipped or it doesn't touch
 * `stat`. It is the only way to tell an Ability's contribution apart from an Artifact's, since
 * `artifactStatBoostSum` deliberately sums both together; `party.ts` also calls it for `aggro`, the one stat
 * only an Ability can boost. `base` is `stat`'s own class-base-plus-level value (before Artifact/Ability/
 * status/Exhausted) — the `minPercent` floor's reference point; pass the constant `cls.baseAggro`/`cls.baseSpeed`
 * for those 2 (never scale with level, so no ability there needs `minPercent` in practice, but the reference
 * still has to be right).
 */
export function abilityWidenedStatBoost(character: Character, stat: AbilityStatBoostTarget, base: number): number {
  if (!character.equippedAbilityId) return 0;
  return getAbility(character.equippedAbilityId)
    .effects.filter((e): e is Extract<AbilityEffect, { kind: "statBoost" }> => e.kind === "statBoost" && e.stat === stat)
    .reduce((sum, e) => sum + amountWithFloor(base, e), 0);
}

/** Two independent chances (percents) combined into the chance that at least one succeeds. */
function combinePercents(a: number, b: number): number {
  return a + b - (a * b) / 100;
}

/** The bearer's `alwaysHit` chance (a percent, e.g. `20` for 20%) across every equipped Artifact and Ability, each source an independent chance — 0 if none carries it. */
export function alwaysHitChance(character: Character): number {
  return equippedEffects(character).reduce((total, e) => (e.kind === "alwaysHit" ? combinePercents(total, e.chance) : total), 0);
}

/** The bearer's `debuffResist` percent across every equipped Artifact and Ability; each source scales the land chance down on its own, so they combine as `1 − Π(1 − pᵢ)` — 0 if none carries it. */
export function debuffResistPercent(character: Character): number {
  return equippedEffects(character).reduce((total, e) => (e.kind === "debuffResist" ? combinePercents(total, e.percent) : total), 0);
}

function sumOf<K extends ArtifactEffect["kind"]>(character: Character, kind: K, field: "amount" | "percent" | "turns"): number {
  return equippedEffects(character)
    .filter((e): e is Extract<ArtifactEffect, { kind: K }> => e.kind === kind)
    .reduce((sum, e) => sum + ((e as unknown as Record<string, number>)[field] ?? 0), 0);
}

type StatBoostStat = Extract<ArtifactEffect, { kind: "statBoost" }>["stat"];

/** `base` is each stat's own class-base-plus-level value (`characterBaseStats`; `cls.baseSpeed` for speed) — the
 *  `minPercent` floor's reference point for any Ability `statBoost` in the mix (Artifacts never set `minPercent`,
 *  so theirs always fall through to the flat `amount`). */
export function artifactStatBoostSum(character: Character, base: Record<StatBoostStat, number>): Record<StatBoostStat, number> {
  const sums: Record<StatBoostStat, number> = { attack: 0, defense: 0, maxHp: 0, maxMp: 0, magicPower: 0, speed: 0 };
  for (const effect of equippedEffects(character)) {
    if (effect.kind === "statBoost") sums[effect.stat] += amountWithFloor(base[effect.stat], effect);
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

/** `baseMaxHp` is the bearer's class-base-plus-level max HP (`characterBaseStats`), the `minPercent` floor's reference. */
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
