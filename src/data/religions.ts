import type { BoonStat, Character, Id, Religion } from "../types";
import religionsJson from "../../data/religions.json";
import { CLASSES, getClass } from "./classes";

const FILE = "data/religions.json";
const BOON_STATS: readonly BoonStat[] = ["offense", "defense", "speed"];

export function validateReligions(religions: Religion[], classes: { id: Id; religionId: Id }[]): void {
  const ids = new Set<Id>();
  for (const r of religions) {
    if (!r.id || ids.has(r.id)) throw new Error(`${FILE}: "${r.id}" is missing or appears twice`);
    ids.add(r.id);
    if (!r.name) throw new Error(`${FILE}: "${r.id}" needs a "name"`);
    if (!r.templeDescription) throw new Error(`${FILE}: "${r.id}" needs a "templeDescription"`);
    if (!/^#[0-9a-f]{6}$/i.test(r.style?.color ?? "") || !r.style.abbr) throw new Error(`${FILE}: "${r.id}" needs a "style" with an "abbr" and a "#rrggbb" "color"`);
    const emphasis = r.boon?.emphasis;
    if (emphasis !== null && !BOON_STATS.includes(emphasis as BoonStat)) {
      throw new Error(`${FILE}: "${r.id}" needs a boon "emphasis" of ${BOON_STATS.join(", ")} or null`);
    }
    if (typeof r.boon.recoversHpMp !== "boolean") throw new Error(`${FILE}: "${r.id}" needs a boolean boon "recoversHpMp"`);
  }
  for (const cls of classes) {
    if (!ids.has(cls.religionId)) throw new Error(`data/classes.json: class "${cls.id}" names an unknown religion "${cls.religionId}"`);
  }
}

export const RELIGIONS = religionsJson as unknown as Religion[];
validateReligions(RELIGIONS, CLASSES);

export function getReligion(id: Id): Religion {
  const religion = RELIGIONS.find((r) => r.id === id);
  if (!religion) throw new Error(`Unknown religion: ${id}`);
  return religion;
}

export function religionOf(character: { classId: Id }): Religion {
  return getReligion(getClass(character.classId).religionId);
}

/** Living party members per religion; a religion nobody living follows has no entry. */
export function livingReligionCounts(party: Character[]): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const c of party) {
    if (!c.isAlive) continue;
    const id = religionOf(c).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
