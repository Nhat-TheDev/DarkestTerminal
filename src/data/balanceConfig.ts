import balanceConfigJson from "../../data/balance-config.json";
import type { ArtifactRarity, AttackRange, ItemTier } from "../types";

/** The factors a monster weighs when it picks a target — `docs/gameplay-decisions/02-monster.md`, "Targeting". */
export const TARGETING_FACTORS = ["aggro", "lowHp", "damage", "range", "fear"] as const;
export type TargetingFactor = (typeof TARGETING_FACTORS)[number];

export const ATTACK_RANGES: readonly AttackRange[] = ["melee", "ranged"];

export interface TargetingConfig {
  /** Score by HP-share rank, lowest HP share first; every rank past the end takes the last score. */
  lowHpRankScores: number[];
  /** Score by fear rank, highest fear first; every rank past the end takes the last score. */
  fearRankScores: number[];
  /** Score by rank of HP taken off the monster, most first; anyone who has dealt none takes the last score. */
  damageRankScores: number[];
  /** What each remembered amount of damage is multiplied by at the end of every round, 0 to 1. */
  damageMemoryDecay: number;
  /** The `range` score of a target whose `attackRange` matches the attack's, and of one whose does not. */
  rangeScores: { sameRange: number; otherRange: number };
  /** One weight per factor for each `aiPattern`; every profile's weights sum to 1. */
  profiles: Record<string, Record<TargetingFactor, number>>;
}

