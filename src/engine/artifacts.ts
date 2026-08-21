import type { Character, ArtifactEffect } from "../types";
import { getArtifact } from "../data/artifacts";
import type { Rng } from "./rng";

function equippedEffects(character: Character): ArtifactEffect[] {
  return character.equippedArtifactIds.flatMap((id) => getArtifact(id).effects);
}

function sumOf<K extends ArtifactEffect["kind"]>(character: Character, kind: K, field: "amount" | "percent" | "turns"): number {
  return equippedEffects(character)
    .filter((e): e is Extract<ArtifactEffect, { kind: K }> => e.kind === kind)
    .reduce((sum, e) => sum + ((e as unknown as Record<string, number>)[field] ?? 0), 0);
}

export function artifactStatBoostSum(character: Character): { attack: number; defense: number; maxHp: number; maxMp: number } {
  const sums = { attack: 0, defense: 0, maxHp: 0, maxMp: 0 };
  for (const effect of equippedEffects(character)) {
    if (effect.kind === "statBoost") sums[effect.stat] += effect.amount;
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

export function survivalDrainMultiplier(character: Character): number {
  const reduction = 1 - Math.min(1, sumOf(character, "survivalDrainReduction", "percent") / 100);
  const curse = 1 + sumOf(character, "curseDrainBoost", "percent") / 100;
  return reduction * curse;
}

export function curseAggroBoostSum(character: Character): number {
  return sumOf(character, "curseAggroBoost", "amount");
}
