import balanceConfigJson from "../../data/balance-config.json";
import type { ArtifactRarity, ItemTier } from "../types";

interface BalanceConfig {
  combat: {
    /** A status lasting at least this many turns is shown as (∞). */
    statusLastsFightFromTurns: number;
    defenseMitigationX: number;
    defenseMitigationY: number;
    defensiveLowHpSkillChance: number;
    /** Used when an effect sets no `critMultiplierPercent`. */
    defaultCritMultiplierPercent: number;
    /** Added to every direct hit's and heal's own `critChance`; 0 disables. */
    baseCritChancePercent: number;
    /** ± spread on every direct hit, rounded at random so small hits still vary; 0 disables. */
    damageVariancePercent: number;
    defensiveLowHpThresholdFraction: number;
    /** Applies when the queued skill `isBuff` and is not a summon. */
    buffTurnOrderSpeedBonus: number;
    eliteBossDotMultiplier: number;
    /** Fear values at which tiers 2, 3 and 4 begin. */
    fearTierThresholds: [number, number, number];
    /** Indexed by fear tier - 1. */
    fearAccuracyPenaltyByTier: [number, number, number, number];
    fearDamagePenaltyByTier: [number, number, number, number];
    /** Per turn, at fear tier 4 only. */
    fearLoseControlChance: number;
    ultimateMultiplierByFearTier: [number, number, number, number];
  };
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
    /** Per landed monster damage effect, before depth growth and fearResist. */
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
    startingCoins: number;
  };
  /** `blessingRooms` counts floor-1 rooms; `blessingDurationTurns` is per fight. */
  gatekeeper: {
    tollCoins: number;
    blessingRooms: number;
    blessingStatusId: string;
    blessingDurationTurns: number;
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
    /** Skips of guardian-fight/desecrated-altar that force the next one (no Skip offered). */
    guardianGrudgeForcedThreshold: number;
    /** Chain thresholds are cumulative counters and permanent once crossed. */
    circleRemembersThreshold: number;
    circleRemembersThreshold2: number;
    /** Counts altarPaymentsCount (bloodAltarPay + collapsedFloorAttempt). */
    bloodDebtThreshold: number;
    bloodDebtThreshold2: number;
    /** Every chain's tier 2 also needs this floor depth, so a lucky early run can't reach it by counter alone. */
    chainTier2MinFloorDepth: number;
    circleRemembersThreshold3: number;
    bloodDebtThreshold3: number;
    /** As `chainTier2MinFloorDepth`, for tier 3. */
    chainTier3MinFloorDepth: number;
    /** Counts freeRewardsTakenCount; only applies while altarPaymentsCount and artifactsSacrificed are both 0. Single tier, no depth gate. */
    freeTakenThreshold: number;
    /** The first encounter with an event id always shows its reflection; this is the chance for later ones. */
    reflectionRepeatChance: number;
    gamblingDenRounds: {
      stake: number;
      winChance: number;
      jackpotArtifactCount?: number;
      jackpotRarity?: ArtifactRarity;
    }[];
    wanderingHermitExchangeCostCoins: number;
    gamblingDenPotMultiplier: number;
    /** Not depth-scaled. */
    exchangeRarityWeights: Record<ArtifactRarity, number>;
    cursedArtifactChance: number;
    /** Inclusive. */
    eventGuardianCount: { min: number; max: number };
  };
  endings: {
    checkpointFloorDepth: number;
    founderFloorDepth: number;
  };
  items: {
    itemDropChance: number;
    /** Share of a trophy monster's drops that come from its trophies. */
    trophyDropShare: number;
    /** Applied to a group trophy's drop weight. */
    groupDropMultiplier: number;
    tierWeights: Record<ItemTier, number>;
  };
  /** Odds by floor depth; see `tierWeightsByDepth`. */
  artifacts: {
    floorsPerStep: number;
    anchorFirstFloor: number;
    tilt: number;
    maxStepsFromAnchor: number;
    anchorWeights: Record<"elite" | "boss" | "treasureOrEvent", Record<ArtifactRarity, number>>;
  };
  runner: {
    appearChance: number;
    noticeVariantCount: number;
    offerCount: number;
    singleChance: number;
    trophyOfferChance: number;
    lotSize: number;
    /** Buyback pays the single price divided by this. */
    buybackDivisor: number;
    priceByTier: Partial<Record<ItemTier, { single: number; lot: number }>>;
  };
  barter: {
    offerCount: number;
    /** The buff expires on victory, so this only needs to outlast a fight. */
    activeDurationTurns: number;
    statStatusIds: Record<"attack" | "magicPower" | "defense" | "speed", string>;
    regenStatusIdByTier: Record<ItemTier, string>;
  };
  /** Odds by floor depth; see `tierWeightsByDepth`. */
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
    minEventRoomsPerFloor: number;
    minStandaloneEventRooms: number;
    maxStandaloneEventRooms: number;
    minStandaloneEventStage: number;
    minRestRoomsPerPath: number;
    maxRestRoomsPerPath: number;
    /** Each template is one possible combat room's monster tiers. */
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