interface BalanceConfig {
  combat: {
    defenseMitigationX: number;
    defenseMitigationY: number;
    defensiveLowHpSkillChance: number;
    /** The most living monsters one summoner can have summoned at once. */
    maxSummonedMonsters: number;
    /** Shared crit-damage multiplier (as a %) for any `SkillEffect.critChance` that doesn't set its own `critMultiplierPercent`. */
    defaultCritMultiplierPercent: number;
    /** Chance (as a %) every direct damage hit and heal has to crit, added to the skill's own `critChance`; 0 turns it off. A crit multiplies by `defaultCritMultiplierPercent` unless the effect sets its own. */
    baseCritChancePercent: number;
    /** Every direct damage hit is scaled by a random factor within ±this %, rounded at random so a small hit still moves; 0 turns it off. */
    damageVariancePercent: number;
    /** A normal-tier defensive monster below this share of max HP reaches for its self-targeted skill. */
    defensiveLowHpThresholdFraction: number;
    /** Added to a character's speed for turn order when its queued skill is `isBuff` (and not a summon). */
    buffTurnOrderSpeedBonus: number;
    /** Every DoT tick on an Elite or Boss is multiplied by this. */
    eliteBossDotMultiplier: number;
    /** Fear values at which tiers 2, 3 and 4 begin. */
    fearTierThresholds: [number, number, number];
    /** Indexed by fear tier - 1. */
    fearAccuracyPenaltyByTier: [number, number, number, number];
    fearDamagePenaltyByTier: [number, number, number, number];
    /** Chance per turn that a tier-4 character loses control and skips the turn. */
    fearLoseControlChance: number;
    /** An ultimate's damage/heal is scaled by this, indexed by the caster's fear tier - 1. */
    ultimateMultiplierByFearTier: [number, number, number, number];
  };
  targeting: TargetingConfig;
  survival: {
    initialSatiety: number;
    initialFear: number;
    satietyDrainCombat: number;
    satietyDrainEvent: number;
    exhaustedThreshold: number;
    exhaustedStatMultiplier: number;
    dyingThreshold: number;
    dyingDamagePerRound: number;
    campSatietyRestore: number;
    eatDrinkRestoreFraction: number;
    eatDrinkSatietyRestore: number;
    chatRestoreFraction: number;
    chatFearRelief: number;
    /** 03-survival-stats.md's Camp Reflection — `loreExposureCount` thresholds for tiers 1-4.
        Balance-tunable, not a lore decision; pending playtesting of real run lengths. */
    campReflectionTier1Threshold: number;
    campReflectionTier2Threshold: number;
    campReflectionTier3Threshold: number;
    campReflectionTier4Threshold: number;
    fearPerRoundBase: number;
    fearPerRoundLowHp: number;
    fearPerRoundBaseCap: number;
    fearPerRoundLowHpCap: number;
    fearPerRoundDepthGrowth: number;
    fearLowHpThresholdFraction: number;
    /** Fear a character gains each time a monster's damage effect lands on it, before depth growth and fearResist. */
    fearPerHitTaken: number;
    fearPerHitTakenCap: number;
    fearVictoryRelief: number;
    fearVictoryReliefQuick: number;
    fearQuickVictoryRoundThreshold: number;
    fearEliteOrBossVictoryRelief: number;
    fearEliteOrBossVictoryReliefQuick: number;
    fearEliteOrBossQuickVictoryRoundThreshold: number;
  };
  party: {
    size: number;
    maxEquippedArtifacts: number;
    startingExplorationKits: number;
  };
  currency: {
    coinDropByTier: {
      weak: [number, number];
      medium: [number, number];
      strong: [number, number];
      elite: [number, number];
      boss: [number, number];
    };
  };
  events: {
    commonTierWeight: number;
    rareTierWeight: number;
    merchantPriceCoins: Record<ArtifactRarity, number>;
    merchantOfferCount: number;
    merchantRefreshCostCoins: number;
    merchantMaxRefreshes: number;
    bloodAltarHpPercent: number;
    collapsedFloorHpPercent: number;
    collapsedFloorSuccessChance: number;
    eventGuardianStatMultiplier: { maxHp: number; attack: number; defense: number };
    /** §10.3 Chain 1 ("The Guardian's Grudge") — skips of guardian-fight/desecrated-altar needed to
        force the next encounter (no Skip offered). The buildup variant shows 1 skip before this. */
    guardianGrudgeForcedThreshold: number;
    /** §10.3 Chain 2 ("The Circle Remembers") — cumulative artifactsSacrificed needed to escalate
        every subsequent sacrificial-circle room. Permanent once crossed, no reset. */
    circleRemembersThreshold: number;
    /** 11-world-bible.md §11.13 tier 2 — higher threshold past `circleRemembersThreshold`, gated
        together with `chainTier2MinFloorDepth`. Permanent once crossed, no reset. */
    circleRemembersThreshold2: number;
    /** §10.3 Chain 3 ("Blood Debt") — cumulative altarPaymentsCount (bloodAltarPay +
        collapsedFloorAttempt) needed to escalate every subsequent blood-altar room. Permanent once
        crossed, no reset. */
    bloodDebtThreshold: number;
    /** 11-world-bible.md §11.13 tier 2 — higher threshold past `bloodDebtThreshold`, gated together
        with `chainTier2MinFloorDepth`. Permanent once crossed, no reset. */
    bloodDebtThreshold2: number;
    /** 11-world-bible.md §11.13 tier 2 — floor depth all 3 chains' tier-2 escalations additionally
        require, alongside their counter threshold, so an early lucky/rich run can't reach tier-2
        content by counter alone (see docs/gameplay-decisions/10-event-narrative.md, "Proposal —
        pacing narrative delivery across a randomized run"). */
    chainTier2MinFloorDepth: number;
    /** 10-event-narrative.md Part C.3 — higher threshold past `circleRemembersThreshold2`, gated
        together with `chainTier3MinFloorDepth`. Permanent once crossed, no reset. */
    circleRemembersThreshold3: number;
    /** Part C.3 — higher threshold past `bloodDebtThreshold2`, gated together with
        `chainTier3MinFloorDepth`. Permanent once crossed, no reset. */
    bloodDebtThreshold3: number;
    /** Part C.3 — floor depth all 3 chains' tier-3 escalations additionally require, alongside
        their counter threshold (same reasoning as `chainTier2MinFloorDepth`, one tier deeper). */
    chainTier3MinFloorDepth: number;
    /** §8.15 Chain 4 ("Taken, Never Given") — cumulative freeRewardsTakenCount needed to escalate
        every subsequent resolution of its 7 zero-cost events, provided altarPaymentsCount and
        artifactsSacrificed are both still 0. Single tier, not gated by floor depth, permanent once
        crossed. */
    freeTakenThreshold: number;
    /** §10.5 — chance a post-event reflection shows again after the 1st (always 100%) encounter
        with a given event id. */
    reflectionRepeatChance: number;
    gamblingDenRounds: {
      stake: number;
      winChance: number;
      jackpotArtifactCount?: number;
      jackpotRarity?: ArtifactRarity;
    }[];
    wanderingHermitExchangeCostCoins: number;
    /** Gambling Den: the pot is multiplied by this after each won round before the jackpot. */
    gamblingDenPotMultiplier: number;
    /** Fixed rarity odds for the exchange events (Sacrificial Circle, Wandering Hermit), not depth-scaled. */
    exchangeRarityWeights: Record<ArtifactRarity, number>;
    /** Chance `rollArtifactOrCursed` returns a Cursed Artifact instead of a normal roll. */
    cursedArtifactChance: number;
    /** How many guardians an event guardian fight spawns, inclusive. */
    eventGuardianCount: { min: number; max: number };
  };
  /** 10-event-narrative.md Part F — the floor depths the ending checkpoint and the founder encounter fire at. */
  endings: {
    checkpointFloorDepth: number;
    founderFloorDepth: number;
  };
  items: {
    itemDropChance: number;
    /** Share of a trophy monster's drops that come from its trophies. */
    trophyDropShare: number;
    /** Multiplier on a group trophy's drop weight. */
    groupDropMultiplier: number;
    tierWeights: Record<ItemTier, number>;
  };
  /** Artifact rarity odds by floor depth — `docs/gameplay-decisions/07-items-artifacts.md`, "Level bands & drop schedule". Each source's `anchorWeights` are its odds on the step containing `anchorFirstFloor`; every other step scales rarity `i` (common = 0 … epic = 3) by `tilt ^ (i × stepsFromAnchor)` and renormalizes. */
  artifacts: {
    floorsPerStep: number;
    anchorFirstFloor: number;
    tilt: number;
    /** Steps away from the anchor beyond which the odds stop changing. */
    maxStepsFromAnchor: number;
    anchorWeights: Record<"elite" | "boss" | "treasureOrEvent", Record<ArtifactRarity, number>>;
  };
  /** The Merchant's Runner in Rest rooms — `docs/gameplay-decisions/03-survival-stats.md`, "The Merchant's Runner". */
  runner: {
    appearChance: number;
    noticeVariantCount: number;
    offerCount: number;
    /** Chance an offer is a single item rather than a lot. */
    singleChance: number;
    /** Chance an offer is a trophy rather than a consumable. */
    trophyOfferChance: number;
    lotSize: number;
    /** Buyback pays the single price divided by this. */
    buybackDivisor: number;
    priceByTier: Partial<Record<ItemTier, { single: number; lot: number }>>;
  };
  /** Trophy-for-buff barter at the Runner. What each trophy costs and buys is in `data/barter.json`. */
  barter: {
    /** Trophy kinds the Runner offers to trade each visit. */
    offerCount: number;
    /** How long the buff lasts once active: effectively the whole combat, since it expires on victory. */
    activeDurationTurns: number;
    /** The status (`data/status-effects.json`) that carries each stat a barter buff raises. */
    statStatusIds: Record<"attack" | "magicPower" | "defense" | "speed", string>;
    /** The status that heals for a trophy of each tier, strongest for the rarest. */
    regenStatusIdByTier: Record<ItemTier, string>;
  };
  /** Shop tier odds by floor depth — same method as `artifacts`: each step away from the anchor scales tier `i` by `tilt ^ (i × steps)`. */
  shop: {
    floorsPerStep: number;
    anchorFirstFloor: number;
    tilt: number;
    maxStepsFromAnchor: number;
    anchorWeights: { consumable: Partial<Record<ItemTier, number>>; trophy: Partial<Record<ItemTier, number>> };
  };
  abilities: {
    dropChance: number;
    depthCap: number;
    rarityWeightsByDepth: Record<"elite" | "boss", { atDepth1: Record<ArtifactRarity, number>; atDepthCap: Record<ArtifactRarity, number> }>;
    stardustCostByRarity: Record<Exclude<ArtifactRarity, "common">, number>;
  };
  floorGeneration: {
    minPathRooms: number;
    maxPathRooms: number;
    maxBranches: number;
    minBranchStartStage: number;
    minBranchSpacing: number;
    maxEventRoomsPerPath: number;
    minRestRoomsPerPath: number;
    maxRestRoomsPerPath: number;
    /** Monster power tiers of an ordinary combat room, one entry per possible room. */
    roomCompositionTemplates: ("weak" | "medium" | "strong")[][];
  };
}

