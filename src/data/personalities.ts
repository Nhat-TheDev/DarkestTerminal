import type { Id, Personality, PersonalityCondition } from "../types";
import personalitiesJson from "../../data/personalities.json";
import { CLASSES } from "./classes";

const FILE = "data/personalities.json";

const NUMERIC: Partial<Record<PersonalityCondition["kind"], "value" | "fraction">> = {
  ownFearAtLeast: "value",
  allyFearAtLeast: "value",
  coinsAtLeast: "value",
  satietyBelow: "value",
  depthAtLeast: "value",
  ownHpBelow: "fraction",
  allyHpBelow: "fraction",
};
const KINDS: readonly PersonalityCondition["kind"][] = [
  "ownFearAtLeast",
  "allyFearAtLeast",
  "ownHpBelow",
  "allyHpBelow",
  "partyMemberDied",
  "lowestFearAndFullHp",
  "highestFear",
  "coinsAtLeast",
  "satietyBelow",
  "depthAtLeast",
  "mostArtifacts",
  "wearsCursedArtifact",
];

export function validatePersonalities(personalities: Personality[]): void {
  const ids = new Set<Id>();
  for (const p of personalities) {
    if (!p.id || ids.has(p.id)) throw new Error(`${FILE}: "${p.id}" is missing or appears twice`);
    ids.add(p.id);
    if (!p.badWhen || (p.badWhen.match !== "all" && p.badWhen.match !== "any") || !Array.isArray(p.badWhen.when) || p.badWhen.when.length === 0) {
      throw new Error(`${FILE}: "${p.id}" needs a "badWhen" with "match" and at least one condition`);
    }
    for (const c of p.badWhen.when) {
      if (!KINDS.includes(c.kind)) throw new Error(`${FILE}: "${p.id}" has an unknown condition "${c.kind}"`);
      const field = NUMERIC[c.kind];
      if (field && typeof (c as Record<string, unknown>)[field] !== "number") throw new Error(`${FILE}: "${p.id}"'s "${c.kind}" needs a number "${field}"`);
    }
  }
  for (const cls of CLASSES) {
    if (!ids.has(cls.personalityId)) throw new Error(`data/classes.json: class "${cls.id}" names an unknown personality "${cls.personalityId}"`);
  }
}

export const PERSONALITIES = personalitiesJson as unknown as Personality[];
validatePersonalities(PERSONALITIES);

export function getPersonality(id: Id): Personality {
  const p = PERSONALITIES.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown personality: ${id}`);
  return p;
}
