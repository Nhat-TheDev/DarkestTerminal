// Where a run stands on the level curve, and the tallies random-play keeps on guards and survival.
// Guard difficulty itself is measured and checked by `bun run curve` (tools/curve/).
import { MONSTER_ARCHETYPES } from "../../src/data/monsters";
import { BOSS_FLOOR_INTERVAL } from "../../src/data/levelGrowth";
import { FOUNDER_FLOOR_DEPTH } from "../../src/data/endings";
import { simulateLevelByDepth } from "../game-editor/calc";
import type { MonsterTier } from "../../src/types";

export const levelByDepth = simulateLevelByDepth(20, FOUNDER_FLOOR_DEPTH);
export const levelAt = (depth: number) => levelByDepth[depth - 1]!.avgLevel;

/** The first depth an archetype appears at as `tier`: elites fill the floors between boss floors. */
export function firstDepth(id: string, tier: MonsterTier): number {
  const archetype = MONSTER_ARCHETYPES.find((a) => a.id === id)!;
  if (archetype.finalBoss) return FOUNDER_FLOOR_DEPTH;
  let depth = Math.max(1, archetype.minFloor ?? 0);
  if (tier === "boss") while (depth % BOSS_FLOOR_INTERVAL !== 0) depth++;
  else while (depth % BOSS_FLOOR_INTERVAL === 0) depth++;
  return depth;
}

export type GuardTier = "elite" | "boss";
export type GuardTally = Record<GuardTier, { fights: number; wins: number }>;

export interface SurvivalTally {
  samples: number;
  /** Sum of the party's highest fear at each sample. */
  fear: number;
  satiety: number;
}

/** The bot takes a rest room or a camp kit once satiety is at or below this. */
export const SATIETY_TARGET = 50;