export const BALANCE = balanceConfigJson as unknown as BalanceConfig;

const FEAR_TIER_ARRAYS = {
  fearTierThresholds: 3,
  fearAccuracyPenaltyByTier: 4,
  fearDamagePenaltyByTier: 4,
  ultimateMultiplierByFearTier: 4,
} as const;
for (const [key, length] of Object.entries(FEAR_TIER_ARRAYS)) {
  const value = BALANCE.combat[key as keyof typeof FEAR_TIER_ARRAYS];
  if (!Array.isArray(value) || value.length !== length) throw new Error(`balance-config combat.${key} must list ${length} numbers`);
}
if (BALANCE.combat.fearTierThresholds.some((v, i, all) => i > 0 && v <= all[i - 1]!)) {
  throw new Error("balance-config combat.fearTierThresholds must be strictly ascending");
}

/** Why `config` is not a usable `targeting` section, or `null` when it is. Shared with the game editor's save path. */
export function targetingConfigError(config: TargetingConfig): string | null {
  for (const key of ["lowHpRankScores", "fearRankScores", "damageRankScores"] as const) {
    const scores = config[key];
    if (!Array.isArray(scores) || scores.length === 0 || !scores.every((v) => typeof v === "number" && v > 0)) {
      return `targeting.${key} must be a non-empty list of numbers above 0`;
    }
  }
  if (!(typeof config.damageMemoryDecay === "number" && config.damageMemoryDecay >= 0 && config.damageMemoryDecay <= 1)) {
    return "targeting.damageMemoryDecay must be a number from 0 to 1";
  }
  for (const key of ["sameRange", "otherRange"] as const) {
    const score = config.rangeScores?.[key];
    if (!(typeof score === "number" && score > 0)) return `targeting.rangeScores.${key} must be a number above 0`;
  }
  const profiles = Object.entries(config.profiles ?? {});
  if (profiles.length === 0) return "targeting.profiles must define at least 1 aiPattern";
  for (const [pattern, weights] of profiles) {
    const keys = Object.keys(weights ?? {});
    if (keys.length !== TARGETING_FACTORS.length || !TARGETING_FACTORS.every((f) => keys.includes(f))) {
      return `targeting.profiles.${pattern} must set exactly ${TARGETING_FACTORS.join(", ")}`;
    }
    if (!TARGETING_FACTORS.every((f) => typeof weights[f] === "number" && weights[f] >= 0)) return `targeting.profiles.${pattern}: every weight must be a number >= 0`;
    const sum = TARGETING_FACTORS.reduce((total, f) => total + weights[f], 0);
    if (Math.abs(sum - 1) > 1e-9) return `targeting.profiles.${pattern}: weights must sum to 1 (got ${sum})`;
  }
  return null;
}

const targetingError = targetingConfigError(BALANCE.targeting);
if (targetingError) throw new Error(`balance-config ${targetingError}`);
