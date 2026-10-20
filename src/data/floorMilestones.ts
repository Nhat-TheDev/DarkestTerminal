import type { Id } from "../types";
import type { Rng } from "../engine/rng";
import floorMilestonesJson from "../../data/floor-milestones.json";

export interface FloorMilestoneOmen {
  id: Id;
  /** If not shown before this milestone floor, it is shown there. */
  maxFloor: number;
  text: string;
}

export interface FloorMilestoneData {
  interval: number;
  omens: FloorMilestoneOmen[];
}

const FILE = "data/floor-milestones.json";

/** One omen shows per milestone floor, so no `maxFloor` may have more omens due by it than milestone floors up to it. */
export function validateFloorMilestones(data: FloorMilestoneData): void {
  if (!Number.isInteger(data.interval) || data.interval < 1) throw new Error(`${FILE}: "interval" must be a whole number of at least 1`);
  if (!Array.isArray(data.omens) || data.omens.length === 0) throw new Error(`${FILE}: needs at least one omen`);
  const ids = new Set<Id>();
  for (const omen of data.omens) {
    if (ids.has(omen.id)) throw new Error(`${FILE}: "${omen.id}" appears twice`);
    ids.add(omen.id);
    if (typeof omen.text !== "string" || omen.text.trim() === "") throw new Error(`${FILE}: "${omen.id}" has no text`);
    if (!Number.isInteger(omen.maxFloor) || omen.maxFloor < data.interval || omen.maxFloor % data.interval !== 0) {
      throw new Error(`${FILE}: "${omen.id}" needs a "maxFloor" that is a multiple of ${data.interval}`);
    }
  }
  for (const omen of data.omens) {
    const due = data.omens.filter((o) => o.maxFloor <= omen.maxFloor).length;
    const milestones = omen.maxFloor / data.interval;
    if (due > milestones) throw new Error(`${FILE}: ${due} omens are due by floor ${omen.maxFloor}, which has only ${milestones} milestone floors`);
  }
}

const DATA = floorMilestonesJson as unknown as FloorMilestoneData;
validateFloorMilestones(DATA);

export const FLOOR_MILESTONE_INTERVAL = DATA.interval;
export const FLOOR_MILESTONE_OMENS = DATA.omens;

/** Undefined when a saved id has since been removed from the data file. */
export function getFloorMilestoneOmen(id: Id): FloorMilestoneOmen | undefined {
  return FLOOR_MILESTONE_OMENS.find((o) => o.id === id);
}

/**
 * Picks within the lowest unshown `maxFloor` band, so an omen still unshown at its own `maxFloor` always comes up there.
 * Past the last `maxFloor`, any omen but the last shown may repeat.
 */
export function pickFloorMilestoneOmen(depth: number, shownIds: readonly Id[], rng: Rng): FloorMilestoneOmen {
  const candidates = FLOOR_MILESTONE_OMENS.filter((o) => o.maxFloor >= depth && !shownIds.includes(o.id));
  if (candidates.length > 0) {
    const band = Math.min(...candidates.map((o) => o.maxFloor));
    return rng.pick(candidates.filter((o) => o.maxFloor === band));
  }
  const pool = FLOOR_MILESTONE_OMENS.filter((o) => o.id !== shownIds[shownIds.length - 1]);
  return rng.pick(pool.length > 0 ? pool : [...FLOOR_MILESTONE_OMENS]);
}
