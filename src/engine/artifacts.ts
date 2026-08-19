import type { Character, ArtifactEffect } from "../types";
import { getArtifact } from "../data/artifacts";
import type { Rng } from "./rng";

// docs/gameplay-decisions/07-items-artifacts.md §7.2 — every hook here reads
// only `character.equippedArtifactIds`, no leveling/equip-mutation concerns
// (those live in party.ts, which imports the pure helpers below — keeps the
// dependency one-directional and avoids a party.ts <-> artifacts.ts cycle).

function equippedEffects(character: Character): ArtifactEffect[] {
  return character.equippedArtifactIds.flatMap((id) => getArtifact(id).effects);
}

function sumOf<K extends ArtifactEffect["kind"]>(character: Character, kind: K, field: "amount" | "percent" | "turns"): number {
  return equippedEffects(character)
    .filter((e): e is Extract<ArtifactEffect, { kind: K }> => e.kind === kind)
    .reduce((sum, e) => sum + ((e as unknown as Record<string, number>)[field] ?? 0), 0);
}

/** §7.2 group 1 — statBoost, summed per stat (recomputed from scratch by party.ts's recomputeCharacterStats, not applied as an incremental delta). */
export function artifactStatBoostSum(character: Character): { attack: number; defense: number; maxHp: number; maxMp: number } {
  const sums = { attack: 0, defense: 0, maxHp: 0, maxMp: 0 };
  for (const effect of equippedEffects(character)) {
    if (effect.kind === "statBoost") sums[effect.stat] += effect.amount;
  }
  return sums;
}

/** dodgeChance — 1 independent roll per equipped copy (matches the doc's "2 roll độc lập" stacking rule); any success dodges. */
export function rollDodge(character: Character, rng: Rng): boolean {
  return equippedEffects(character).some((e) => e.kind === "dodgeChance" && rng.chance(e.chance / 100));
}

/** poisonOnHit — 1 independent roll per equipped copy; any success applies Poisoned. */
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

/** autoDamage — 1 flat-damage tick per equipped copy (not per artifact type), so 2 Thunder Totems fire 2 separate ticks. */
export function autoDamageAmounts(character: Character): number[] {
  return equippedEffects(character)
    .filter((e) => e.kind === "autoDamage")
    .map((e) => (e as Extract<ArtifactEffect, { kind: "autoDamage" }>).amount);
}

/** expBoost — party-wide (§7.2: "không giới hạn theo 1 người" since EXP is shared partyExp), so it sums across every equipped copy on every character. */
export function totalExpBoostPercent(party: Character[]): number {
  return party.reduce((sum, c) => sum + sumOf(c, "expBoost", "percent"), 0);
}

export function fearResistMultiplier(character: Character): number {
  return 1 - Math.min(1, sumOf(character, "fearResist", "percent") / 100);
}

export function totalCooldownReduction(character: Character): number {
  return sumOf(character, "cooldownReduction", "turns");
}

/** docs/gameplay-decisions/08-events.md §8.6 — curseDrainBoost is the inverse of survivalDrainReduction, so the 2 combine multiplicatively instead of one field cancelling the other out additively. */
export function survivalDrainMultiplier(character: Character): number {
  const reduction = 1 - Math.min(1, sumOf(character, "survivalDrainReduction", "percent") / 100);
  const curse = 1 + sumOf(character, "curseDrainBoost", "percent") / 100;
  return reduction * curse;
}

/** curseAggroBoost (§8.6) — permanent flat aggro add, recomputed alongside statBoost by party.ts's recomputeCharacterStats. */
export function curseAggroBoostSum(character: Character): number {
  return sumOf(character, "curseAggroBoost", "amount");
}
