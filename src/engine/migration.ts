import { randomUUID } from "node:crypto";
import type { GameState } from "../types";
import { MAX_EQUIPPED_ARTIFACTS } from "./party";
import { getItem } from "../data/items";
import { BALANCE } from "../data/balanceConfig";

/** Migrates a GameState from an older save shape to the current one. No-op on an already-current save. */
export function migrateGameState(raw: unknown): GameState {
  const state = raw as GameState & { unequippedArtifactIds?: string[] };

  if (typeof state.runId !== "string") state.runId = randomUUID();
  if (typeof state.coins !== "number") state.coins = 0;
  if (typeof state.satiety !== "number") state.satiety = BALANCE.survival.initialSatiety;
  if (state.pendingArtifactDecision === undefined) state.pendingArtifactDecision = null;
  if (state.secondJackpotArtifactId === undefined) state.secondJackpotArtifactId = null;
  if (!Array.isArray(state.metNarrativeNpcIds)) state.metNarrativeNpcIds = [];
  if (!state.narrativeCounters) state.narrativeCounters = { guardianFightsSkipped: 0, artifactsSacrificed: 0, altarPaymentsCount: 0 };
  if (!state.eventReflectionStances) state.eventReflectionStances = {};

  // Old saves kept a shared pool of unequipped artifacts; auto-equip each one to the first
  // character with an open slot, or drop it if the party is already full.
  const legacyPool = state.unequippedArtifactIds;
  if (legacyPool && legacyPool.length > 0) {
    for (const artifactId of legacyPool) {
      const target = state.party.find((c) => c.equippedArtifactIds.length < MAX_EQUIPPED_ARTIFACTS);
      if (target) target.equippedArtifactIds.push(artifactId);
    }
  }
  delete state.unequippedArtifactIds;

  // Drop inventory counts for items no longer in the catalog.
  for (const id of Object.keys(state.inventory)) {
    try {
      getItem(id);
    } catch {
      delete state.inventory[id];
    }
  }

  return state;
}
