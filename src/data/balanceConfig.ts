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
  };
  items: {
    itemDropChance: number;
    itemWeightDepthGrowth: number;
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
