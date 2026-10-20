import { formatNumber } from "./format";
import type { DocTable } from "./types";

/** Groups floors the way `tierWeightsByDepth` does. */
export function anchorFloors({ anchorFirstFloor, floorsPerStep }: { anchorFirstFloor: number; floorsPerStep: number }): [number, number] {
  const first = Math.floor((anchorFirstFloor - 1) / floorsPerStep) * floorsPerStep + 1;
  return [first, first + floorsPerStep - 1];
}

/** `bands=1,21,41`: the first floor of each row. */
export function parseBands(raw: string | undefined): number[] {
  const bands = (raw ?? "").split(",").map((part) => Number(part.trim()));
  if (!raw || bands.some((floor) => !Number.isInteger(floor) || floor < 1)) {
    throw new Error('"bands" must list the first floor of each row, such as bands=1,21');
  }
  return bands;
}

export function joinWeights<Tier extends string>(tiers: readonly Tier[], weights: Partial<Record<Tier, number>>, format: (weight: number) => string = formatNumber): string {
  return tiers.map((tier) => format(weights[tier] ?? 0)).join(" / ");
}

export const floorBand = (from: number, floorsPerStep: number) => `${from}–${from + floorsPerStep - 1}`;

export function pickPart(args: Record<string, string>, tables: { anchors: () => DocTable; odds: (bands: number[]) => DocTable }): DocTable {
  if (args.part === "anchors") return tables.anchors();
  if (args.part === "odds") return tables.odds(parseBands(args.bands));
  throw new Error('"part" must be "anchors" or "odds"');
}
