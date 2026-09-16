import type { SummonArchetype, SkillDefinition, SummonCast } from "../types";
import summonsJson from "../../data/summons.json";

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

/**
 * An action-weight key names a skill and nothing else, so a typo would otherwise be invisible —
 * nothing resolves it, and the summon quietly spends its whole life on basic attacks. Checked once
 * for the whole catalog, mirrors `assertMonsterDataConsistent` (`src/data/monsters.ts`).
 */
export function assertSummonDataConsistent(archetypes: SummonArchetype[], casts: SummonCast[]): void {
  for (const archetype of archetypes) {
    const declared = new Set(archetype.signatureSkillIds ?? []);
    for (const id of archetype.signatureSkillIds ?? []) getSummonSkill(id); // throws on an unknown id
    for (const key of Object.keys(archetype.actionWeights ?? {})) {
      if (key !== "basicAttack" && !declared.has(key)) {
        throw new Error(`data/summons.json: "${archetype.id}" actionWeights key "${key}" is not in its signatureSkillIds`);
      }
    }
  }
  for (const cast of casts) getSummonArchetype(cast.archetypeId); // throws on an unknown id
}

assertSummonDataConsistent(SUMMON_ARCHETYPES, SUMMON_CASTS);
