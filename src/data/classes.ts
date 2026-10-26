import type { CharacterClass, Id, SkillDefinition, SkillRankDefinition, PassiveSkillDefinition, PassiveRankDefinition } from "../types";
import classesJson from "../../data/classes.json";
import { STATUS_EFFECTS } from "./statusEffects";
import { SUMMON_CASTS } from "./summons";
import { ATTACK_RANGES } from "./balanceConfig";

/** The JSON keeps a ranked skill's base numbers only in rank 1; copying them up lets every reader treat it as a plain `SkillDefinition`. */
function normalizeRankedSkill(skill: SkillDefinition): SkillDefinition {
  const rank1 = skill.ranks?.find((r) => r.rank === 1);
  if (!rank1) return skill;
  return { ...skill, mpCost: rank1.mpCost, unlockLevel: rank1.unlockLevel, effects: rank1.effects };
}

export const CLASSES = classesJson as unknown as CharacterClass[];

/** The basic attack (slot 0), 5 class skills (slots 1-5) and the ultimate (slot 6). */
export const SKILLS_PER_CLASS = 7;

export function validatePassiveStatusIds(classId: string, passive: PassiveSkillDefinition): void {
  const check = (where: string, field: string, ids: Id[]) => {
    for (const id of ids) {
      if (!STATUS_EFFECTS.some((s) => s.id === id)) throw new Error(`data/classes.json: class "${classId}"'s passive ${where} names an unknown ${field} "${id}"`);
    }
  };
  for (const rank of passive.ranks) {
    check(`rank ${rank.rank}`, "thresholdStatusEffectId", rank.thresholdStatusEffectId ? [rank.thresholdStatusEffectId] : []);
    check(`rank ${rank.rank}`, "onHitStatusEffectId", rank.onHitStatusEffectId ? [rank.onHitStatusEffectId] : []);
  }
  check("skill", "requiresTargetStatusId", passive.requiresTargetStatusId ? [passive.requiresTargetStatusId] : []);
  check("skill", "debuffPool", passive.debuffPool ?? []);
  check("skill", "stackBurst.statusEffectId", passive.stackBurst ? [passive.stackBurst.statusEffectId] : []);
  check("skill", "growthSwapStatusIds", Object.values(passive.growthSwapStatusIds ?? {}).flatMap((ids) => [ids.up, ids.down]));
  if (passive.cloneSummonCastId !== undefined && !SUMMON_CASTS.some((c) => c.id === passive.cloneSummonCastId)) {
    throw new Error(`data/classes.json: class "${classId}"'s passive names an unknown cloneSummonCastId "${passive.cloneSummonCastId}"`);
  }
}

if (CLASSES.length === 0) throw new Error("data/classes.json: no classes defined");
for (const cls of CLASSES) {
  if (cls.skills.length !== SKILLS_PER_CLASS) {
    throw new Error(`data/classes.json: class "${cls.id}" must have exactly ${SKILLS_PER_CLASS} skills (has ${cls.skills.length})`);
  }
  if (!ATTACK_RANGES.includes(cls.attackRange)) {
    throw new Error(`data/classes.json: class "${cls.id}" needs an "attackRange" of ${ATTACK_RANGES.join(" or ")}`);
  }
  cls.skills = cls.skills.map(normalizeRankedSkill);

  const passiveRanks = cls.passiveSkill.ranks.map((r) => r.rank);
  if (passiveRanks.length !== 3 || ![1, 2, 3].every((rank) => passiveRanks.includes(rank as 1 | 2 | 3))) {
    throw new Error(`data/classes.json: class "${cls.id}"'s passiveSkill must have exactly ranks 1, 2, and 3 (has ${JSON.stringify(passiveRanks)})`);
  }
  validatePassiveStatusIds(cls.id, cls.passiveSkill);
  const { procRolls } = cls.passiveSkill;
  if (procRolls !== undefined && (!Number.isInteger(procRolls) || procRolls < 1)) {
    throw new Error(`data/classes.json: class "${cls.id}"'s passive "procRolls" must be a positive integer (has ${procRolls})`);
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

export function effectiveSkillRank(skill: SkillDefinition, level: number): number {
  let rank = 0;
  for (const r of skill.ranks ?? []) {
    if (r.unlockLevel <= level && r.rank > rank) rank = r.rank;
  }
  return rank;
}

export function getUnlockedPassiveRank(passive: PassiveSkillDefinition, level: number): 0 | 1 | 2 | 3 {
  let rank: 0 | 1 | 2 | 3 = 0;
  for (const r of passive.ranks) {
    if (r.unlockLevel <= level && r.rank > rank) rank = r.rank;
  }
  return rank;
}

export function passiveRankDef(passive: PassiveSkillDefinition, level: number): PassiveRankDefinition | null {
  const rank = getUnlockedPassiveRank(passive, level);
  if (rank === 0) return null;
  return passive.ranks.find((r) => r.rank === rank) ?? null;
}
