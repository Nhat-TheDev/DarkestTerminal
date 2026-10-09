import type { Id } from "../types";
import { EVENTS } from "./events";
import { BALANCE } from "./balanceConfig";
import { t } from "./strings";

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

/** Camp Reflection's text for `tier` — a prompt and 3 self-narratives, in `data/strings.json` under
    `ui.campReflectionTier<N>Prompt` / `ui.campReflectionTier<N>Option<1-3>` (03-survival-stats.md).
    Tier 0 (Untouched) has no content, same principle as Open Chest/Collapsed Floor having no §8.16 reflection. */
export function campReflectionContent(tier: CampReflectionTier): { prompt: string; options: [string, string, string] } {
  return {
    prompt: t(`ui.campReflectionTier${tier}Prompt`),
    options: [t(`ui.campReflectionTier${tier}Option1`), t(`ui.campReflectionTier${tier}Option2`), t(`ui.campReflectionTier${tier}Option3`)],
  };
}
