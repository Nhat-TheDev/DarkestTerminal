import levelGrowthJson from "../../data/level-growth.json";
import type { GrowthWeights } from "../types";

export type GrowthStat = "attack" | "defense" | "maxHp" | "maxMp" | "magicPower";

interface Tier {
  maxLevel: number;
  attack: number;
  defense: number;
  maxHp: number;
  maxMp: number;
  magicPower: number;
}

interface ExpTier {
  maxLevel: number;
  expCost: number;
}

interface TierMultiplier {
  maxHp: number;
  attack: number;
  defense: number;
  exp: number;
}

interface DepthBuffBracket {
  maxFloor: number;
  bonusPercent: number;
}

interface DepthBuffStatCoefficients {
  maxHp: number;
  attack: number;
  defense: number;
}

interface LevelGrowthFile {
  tiers: Tier[];
  expTiers: ExpTier[];
  eliteMultiplier: TierMultiplier;
  bossMultiplier: TierMultiplier;
  expRewardDepthRate: number;
  bossFloorInterval: number;
  monsterDepthBuffBrackets: DepthBuffBracket[];
  monsterDepthBuffStatCoefficients: DepthBuffStatCoefficients;
}

const DATA = levelGrowthJson as unknown as LevelGrowthFile;

export const MAX_LEVEL = 100;
export const ELITE_MULTIPLIER: TierMultiplier = DATA.eliteMultiplier;
export const BOSS_MULTIPLIER: TierMultiplier = DATA.bossMultiplier;
export const EXP_REWARD_DEPTH_RATE = DATA.expRewardDepthRate;
export const BOSS_FLOOR_INTERVAL = DATA.bossFloorInterval;
export const MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS: DepthBuffStatCoefficients = DATA.monsterDepthBuffStatCoefficients;

/** Step function, not interpolated — a monster spawned right after crossing a bracket boundary
 *  gets the full new bracket's bonus immediately (docs/superpowers/specs/2026-09-16-monster-race-
 *  damage-scaling-design.md §4). Depth beyond the last bracket's maxFloor stays at that bracket's
 *  value — it never extrapolates further. */
export function monsterDepthBuffPercent(floorDepth: number): number {
  const brackets = DATA.monsterDepthBuffBrackets;
  const bracket = brackets.find((b) => floorDepth <= b.maxFloor);
  return (bracket ?? brackets[brackets.length - 1]!).bonusPercent;
}

function tierFor(level: number): Tier {
  return DATA.tiers.find((t) => level <= t.maxLevel) ?? DATA.tiers[DATA.tiers.length - 1]!;
}

function expTierFor(level: number): ExpTier {
  return DATA.expTiers.find((t) => level <= t.maxLevel) ?? DATA.expTiers[DATA.expTiers.length - 1]!;
}

export function growthBonus(stat: GrowthStat, level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, level));
  if (clamped <= 1) return 0;
  let total = 0;
  for (let l = 2; l <= clamped; l++) {
    total += tierFor(l)[stat];
  }
  return Math.floor(total);
}

export function growthBonusForDepth(stat: GrowthStat, floorDepth: number): number {
  const clamped = Math.max(1, floorDepth);
  if (clamped <= 1) return 0;
  let total = 0;
  for (let l = 2; l <= clamped; l++) {
    total += tierFor(l)[stat];
  }
  return Math.floor(total);
}

export function classGrowthBonus(stat: GrowthStat, level: number, weights: GrowthWeights): number {
  return Math.round(growthBonus(stat, level) * weights[stat]);
}

export function expCostForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, level));
  if (clamped <= 1) return 0;
  let total = 0;
  for (let l = 2; l <= clamped; l++) {
    total += expTierFor(l).expCost;
  }
  return Math.floor(total);
}

export function levelForTotalExp(totalExp: number): number {
  let level = 1;
  for (let l = 2; l <= MAX_LEVEL; l++) {
    if (totalExp >= expCostForLevel(l)) level = l;
    else break;
  }
  return level;
}
