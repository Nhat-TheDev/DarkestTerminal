import type { Id, ReflectionAnswer } from "../types";
import campReflectionsJson from "../../data/camp-reflections.json";
import { assertConditionValid, EVENTS } from "./events";
import { catalogRuleErrors } from "./reflectionCatalog";
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

export function highestAnsweredCampReflectionTier(choices: Partial<Record<CampReflectionTier, number>>): CampReflectionTier | 0 {
  const keys = Object.keys(choices).map(Number) as CampReflectionTier[];
  return keys.length > 0 ? (Math.max(...keys) as CampReflectionTier) : 0;
}

interface CampTierData {
  prompt: string;
  options: ReflectionAnswer[];
}

/** Every answer of a tier, the conditional ones included; `shownOptions` picks the ones a party sees. */
export const CAMP_REFLECTIONS: Record<CampReflectionTier, { prompt: string; options: ReflectionAnswer[] }> = Object.fromEntries(
  Object.entries(campReflectionsJson as unknown as Record<string, CampTierData>).map(([tier, data]) => [
    tier,
    { prompt: t(data.prompt), options: data.options.map((o) => ({ ...o, text: t(o.text) })) },
  ])
) as Record<CampReflectionTier, { prompt: string; options: ReflectionAnswer[] }>;

for (const tier of [1, 2, 3, 4] as const) {
  const content = CAMP_REFLECTIONS[tier];
  if (!content) throw new Error(`data/camp-reflections.json: tier ${tier} is missing`);
  for (const option of content.options) {
    for (const c of [...(option.requires ?? []), ...option.outcomes.flatMap((o) => o.when ?? [])]) assertConditionValid(`data/camp-reflections.json: tier ${tier} condition`, c);
  }
  const errors = catalogRuleErrors(content.options);
  if (errors.length > 0) throw new Error(`data/camp-reflections.json: tier ${tier} breaks the catalog rules: ${errors.join("; ")}`);
}

export function campReflectionContent(tier: CampReflectionTier): { prompt: string; options: ReflectionAnswer[] } {
  return CAMP_REFLECTIONS[tier];
}
