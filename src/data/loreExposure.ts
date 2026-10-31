import type { Id } from "../types";
import { EVENTS } from "./events";
import { BALANCE } from "./balanceConfig";
import { t } from "./strings";

export const LORE_EXPOSURE_EVENT_IDS: ReadonlySet<Id> = new Set(EVENTS.filter((e) => !e.noLoreExposure && e.kind !== "scripted").map((e) => e.id));

export type CampReflectionTier = 1 | 2 | 3 | 4;

export function campReflectionTier(loreExposureCount: number): CampReflectionTier | null {
  if (loreExposureCount >= BALANCE.survival.campReflectionTier4Threshold) return 4;
  if (loreExposureCount >= BALANCE.survival.campReflectionTier3Threshold) return 3;
  if (loreExposureCount >= BALANCE.survival.campReflectionTier2Threshold) return 2;
  if (loreExposureCount >= BALANCE.survival.campReflectionTier1Threshold) return 1;
  return null;
}

export function highestAnsweredCampReflectionTier(choices: Partial<Record<CampReflectionTier, 0 | 1 | 2>>): CampReflectionTier | 0 {
  const keys = Object.keys(choices).map(Number) as CampReflectionTier[];
  return keys.length > 0 ? (Math.max(...keys) as CampReflectionTier) : 0;
}

export function campReflectionContent(tier: CampReflectionTier): { prompt: string; options: [string, string, string] } {
  return {
    prompt: t(`ui.campReflectionTier${tier}Prompt`),
    options: [t(`ui.campReflectionTier${tier}Option1`), t(`ui.campReflectionTier${tier}Option2`), t(`ui.campReflectionTier${tier}Option3`)],
  };
}
