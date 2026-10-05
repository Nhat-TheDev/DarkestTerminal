import { characterBalancePoints } from "../../game-editor/calc";
import { formatNumber, formatRounded } from "../format";
import type { GeneratorSpec } from "../types";

/** The base stats every class starts with at level 1. */
export const classStats: GeneratorSpec = {
  source: "`data/classes.json`",
  args: [],
  generate: ({ classes }) => ({
    columns: ["Class", "Max HP", "Max MP", "Attack", "Defense", "Magic power", "Aggro", "Speed"],
    rows: classes.map((found) =>
      [found.name, ...[found.baseMaxHp, found.baseMaxMp, found.baseAttack, found.baseDefense, found.baseMagicPower, found.baseAggro, found.baseSpeed].map(formatNumber)],
    ),
  }),
};

/** Each class's Balance Points (the game editor's formula) against the roster average. */
export const balancePoints: GeneratorSpec = {
  source: "`data/classes.json` and `data/level-growth.json`, scored by `tools/game-editor/calc.ts`",
  args: [],
  generate: ({ classes }) => {
    const scores = classes.map((found) =>
      characterBalancePoints({ attack: found.baseAttack, defense: found.baseDefense, maxHp: found.baseMaxHp, maxMp: found.baseMaxMp, magicPower: found.baseMagicPower, speed: found.baseSpeed }),
    );
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const against = (score: number) => `${score >= average ? "+" : "−"}${formatRounded(Math.abs(((score - average) / average) * 100))}%`;
    return {
      columns: ["Class", "Balance points", "Against the roster average"],
      rows: [...classes.map((found, index) => [found.name, formatRounded(scores[index]!), against(scores[index]!)]), ["Roster average", formatRounded(average), "—"]],
    };
  },
};
