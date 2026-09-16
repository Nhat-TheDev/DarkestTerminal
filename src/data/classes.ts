import type { CharacterClass, SkillDefinition, SkillRankDefinition, PassiveSkillDefinition } from "../types";
import classesJson from "../../data/classes.json";

/**
 * A ranked skill's rank-1 numbers are its "base" numbers — `data/classes.json` doesn't repeat
 * mpCost/effects/unlockLevel at the top level and in `ranks[0]`; this fills the top level in from
 * `ranks[0]` once at load, so every other reader (`getEffectiveSkill`, `party.ts`'s
 * `unlockedSkillIds` filter, the UI, tests) keeps seeing a fully-populated `SkillDefinition`.
 */
function normalizeRankedSkill(skill: SkillDefinition): SkillDefinition {
  const rank1 = skill.ranks?.find((r) => r.rank === 1);
  if (!rank1) return skill;
  return { ...skill, mpCost: rank1.mpCost, unlockLevel: rank1.unlockLevel, effects: rank1.effects };
}

export const CLASSES = classesJson as unknown as CharacterClass[];

if (CLASSES.length === 0) throw new Error("data/classes.json: no classes defined");
for (const cls of CLASSES) {
  if (cls.skills.length !== 6) {
    throw new Error(`data/classes.json: class "${cls.id}" must have exactly 6 skills (has ${cls.skills.length})`);
  }
  cls.skills = cls.skills.map(normalizeRankedSkill);
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
 * Resolves a skill's mpCost/effects to the highest rank unlocked at `level`.
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
  };
}

/** The highest rank number of `skill` unlocked at `level` (0 if it has no `ranks` or none are unlocked yet) — for reading a rank-gated passive (e.g. Summoner's Mastery cap increase) without needing the skill to have actually been cast. */
export function effectiveSkillRank(skill: SkillDefinition, level: number): number {
  let rank = 0;
  for (const r of skill.ranks ?? []) {
    if (r.unlockLevel <= level && r.rank > rank) rank = r.rank;
  }
  return rank;
}

/** Rank derived purely from level, independent of anything being cast — a passive is never queued
 *  or triggered by the player, so there's no "has this been cast" question the way a normal
 *  skill's `effectiveSkillRank` implicitly assumes. */
export function getUnlockedPassiveRank(passive: PassiveSkillDefinition, level: number): 0 | 1 | 2 | 3 {
  let rank: 0 | 1 | 2 | 3 = 0;
  for (const r of passive.ranks) {
    if (r.unlockLevel <= level && r.rank > rank) rank = r.rank;
  }
  return rank;
}
