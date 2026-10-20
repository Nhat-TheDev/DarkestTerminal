import { capitalize, formatNumber } from "../format";
import type { GeneratorSpec } from "../types";

export const eventTiers: GeneratorSpec = {
  source: "`data/events.json` and `data/balance-config.json` (`events`)",
  args: [],
  generate: ({ balance, events }) => {
    const weight = { common: balance.events.commonTierWeight, rare: balance.events.rareTierWeight } as const;
    return {
      columns: ["Tier", "Total weight", "Includes"],
      rows: (["common", "rare"] as const).map((tier) => [
        capitalize(tier),
        formatNumber(weight[tier]),
        events
          .filter((event) => event.tier === tier && event.kind !== "scripted")
          .map((event) => {
            const gates = [event.minFloorDepth === undefined ? "" : `from floor ${formatNumber(event.minFloorDepth)}`, event.onceLifetime ? "once per run" : ""].filter(Boolean);
            return `\`${event.id}\`${gates.length === 0 ? "" : ` (${gates.join(", ")})`}`;
          })
          .join(", "),
      ]),
    };
  },
};
