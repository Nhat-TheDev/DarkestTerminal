import balanceConfigJson from "../../data/balance-config.json";
import type { ArtifactRarity } from "../types";

// Central home for balance constants that used to be scattered as literal
// numbers across src/engine/*.ts and src/data/*.ts — see data/balance-config.json
// for the field-by-field rationale. Design data with its own existing JSON
// (classes/monsters/items/level-growth/status-effects/artifacts/events/strings)
// stays in those files; this is only for what was previously a bare `const X = 0.3`.
interface BalanceConfig {
  combat: {
    defenseMitigationX: number;
    defenseMitigationY: number;
    executeCooldownTurns: number;
  };
  survival: {
    initialHunger: number;
    initialThirst: number;
    initialFear: number;
    hungerDrainPerAction: number;
    thirstDrainPerAction: number;
    starvationDamagePercent: number;
    eatDrinkRestorePercent: number;
    chatRestorePercent: number;
    chatFearRelief: number;
    fearPerRoundBase: number;
    fearPerRoundLowHp: number;
    fearPerRoundBaseCap: number;
    fearPerRoundLowHpCap: number;
    fearPerRoundDepthGrowth: number;
    fearLowHpThresholdPercent: number;
    fearVictoryRelief: number;
    fearEliteOrBossVictoryRelief: number;
  };
  party: {
    maxEquippedArtifacts: number;
  };
  events: {
    commonTierWeight: number;
    rareTierWeight: number;
    merchantPricePercent: Record<ArtifactRarity, number>;
    bloodAltarHpPercent: number;
    collapsedFloorHpPercent: number;
    collapsedFloorSuccessChance: number;
    eventGuardianStatMultiplier: number;
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
