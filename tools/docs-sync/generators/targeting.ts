import { TARGETING_FACTORS } from "../../../src/data/balanceConfig";
import { formatNumber } from "../format";
import type { GeneratorSpec } from "../types";

/** Each `aiPattern`'s factor weights and the archetypes that use it. */
export const targetingProfiles: GeneratorSpec = {
  source: "`data/balance-config.json` (`targeting.profiles`) and `data/monsters.json`",
  args: [],
  generate: ({ balance, monsters }) => ({
    columns: ["Pattern", ...TARGETING_FACTORS, "Archetypes"],
    rows: Object.entries(balance.targeting.profiles).map(([pattern, weights]) => {
      const users = monsters.archetypes.filter((archetype) => archetype.aiPattern === pattern).map((archetype) => archetype.name);
      return [`\`${pattern}\``, ...TARGETING_FACTORS.map((factor) => formatNumber(weights[factor])), users.length === 0 ? "—" : users.join(", ")];
    }),
  }),
};

/** The score each rank earns under the `lowHp`, `fear` and `damage` factors. */
export const targetingRankScores: GeneratorSpec = {
  source: "`data/balance-config.json` (`targeting.lowHpRankScores`, `targeting.fearRankScores`, `targeting.damageRankScores`)",
  args: [],
  generate: ({ balance }) => {
    const { lowHpRankScores, fearRankScores, damageRankScores } = balance.targeting;
    const ranks = Math.max(lowHpRankScores.length, fearRankScores.length, damageRankScores.length);
    const at = (scores: number[], i: number) => formatNumber(scores[Math.min(i, scores.length - 1)]!);
    return {
      columns: ["Rank", "lowHp (lowest HP share first)", "fear (highest fear first)", "damage (most HP taken off first)"],
      rows: Array.from({ length: ranks }, (_, i) => [i === ranks - 1 ? `${i + 1} and below` : `${i + 1}`, at(lowHpRankScores, i), at(fearRankScores, i), at(damageRankScores, i)]),
    };
  },
};
