import type { Id } from "../types";
import type { Rng } from "../engine/rng";
import floorMilestonesJson from "../../data/floor-milestones.json";

/** One atmospheric line shown after clearing a milestone floor's boss/guard room. */
export interface FloorMilestoneOmen {
  id: Id;
  /** The last milestone floor this omen can wait for: if it has not been shown by then, it is shown there. */
  maxFloor: number;
  text: string;
}

export interface FloorMilestoneData {
  /** A milestone is every floor whose depth is a multiple of this. */
  interval: number;
  omens: FloorMilestoneOmen[];
}

const FILE = "data/floor-milestones.json";

/** Throws unless every omen can be shown by its `maxFloor`: only one omen is shown per milestone floor, so no `maxFloor` may have more omens due by it than milestone floors up to it. */
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

/** The omen with this id, or undefined once an id saved in a run has been removed from the data file. */
export function getFloorMilestoneOmen(id: Id): FloorMilestoneOmen | undefined {
  return FLOOR_MILESTONE_OMENS.find((o) => o.id === id);
}

/**
 * The omen for the milestone at `depth`. Omens not yet shown this run and not past their `maxFloor`
 * are the candidates; the lowest `maxFloor` among them is the current depth band, and one omen in that
 * band is picked at random. An omen still unshown at its own `maxFloor` is therefore the only one left
 * in its band and always comes up there. With no candidates left (past the last `maxFloor`), any omen
 * but the one shown last is picked, so repeats happen only then.
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
