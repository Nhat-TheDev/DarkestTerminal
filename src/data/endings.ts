import type { GameState } from "../types";
import { campReflectionTier } from "./loreExposure";
import { BALANCE } from "./balanceConfig";

export type EndingCheckpointMode = "leaveOnly" | "stayOrLetGo" | "full";

/** Part F.1 — the exact depth the guaranteed checkpoint fires at. */
export const ENDING_CHECKPOINT_FLOOR_DEPTH = 100;

/** 10-event-narrative.md §F.1 — Leave's 2 independent triggers, either sufficient on its own.
    Trigger 1, "the blood debt breaks": Chain 3 reached tier-3 escalation at some point this run,
    and the most recently recorded blood-altar outcome reads "declined". Trigger 2, "the ledger
    never opens": Chain 4 (§8.15) escalated and the party has never paid at blood-altar or fed
    sacrificial-circle. Neither trigger is ever surfaced to the player. */
export function leaveTriggered(state: GameState): boolean {
  const bloodDebtBreaks =
    state.narrativeCounters.altarPaymentsCount >= BALANCE.events.bloodDebtThreshold3 && state.eventOutcomes["blood-altar"] === "declined";
  const ledgerNeverOpens =
    state.narrativeCounters.freeRewardsTakenCount >= BALANCE.events.freeTakenThreshold &&
    state.narrativeCounters.altarPaymentsCount === 0 &&
    state.narrativeCounters.artifactsSacrificed === 0;
  return bloodDebtBreaks || ledgerNeverOpens;
}

/** §F.1's 3-mode table — Leave's trigger overrides everything else and is checked first; Camp
    Reflection reaching Unawareness (tier 4) unlocks Continue alongside Stay/Let Go; anything else
    offers only Stay/Let Go. Computed fresh, never stored (see `GameState.pendingEndingCheckpoint`'s
    own doc comment for why that's safe). */
export function endingCheckpointMode(state: GameState): EndingCheckpointMode {
  if (leaveTriggered(state)) return "leaveOnly";
  if (campReflectionTier(state.loreExposureCount) === 4) return "full";
  return "stayOrLetGo";
}

/** §F.4 — Leave's good branch requires the escape key currently equipped by any party member,
    not merely owned somewhere in an inventory pool (this game has no such pool; equipped is the
    only place an artifact ever lives). */
export function hasWaystoneShardEquipped(state: GameState): boolean {
  return state.party.some((c) => c.equippedArtifactIds.includes("waystone-shard"));
}

/** Part F.5 — the exact depth the founder encounter fires at, once `continuedPastCheckpoint`. */
export const FOUNDER_FLOOR_DEPTH = 120;

/** Part F.5 — every event tied to the Covenant as an institution, permanently removed from the
    roll pool once the founder falls. `still-breathing` is included too (narratively redundant once
    this reveal has landed), `open-chest`/`collapsed-floor`/the 8 Part-C events/`gambling-den`/
    `the-wanderer`/Ending 1's future retired-character event are deliberately NOT in this list. */
export const FOUNDER_VICTORY_REMOVED_EVENT_IDS: string[] = [
  "guardian-fight",
  "desecrated-altar",
  "merchant",
  "blood-altar",
  "cursed-shrine",
  "twin-altars",
  "sacrificial-circle",
  "wandering-hermit",
  "broken-seal",
  "half-a-warning",
  "still-breathing",
];
