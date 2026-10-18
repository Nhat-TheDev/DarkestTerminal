import type { SummonArchetype, SkillDefinition, SummonCast } from "../types";
import summonsJson from "../../data/summons.json";
import { getStatusEffect } from "./statusEffects";
import { ATTACK_RANGES } from "./balanceConfig";

const DATA = summonsJson as unknown as { archetypes: SummonArchetype[]; skills: SkillDefinition[]; casts: SummonCast[] };

export const SUMMON_ARCHETYPES = DATA.archetypes;
export const SUMMON_SKILLS = DATA.skills;
export const SUMMON_CASTS = DATA.casts;

export function getSummonArchetype(id: string): SummonArchetype {
  const found = SUMMON_ARCHETYPES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown summon archetype: ${id}`);
  return found;
}

export function getSummonSkill(id: string): SkillDefinition {
  const found = SUMMON_SKILLS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown summon skill: ${id}`);
  return found;
}

export function getSummonCast(id: string): SummonCast {
  const found = SUMMON_CASTS.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown summon cast: ${id}`);
  return found;
}

/** An action-weight key nothing resolves would silently leave the summon on basic attacks, so it must name a signature skill. */
export function assertSummonDataConsistent(archetypes: SummonArchetype[], casts: SummonCast[]): void {
  for (const archetype of archetypes) {
    if (typeof archetype.speed !== "number") {
      throw new Error(`data/summons.json: archetype "${archetype.id}" is missing a numeric "speed"`);
    }
    if (!ATTACK_RANGES.includes(archetype.attackRange)) {
      throw new Error(`data/summons.json: archetype "${archetype.id}" needs an "attackRange" of ${ATTACK_RANGES.join(" or ")}`);
    }
    const declared = new Set(archetype.signatureSkillIds ?? []);
    for (const id of archetype.signatureSkillIds ?? []) getSummonSkill(id);
    if (archetype.basicAttackOnHit) getStatusEffect(archetype.basicAttackOnHit.statusEffectId);
    for (const key of Object.keys(archetype.actionWeights ?? {})) {
      if (key !== "basicAttack" && !declared.has(key)) {
        throw new Error(`data/summons.json: "${archetype.id}" actionWeights key "${key}" is not in its signatureSkillIds`);
      }
    }
  }
  for (const cast of casts) getSummonArchetype(cast.archetypeId);
}

assertSummonDataConsistent(SUMMON_ARCHETYPES, SUMMON_CASTS);
