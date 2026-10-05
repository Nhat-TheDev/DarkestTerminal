import { tierWeightsByDepth } from "../../../src/data/artifacts";
import { CONSUMABLE_TIERS, TROPHY_TIERS } from "../../../src/data/shopStock";
import type { ItemTier } from "../../../src/types";
import { anchorFloors, floorBand, joinWeights, pickPart } from "../curve";
import { capitalize, formatRounded } from "../format";
import type { DocTable, DocsData, GeneratorSpec } from "../types";

const KINDS = [
  { key: "consumable", label: "Consumable", tiers: CONSUMABLE_TIERS },
  { key: "trophy", label: "Trophy", tiers: TROPHY_TIERS },
] as const;

const ABBREVIATION: Record<ItemTier, string> = { common: "C", uncommon: "U", rare: "R", unique: "Un", epic: "E", legendary: "L" };

const legend = (tiers: readonly ItemTier[]) => tiers.map((tier) => ABBREVIATION[tier]).join(" / ");

function anchorsTable({ balance }: DocsData): DocTable {
  const { shop } = balance;
  const [from, to] = anchorFloors(shop);
  const widest = KINDS.reduce<readonly ItemTier[]>((best, kind) => (kind.tiers.length > best.length ? kind.tiers : best), []);
  return {
    columns: ["Offer kind", "Tiers rolled", `Anchor at floors ${from}–${to} (${legend(widest)})`],
    rows: KINDS.map(({ key, label, tiers }) => [
      label,
      `${capitalize(tiers[0]!)} to ${capitalize(tiers[tiers.length - 1]!)}`,
      joinWeights(tiers, shop.anchorWeights[key]),
    ]),
  };
}

function oddsTable({ balance }: DocsData, bands: readonly number[]): DocTable {
  const { shop } = balance;
  return {
    columns: ["Floors", ...KINDS.map(({ label, tiers }) => `${label} ${legend(tiers)}`)],
    rows: bands.map((from) => [
      floorBand(from, shop.floorsPerStep),
      ...KINDS.map(({ key, tiers }) => {
        return joinWeights(tiers, tierWeightsByDepth(tiers, shop.anchorWeights[key], from, shop), formatRounded);
      }),
    ]),
  };
}

/** Odds of each shop tier by floor depth. `part=anchors` is the anchor table, `part=odds` the odds per band of floors. */
export const shopOdds: GeneratorSpec = {
  source: "`data/balance-config.json` (`shop`)",
  args: ["part", "bands"],
  generate: (data, args) => pickPart(args, { anchors: () => anchorsTable(data), odds: (bands) => oddsTable(data, bands) }),
};
