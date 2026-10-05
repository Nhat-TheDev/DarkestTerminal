import { formatNumber } from "./format";
import type { DocTable } from "./types";

/** The floors of the step that holds `anchorFirstFloor`, grouped the way `tierWeightsByDepth` groups them. */
export function anchorFloors({ anchorFirstFloor, floorsPerStep }: { anchorFirstFloor: number; floorsPerStep: number }): [number, number] {
  const first = Math.floor((anchorFirstFloor - 1) / floorsPerStep) * floorsPerStep + 1;
  return [first, first + floorsPerStep - 1];
}

/** The `bands=1,21,41` argument of an odds table: the first floor of each row. */
export function parseBands(raw: string | undefined): number[] {
  const bands = (raw ?? "").split(",").map((part) => Number(part.trim()));
  if (!raw || bands.some((floor) => !Number.isInteger(floor) || floor < 1)) {
    throw new Error('"bands" must list the first floor of each row, such as bands=1,21');
  }
  return bands;
}

/** Weights as `a / b / c`, in the order of `tiers`; a tier with no weight counts as 0. */
export function joinWeights<Tier extends string>(tiers: readonly Tier[], weights: Partial<Record<Tier, number>>, format: (weight: number) => string = formatNumber): string {
  return tiers.map((tier) => format(weights[tier] ?? 0)).join(" / ");
}

/** The floors one row of an odds table covers, such as `21–40`. */
export const floorBand = (from: number, floorsPerStep: number) => `${from}–${from + floorsPerStep - 1}`;

/** The table an odds generator's `part` argument asks for: the anchors, or the odds per band of floors. */
export function pickPart(args: Record<string, string>, tables: { anchors: () => DocTable; odds: (bands: number[]) => DocTable }): DocTable {
  if (args.part === "anchors") return tables.anchors();
  if (args.part === "odds") return tables.odds(parseBands(args.bands));
  throw new Error('"part" must be "anchors" or "odds"');
}
