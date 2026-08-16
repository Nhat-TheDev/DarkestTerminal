import type { RoomType } from "../types";
import floorPatternsJson from "../../data/floor-patterns.json";

// Floor layouts are now data (../../data/floor-patterns.json), randomly
// picked per floor instead of hand-authored or spanning-tree-generated —
// see docs/technical-decisions.md §1 for the design rationale.
//
// Notation: "stage.roomId[tag]" tokens, comma-separated within a stage,
// stages dash-separated. Every room in stage N connects forward to every
// room in stage N+1 only (no other edges) — this is what guarantees "no
// dead ends, every branch reaches the boss" by construction, without having
// to encode explicit edges per room.

export interface FloorPatternDef {
  id: string;
  description: string;
  layout: string;
}

interface FloorPatternsFile {
  patterns: FloorPatternDef[];
}

export const FLOOR_PATTERNS: FloorPatternDef[] = (floorPatternsJson as unknown as FloorPatternsFile).patterns;

if (FLOOR_PATTERNS.length === 0) throw new Error("data/floor-patterns.json: no patterns defined");

export interface RoomToken {
  stage: number;
  roomId: number;
  tag: string;
}

const ROOM_TOKEN_RE = /^(\d+)\.(\d+)\[(\w*)\]$/;

/** Parses a `layout` string into stages of room tokens. Throws on malformed syntax. */
export function parsePatternLayout(layout: string): RoomToken[][] {
  return layout.split("-").map((stageGroup, stageIdx) => {
    const tokens = stageGroup.split(",").map((raw) => {
      const match = ROOM_TOKEN_RE.exec(raw.trim());
      if (!match) throw new Error(`Malformed room token "${raw}" in pattern "${layout}"`);
      const [, stageStr, idStr, tag] = match as unknown as [string, string, string, string];
      const stage = Number(stageStr);
      if (stage !== stageIdx) {
        throw new Error(`Room "${raw}" declares stage ${stage} but sits in stage-group #${stageIdx} of pattern "${layout}"`);
      }
      return { stage, roomId: Number(idStr), tag };
    });
    return tokens;
  });
}

export function roomTypeForTag(tag: string): RoomType {
  switch (tag) {
    case "":
      return "combat";
    case "free":
      return "rest";
    case "boss":
      return "boss";
    case "treasure":
      return "treasure";
    case "empty":
      return "empty";
    default:
      throw new Error(`Unknown room tag "[${tag}]"`);
  }
}

/**
 * Structural rules (docs/technical-decisions.md §1):
 * - single entry room (stage 0 has exactly 1 room)
 * - single boss room, and it's the only room of the final stage
 * - at most 2 "branch" stages (a stage with more than 1 room)
 * - every roomId is unique within the pattern
 * Throws with a description of the first violation found.
 */
export function validatePattern(def: FloorPatternDef): RoomToken[][] {
  const stages = parsePatternLayout(def.layout);
  const label = `pattern "${def.id}"`;

  if (stages.length < 2) throw new Error(`${label}: needs at least an entry stage and a boss stage`);
  if (stages[0]!.length !== 1) throw new Error(`${label}: stage 0 (entry) must have exactly 1 room`);

  const lastStage = stages[stages.length - 1]!;
  if (lastStage.length !== 1 || lastStage[0]!.tag !== "boss") {
    throw new Error(`${label}: the final stage must be exactly 1 room tagged [boss]`);
  }
  for (const stage of stages.slice(0, -1)) {
    for (const room of stage) {
      if (room.tag === "boss") throw new Error(`${label}: [boss] may only appear in the final stage (room ${room.stage}.${room.roomId})`);
    }
  }

  const branchStages = stages.filter((s) => s.length > 1).length;
  if (branchStages > 2) throw new Error(`${label}: has ${branchStages} branch stages, max allowed is 2`);

  const allIds = stages.flat().map((r) => r.roomId);
  if (new Set(allIds).size !== allIds.length) throw new Error(`${label}: room ids must be unique within the pattern`);

  return stages;
}

export function pickRandomPattern(pick: (patterns: FloorPatternDef[]) => FloorPatternDef): FloorPatternDef {
  return pick(FLOOR_PATTERNS);
}
