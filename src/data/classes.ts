import type { CharacterClass, SkillDefinition, SkillRankDefinition } from "../types";
import classesJson from "../../data/classes.json";

export const CLASSES = classesJson as unknown as CharacterClass[];

if (CLASSES.length === 0) throw new Error("data/classes.json: no classes defined");
for (const cls of CLASSES) {
  if (cls.skills.length !== 6) {
    throw new Error(`data/classes.json: class "${cls.id}" must have exactly 6 skills (has ${cls.skills.length})`);
  }
}

export function getClass(id: string): CharacterClass {
  const cls = CLASSES.find((c) => c.id === id);
  if (!cls) throw new Error(`Unknown class: ${id}`);
  return cls;
}

export function getSkill(id: string): SkillDefinition {
  for (const cls of CLASSES) {
    const found = cls.skills.find((s) => s.id === id);
    if (found) return found;
  }
  throw new Error(`Unknown skill: ${id}`);
}

/**
 * Resolves a skill's mpCost/effects(ByRelation) to the highest rank unlocked at `level`.
 * Returns the skill unchanged if it has no `ranks` or none are unlocked yet.
 */
export function getEffectiveSkill(skill: SkillDefinition, level: number): SkillDefinition {
  if (!skill.ranks || skill.ranks.length === 0) return skill;
  let effective: SkillRankDefinition | undefined;
  for (const r of skill.ranks) {
    if (r.unlockLevel <= level && (!effective || r.rank > effective.rank)) effective = r;
  }
  if (!effective) return skill;
  return {
    ...skill,
    mpCost: effective.mpCost,
    effects: effective.effects,
    effectsByRelation: effective.effectsByRelation,
  };
}
