import type { CharacterClass, SkillDefinition } from "../types";
import classesJson from "../../data/classes.json";

// Design data now lives in ../../data/classes.json (loaded once at import
// time) so the character kit can be tweaked without touching TypeScript.
// This module stays a thin accessor layer — see docs/gameplay-decisions.md
// §1 for the design rationale behind the numbers themselves.
//
// JSON imports lose TS's string-literal-union narrowing (e.g. `target`
// becomes `string`, not `SkillTarget`), so we cast once here after a light
// sanity check, instead of hand-writing a full runtime schema validator.
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
