import { formatRange } from "../format";
import type { GeneratorSpec } from "../types";

const GROUPS = [
  { key: "weak", label: '`powerTier: "weak"`' },
  { key: "medium", label: '`powerTier: "medium"`' },
  { key: "strong", label: '`powerTier: "strong"`' },
  { key: "elite", label: "Elite" },
  { key: "boss", label: "Boss" },
] as const;

/** The coins one kill drops, by the monster's group. */
export const coinDropByTier: GeneratorSpec = {
  source: "`data/balance-config.json` (`currency.coinDropByTier`)",
  args: [],
  generate: ({ balance }) => ({
    columns: ["Monster group", "Coin drop (per kill)"],
    rows: GROUPS.map(({ key, label }) => [label, formatRange(...balance.currency.coinDropByTier[key])]),
  }),
};
