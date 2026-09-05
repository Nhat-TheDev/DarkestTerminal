import type { GrowthWeightsData } from "../types";
import growthWeightsJson from "../../data/growth-weights.json";
import classesJson from "../../data/classes.json";

export const GROWTH_WEIGHTS = growthWeightsJson as unknown as GrowthWeightsData;

for (const cls of classesJson as { id: string }[]) {
  if (!GROWTH_WEIGHTS.classGrowthWeights[cls.id]) {
    throw new Error(`data/growth-weights.json: missing classGrowthWeights for class "${cls.id}"`);
  }
}
