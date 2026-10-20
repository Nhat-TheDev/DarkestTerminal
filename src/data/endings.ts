import type { GameState } from "../types";
import { campReflectionTier } from "./loreExposure";
import { BALANCE } from "./balanceConfig";
import { EVENTS } from "./events";

export type EndingCheckpointMode = "leaveOnly" | "stayOrLetGo" | "full";

export const ENDING_CHECKPOINT_FLOOR_DEPTH = BALANCE.endings.checkpointFloorDepth;

export function leaveTriggered(state: GameState): boolean {
  const bloodDebtBreaks =
    state.narrativeCounters.altarPaymentsCount >= BALANCE.events.bloodDebtThreshold3 && state.eventOutcomes["blood-altar"] === "declined";
  const ledgerNeverOpens =
    state.narrativeCounters.freeRewardsTakenCount >= BALANCE.events.freeTakenThreshold &&
    state.narrativeCounters.altarPaymentsCount === 0 &&
    state.narrativeCounters.artifactsSacrificed === 0;
  return bloodDebtBreaks || ledgerNeverOpens;
}

export function endingCheckpointMode(state: GameState): EndingCheckpointMode {
  if (leaveTriggered(state)) return "leaveOnly";
  if (campReflectionTier(state.loreExposureCount) === 4) return "full";
  return "stayOrLetGo";
}

export function hasWaystoneShardEquipped(state: GameState): boolean {
  return state.party.some((c) => c.equippedArtifactIds.includes("waystone-shard"));
}

export const FOUNDER_FLOOR_DEPTH = BALANCE.endings.founderFloorDepth;

export const FOUNDER_VICTORY_REMOVED_EVENT_IDS: string[] = EVENTS.filter((e) => e.removedOnFounderVictory).map((e) => e.id);
