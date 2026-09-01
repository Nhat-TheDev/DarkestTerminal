import type { RoomType } from "../types";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";

export interface RoomToken {
  stage: number;
  roomId: number;
  tag: string;
}

export function roomTypeForTag(tag: string): RoomType {
  switch (tag) {
    case "":
      return "combat";
    case "free":
      return "rest";
    case "boss":
      return "boss";
    case "event":
      return "event";
    default:
      throw new Error(`Unknown room tag "[${tag}]"`);
  }
}

export const MIN_PATH_ROOMS = BALANCE.floorGeneration.minPathRooms;
export const MAX_PATH_ROOMS = BALANCE.floorGeneration.maxPathRooms;
export const MAX_BRANCHES = BALANCE.floorGeneration.maxBranches;
export const MIN_BRANCH_START_STAGE = BALANCE.floorGeneration.minBranchStartStage;
export const MIN_BRANCH_SPACING = BALANCE.floorGeneration.minBranchSpacing;
export const MAX_EVENT_ROOMS_PER_PATH = BALANCE.floorGeneration.maxEventRoomsPerPath;
export const MIN_REST_ROOMS_PER_PATH = BALANCE.floorGeneration.minRestRoomsPerPath;
export const MAX_REST_ROOMS_PER_PATH = BALANCE.floorGeneration.maxRestRoomsPerPath;

function randomPartition(total: number, parts: number, rng: Rng): number[] {
  const bins: number[] = [];
  let remaining = total;
  for (let i = 0; i < parts; i++) {
    const bin = i === parts - 1 ? remaining : rng.int(0, remaining);
    bins.push(bin);
    remaining -= bin;
  }
  return bins;
}

function pickBranchStages(rng: Rng, minStage: number, maxStage: number): number[] {
  const span = maxStage - minStage;
  if (span < 0) return [];
  const feasibleMax = Math.floor(span / MIN_BRANCH_SPACING) + 1;
  const target = rng.int(0, Math.min(MAX_BRANCHES, feasibleMax));
  if (target === 0) return [];

  const minSpan = (target - 1) * MIN_BRANCH_SPACING;
  const slack = span - minSpan;
  const gaps = randomPartition(slack, target + 1, rng);

  const stages: number[] = [];
  let pos = minStage + gaps[0]!;
  stages.push(pos);
  for (let i = 1; i < target; i++) {
    pos = pos + MIN_BRANCH_SPACING + gaps[i]!;
    stages.push(pos);
  }
  return stages;
}

function pickRestStages(rng: Rng, candidates: number[]): number[] {
  const count = rng.int(MIN_REST_ROOMS_PER_PATH, Math.min(MAX_REST_ROOMS_PER_PATH, candidates.length));
  const pool = [...candidates];
  const picked: number[] = [];
  for (let i = 0; i < count; i++) {
    const idx = rng.int(0, pool.length - 1);
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked;
}

export function generateFloorLayout(rng: Rng): RoomToken[][] {
  const pathLength = rng.int(MIN_PATH_ROOMS, MAX_PATH_ROOMS);
  const lastStage = pathLength - 1;

  const branchStages = pickBranchStages(rng, MIN_BRANCH_START_STAGE, lastStage - 1);
  const branchSet = new Set(branchStages);

  const restCandidates: number[] = [];
  for (let s = 1; s < lastStage; s++) {
    if (!branchSet.has(s)) restCandidates.push(s);
  }
  const restStages = new Set(pickRestStages(rng, restCandidates));

  let nextRoomId = 1;
  const stages: RoomToken[][] = [];
  for (let s = 0; s < pathLength; s++) {
    if (s === lastStage) {
      stages.push([{ stage: s, roomId: nextRoomId++, tag: "boss" }]);
    } else if (branchSet.has(s)) {
      stages.push([
        { stage: s, roomId: nextRoomId++, tag: "" },
        { stage: s, roomId: nextRoomId++, tag: "event" },
      ]);
    } else if (restStages.has(s)) {
      stages.push([{ stage: s, roomId: nextRoomId++, tag: "free" }]);
    } else {
      stages.push([{ stage: s, roomId: nextRoomId++, tag: "" }]);
    }
  }

  return stages;
}

export interface PathRoomBounds {
  event: { min: number; max: number };
  rest: { min: number; max: number };
}

function pathRoomBounds(stages: RoomToken[][]): PathRoomBounds {
  const bounds: PathRoomBounds = { event: { min: 0, max: 0 }, rest: { min: 0, max: 0 } };
  for (const stage of stages) {
    const types = stage.map((r) => roomTypeForTag(r.tag));
    for (const key of ["event", "rest"] as const) {
      if (types.every((t) => t === key)) bounds[key].min += 1;
      if (types.some((t) => t === key)) bounds[key].max += 1;
    }
  }
  return bounds;
}

export function validateGeneratedStages(stages: RoomToken[][]): void {
  if (stages.length < MIN_PATH_ROOMS || stages.length > MAX_PATH_ROOMS) {
    throw new Error(`layout has ${stages.length} stages, expected ${MIN_PATH_ROOMS}-${MAX_PATH_ROOMS}`);
  }
  if (stages[0]!.length !== 1 || stages[0]![0]!.tag !== "") {
    throw new Error("stage 0 (start) must be exactly 1 combat room");
  }
  const last = stages[stages.length - 1]!;
  if (last.length !== 1 || last[0]!.tag !== "boss") {
    throw new Error("final stage must be exactly 1 boss room");
  }

  const branchStageIndices: number[] = [];
  for (let s = 0; s < stages.length; s++) {
    const stage = stages[s]!;
    if (stage.length > 1) {
      branchStageIndices.push(s);
      if (s < MIN_BRANCH_START_STAGE) throw new Error(`branch stage ${s} is before allowed start stage ${MIN_BRANCH_START_STAGE}`);
      const tags = stage.map((r) => r.tag).sort();
      if (stage.length !== 2 || tags[0] !== "" || tags[1] !== "event") {
        throw new Error(`branch stage ${s} must have exactly 1 combat + 1 event room`);
      }
    }
  }
  if (branchStageIndices.length > MAX_BRANCHES) throw new Error(`layout has ${branchStageIndices.length} branch stages, max allowed is ${MAX_BRANCHES}`);
  for (let i = 1; i < branchStageIndices.length; i++) {
    const gap = branchStageIndices[i]! - branchStageIndices[i - 1]!;
    if (gap < MIN_BRANCH_SPACING) throw new Error(`branch stages ${branchStageIndices[i - 1]} and ${branchStageIndices[i]} are only ${gap} apart, need >= ${MIN_BRANCH_SPACING}`);
  }

  const allIds = stages.flat().map((r) => r.roomId);
  if (new Set(allIds).size !== allIds.length) throw new Error("room ids must be unique within the layout");

  const bounds = pathRoomBounds(stages);
  if (bounds.event.max > MAX_EVENT_ROOMS_PER_PATH) {
    throw new Error(`every path may pass through at most ${MAX_EVENT_ROOMS_PER_PATH} event rooms, this layout allows up to ${bounds.event.max}`);
  }
  if (bounds.rest.min < MIN_REST_ROOMS_PER_PATH || bounds.rest.max > MAX_REST_ROOMS_PER_PATH) {
    throw new Error(`every path must pass through ${MIN_REST_ROOMS_PER_PATH}-${MAX_REST_ROOMS_PER_PATH} rest rooms, this layout allows between ${bounds.rest.min} and ${bounds.rest.max}`);
  }
}
