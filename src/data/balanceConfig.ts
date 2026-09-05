import balanceConfigJson from "../../data/balance-config.json";
import type { ArtifactRarity } from "../types";

interface BalanceConfig {
  combat: {
    defenseMitigationX: number;
    defenseMitigationY: number;
    executeCooldownTurns: number;
    defensiveLowHpSkillChance: number;
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
    eatDrinkRestorePercent: number;
    eatDrinkSatietyRestore: number;
    chatRestorePercent: number;
    chatFearRelief: number;
    fearPerRoundBase: number;
    fearPerRoundLowHp: number;
    fearPerRoundBaseCap: number;
    fearPerRoundLowHpCap: number;
    fearPerRoundDepthGrowth: number;
    fearLowHpThresholdPercent: number;
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
    /** §10.3 Chain 3 ("Blood Debt") — cumulative altarPaymentsCount (bloodAltarPay +
        collapsedFloorAttempt) needed to escalate every subsequent blood-altar room. Permanent once
        crossed, no reset. */
    bloodDebtThreshold: number;
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
  };
  items: {
    itemDropChance: number;
    itemWeightDepthGrowth: number;
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
  };
}

export const BALANCE = balanceConfigJson as unknown as BalanceConfig;
