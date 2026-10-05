import { joinRanks } from "../effects";
import { showValue } from "../format";
import type { GeneratorSpec } from "../types";

/** Each class's passive: when each rank unlocks, and every parameter it carries at each rank. */
export const passives: GeneratorSpec = {
  source: "`data/classes.json`",
  args: [],
  generate: ({ classes }) => ({
    columns: ["Class", "Passive", "Unlock level (R1/R2/R3)", "Parameters (R1/R2/R3)"],
    rows: classes.map((found) => {
      const ranks = found.passiveSkill.ranks as unknown as Record<string, unknown>[];
      const keys = [...new Set(ranks.flatMap((rank) => Object.keys(rank)))].filter((key) => key !== "rank" && key !== "unlockLevel");
      const parameters = keys.map((key) => `${key} ${joinRanks(ranks.map((rank) => (rank[key] === undefined ? "—" : showValue(rank[key]))))}`);
      return [found.name, found.passiveSkill.name, joinRanks(ranks.map((rank) => showValue(rank.unlockLevel))), parameters.join(", ")];
    }),
  }),
};
