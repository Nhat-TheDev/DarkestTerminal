import levelGrowthJson from "../../data/level-growth.json";
import type { GrowthWeights } from "../types";

// Implements docs/gameplay-decisions.md §6: 5 tapered stat tiers (fast growth
// early, slower late) shared by both character leveling (party.ts) and
// monster depth-scaling (monsters.ts) — keeping their power symmetric, same
// as the old linear-per-depth formula did for levels 1-7. Characters further
// apply a per-class weight on top (§6.8) so growth stays class-flavored
// instead of converging toward identical stats at high level; monsters use
// the shared curve unweighted (`growthBonus`/`growthBonusForDepth` directly).
// The EXP-cost curve (expCostForLevel) is bucketed separately, on its own
// finer 5-level grid (`expTiers`) — smoother ramp, same cumulative shape,
// but not tied to the stat tiers' 10/25/50/75/100 boundaries.
//
// §6.9/6.10/6.11: character level and floor depth are 2 independent axes.
// Character level stays capped at MAX_LEVEL (growthBonus, classGrowthBonus,
// expCostForLevel all clamp there); floor depth is uncapped, so the floor's
// guard-room monster (elite/boss) scales via growthBonusForDepth, which
// keeps applying tier 5's rate forever past level 100 instead of clamping.

export type GrowthStat = "attack" | "defense" | "maxHp" | "maxMp";

interface Tier {
  maxLevel: number;
  attack: number;
  defense: number;
  maxHp: number;
  maxMp: number;
}

/** EXP-per-level-up rate, bucketed on its own finer 5-level grid (1-5, 6-10, ..., 96-100) — kept separate from `Tier` since the stat curve and the EXP curve don't need to share bracket boundaries. */
interface ExpTier {
  maxLevel: number;
  expCost: number;
}

interface TierMultiplier {
  maxHp: number;
  attack: number;
  defense: number;
  /** EXP multiplier applied to the guard's fully-scaled kill reward (§6.9/6.11). */
  exp: number;
}

interface LevelGrowthFile {
  tiers: Tier[];
  expTiers: ExpTier[];
  eliteMultiplier: TierMultiplier;
  bossMultiplier: TierMultiplier;
  expRewardDepthRate: number;
  bossFloorInterval: number;
}

const DATA = levelGrowthJson as unknown as LevelGrowthFile;

export const MAX_LEVEL = 100;
/** Asymmetric on purpose (§6.5) — a uniform x2 let boss defense stack high enough to nearly negate all incoming damage at deep floors. Guards most floors. */
export const ELITE_MULTIPLIER: TierMultiplier = DATA.eliteMultiplier;
/** Stronger than ELITE_MULTIPLIER on every axis (§6.11) — replaces it every BOSS_FLOOR_INTERVAL floors instead, never both on the same floor. */
export const BOSS_MULTIPLIER: TierMultiplier = DATA.bossMultiplier;
/** Flat EXP-per-kill bonus per floor depth (§6.9) — deliberately linear, not the tapered stat curve (see §6.9's "sửa sau kiểm chứng" note: cumulative-sum EXP outpaced expCost and hit level 100 by depth ~29). */
export const EXP_REWARD_DEPTH_RATE = DATA.expRewardDepthRate;
/** Every Nth floor's guard room is a Boss instead of an Elite (§6.11). */
export const BOSS_FLOOR_INTERVAL = DATA.bossFloorInterval;

function tierFor(level: number): Tier {
  return DATA.tiers.find((t) => level <= t.maxLevel) ?? DATA.tiers[DATA.tiers.length - 1]!;
}

function expTierFor(level: number): ExpTier {
  return DATA.expTiers.find((t) => level <= t.maxLevel) ?? DATA.expTiers[DATA.expTiers.length - 1]!;
}

/** Cumulative stat bonus at `level`, on top of a level-1 base value. Level 1 always returns 0. Clamped to MAX_LEVEL — use growthBonusForDepth for the uncapped floor/monster path. */
export function growthBonus(stat: GrowthStat, level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, level));
  if (clamped <= 1) return 0;
  let total = 0;
  for (let l = 2; l <= clamped; l++) {
    total += tierFor(l)[stat];
  }
  return Math.floor(total);
}

/** Same cumulative-sum formula as growthBonus, but no upper clamp (§6.10) — floor depth is unlimited, so past level 100 this keeps applying tier 5's rate (the slowest) forever via tierFor()'s fallback. Used for monster/floor scaling, never for character stats. */
export function growthBonusForDepth(stat: GrowthStat, floorDepth: number): number {
  const clamped = Math.max(1, floorDepth);
  if (clamped <= 1) return 0;
  let total = 0;
  for (let l = 2; l <= clamped; l++) {
    total += tierFor(l)[stat];
  }
  return Math.floor(total);
}

/** growthBonus() scaled by a class's per-stat weight (§6.8) — used for character leveling only, not monster depth-scaling. */
export function classGrowthBonus(stat: GrowthStat, level: number, weights: GrowthWeights): number {
  return Math.round(growthBonus(stat, level) * weights[stat]);
}

/** Cumulative EXP required to reach `level` from level 1 (§6.9) — same cumulative-sum shape as growthBonus, but walks the finer `expTiers` 5-level brackets instead of the 5 stat tiers. Clamped to MAX_LEVEL (character level still caps there, unlike floor depth). */
export function expCostForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, level));
  if (clamped <= 1) return 0;
  let total = 0;
  for (let l = 2; l <= clamped; l++) {
    total += expTierFor(l).expCost;
  }
  return Math.floor(total);
}

/** Highest level (1-MAX_LEVEL) whose cumulative expCostForLevel() threshold is met by `totalExp` (§6.9). */
export function levelForTotalExp(totalExp: number): number {
  let level = 1;
  for (let l = 2; l <= MAX_LEVEL; l++) {
    if (totalExp >= expCostForLevel(l)) level = l;
    else break;
  }
  return level;
}
