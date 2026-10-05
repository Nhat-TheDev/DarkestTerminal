import { RARITY_ORDER, tierWeightsByDepth, type ArtifactSource } from "../../../src/data/artifacts";
import type { ArtifactRarity } from "../../../src/types";
import { anchorFloors, floorBand, joinWeights, pickPart } from "../curve";
import { formatRounded } from "../format";
import type { DocTable, DocsData, GeneratorSpec } from "../types";

const SOURCES: { key: ArtifactSource; anchorLabel: string; oddsLabel: string }[] = [
  { key: "elite", anchorLabel: "Elite", oddsLabel: "Elite" },
  { key: "boss", anchorLabel: "Boss", oddsLabel: "Boss" },
  { key: "treasureOrEvent", anchorLabel: "Treasure / Event / Merchant", oddsLabel: "Treasure / Event" },
];

const ABBREVIATION: Record<ArtifactRarity, string> = { common: "C", rare: "R", unique: "U", epic: "E" };
const legend = RARITY_ORDER.map((rarity) => ABBREVIATION[rarity]).join(" / ");

function anchorsTable({ balance }: DocsData): DocTable {
  const { artifacts } = balance;
  const [from, to] = anchorFloors(artifacts);
  return {
    columns: ["Source", `Anchor at floors ${from}–${to} (${legend})`],
    rows: SOURCES.map(({ key, anchorLabel }) => [anchorLabel, joinWeights(RARITY_ORDER, artifacts.anchorWeights[key])]),
  };
}

function oddsTable({ balance }: DocsData, bands: readonly number[]): DocTable {
  const { artifacts } = balance;
  return {
    columns: ["Floors", ...SOURCES.map(({ oddsLabel }) => oddsLabel)],
    rows: bands.map((from) => [
      floorBand(from, artifacts.floorsPerStep),
      ...SOURCES.map(({ key }) => joinWeights(RARITY_ORDER, tierWeightsByDepth(RARITY_ORDER, artifacts.anchorWeights[key], from, artifacts), formatRounded)),
    ]),
  };
}

/** Odds of each artifact rarity by floor depth. `part=anchors` is the anchor table, `part=odds` the odds per band of floors. */
export const rarityOdds: GeneratorSpec = {
  source: "`data/balance-config.json` (`artifacts`)",
  args: ["part", "bands"],
  generate: (data, args) => pickPart(args, { anchors: () => anchorsTable(data), odds: (bands) => oddsTable(data, bands) }),
};
