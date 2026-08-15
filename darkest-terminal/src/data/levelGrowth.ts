import levelGrowthJson from "../../data/level-growth.json";

// Implements docs/gameplay-decisions.md §6: 5 tapered tiers (fast growth
// early, slower late) shared by both character leveling (party.ts) and
// monster depth-scaling (monsters.ts) — keeping their power symmetric, same
// as the old linear-per-depth formula did for levels 1-7.

export type GrowthStat = "attack" | "defense" | "maxHp" | "maxMp";

interface Tier {
  maxLevel: number;
  attack: number;
  defense: number;
  maxHp: number;
  maxMp: number;
}

interface EliteMultiplier {
  maxHp: number;
  attack: number;
  defense: number;
}

interface LevelGrowthFile {
  tiers: Tier[];
  eliteMultiplier: EliteMultiplier;
}

const DATA = levelGrowthJson as unknown as LevelGrowthFile;

export const MAX_LEVEL = 100;
/** Asymmetric on purpose (§6.5) — a uniform x2 let boss defense stack high enough to nearly negate all incoming damage at deep floors. */
export const ELITE_MULTIPLIER: EliteMultiplier = DATA.eliteMultiplier;

function tierFor(level: number): Tier {
  return DATA.tiers.find((t) => level <= t.maxLevel) ?? DATA.tiers[DATA.tiers.length - 1]!;
}

/** Cumulative stat bonus at `level`, on top of a level-1 base value. Level 1 always returns 0. */
export function growthBonus(stat: GrowthStat, level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, level));
  if (clamped <= 1) return 0;
  let total = 0;
  for (let l = 2; l <= clamped; l++) {
    total += tierFor(l)[stat];
  }
  return Math.floor(total);
}
