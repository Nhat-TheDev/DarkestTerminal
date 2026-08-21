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
export const ELITE_MULTIPLIER: TierMultiplier = DATA.eliteMultiplier;
export const BOSS_MULTIPLIER: TierMultiplier = DATA.bossMultiplier;
export const EXP_REWARD_DEPTH_RATE = DATA.expRewardDepthRate;
export const BOSS_FLOOR_INTERVAL = DATA.bossFloorInterval;

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
