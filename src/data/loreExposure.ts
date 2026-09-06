import type { Id } from "../types";
import { EVENTS } from "./events";
import { BALANCE } from "./balanceConfig";

/** 03-survival-stats.md's Camp Reflection — every event id except open-chest, the 1 event
    explicitly "Outside the Balance" (11-world-bible.md §11.12). Computed from the live event
    catalog rather than hardcoded, so a newly added event id is in scope automatically. */
export const LORE_EXPOSURE_EVENT_IDS: ReadonlySet<Id> = new Set(EVENTS.map((e) => e.id).filter((id) => id !== "open-chest"));

export type CampReflectionTier = 1 | 2 | 3 | 4;

/** Skip-to-highest, not sequential: computed fresh from `loreExposureCount` each time, never
    stored — a run that jumps straight from tier 0 to tier 3 between 2 rest visits never shows
    tiers 1-2's content. */
export function campReflectionTier(loreExposureCount: number): CampReflectionTier | null {
  if (loreExposureCount >= BALANCE.survival.campReflectionTier4Threshold) return 4;
  if (loreExposureCount >= BALANCE.survival.campReflectionTier3Threshold) return 3;
  if (loreExposureCount >= BALANCE.survival.campReflectionTier2Threshold) return 2;
  if (loreExposureCount >= BALANCE.survival.campReflectionTier1Threshold) return 1;
  return null;
}

/** The highest tier already answered this run, or 0 if none yet — used at rest-room entry to
    decide whether a newly reached tier is actually new. */
export function highestAnsweredCampReflectionTier(choices: Partial<Record<CampReflectionTier, 0 | 1 | 2>>): CampReflectionTier | 0 {
  const keys = Object.keys(choices).map(Number) as CampReflectionTier[];
  return keys.length > 0 ? (Math.max(...keys) as CampReflectionTier) : 0;
}

/** Final text for all 4 tiers (03-survival-stats.md). Tier 0 (Untouched) has no content, same
    principle as Open Chest/Collapsed Floor having no §8.16 reflection. */
export const CAMP_REFLECTION_CONTENT: Record<CampReflectionTier, { prompt: string; options: [string, string, string] }> = {
  1: {
    prompt:
      "Someone's checking their supplies again before sleep, same as every night. Tonight it takes slightly less time than it used to. It's just faster now, knowing which pouch to reach for first.",
    options: [
      "It's not worth thinking about. Whatever gets it done fastest is fine.",
      "Someone should be keeping count. Just in case it starts to matter later.",
      "Somewhere back there, reaching for it stopped feeling like deciding to.",
    ],
  },
  2: {
    prompt:
      "The whole day's route got picked around which rooms were worth the detour — not for the treasure, for the trade. Three floors ago that would have sounded insane. Whoever suggested it first, none of you can quite say.",
    options: [
      "It's efficient. That's all that needs to be true about it.",
      "Getting good at something like this isn't the same as it being safe.",
      "You almost admire how naturally it's become part of the plan.",
    ],
  },
  3: {
    prompt:
      "Nobody argued about it this time. Whoever was closest just did it, the way you'd catch a falling cup without thinking, and the rest of you kept eating like nothing happened. Someone almost said something. Didn't.",
    options: [
      "Someone should have said something. Nobody wanted to be the first.",
      "There wasn't anything to say. It's just what the party does now.",
      "You keep waiting for it to feel like a choice again. It hasn't, in a while.",
    ],
  },
  4: {
    prompt:
      "Nobody mentions it anymore, at camp or anywhere else. It isn't that it stopped mattering — it stopped being a separate thing from everything else you do to get through a day. Someone asks what's for dinner. Someone else answers with their mouth full. The rest of it just happened somewhere in between, the way breathing happens.",
    options: ["Nobody outside would follow it anyway.", "Explaining it wouldn't change anything now.", "Nobody's asked in a long time. Nobody will."],
  },
};
