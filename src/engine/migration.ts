import type { GameState } from "../types";
import { MAX_EQUIPPED_ARTIFACTS } from "./party";
import { getItem } from "../data/items";
import { BALANCE } from "../data/balanceConfig";

/**
 * Migrates a GameState loaded from an older save (pre Artifact/Currency/Survival rework) to the
 * current shape. Safe to call on an already-current save — every step is a no-op then.
 */
export function migrateGameState(raw: unknown): GameState {
  const state = raw as GameState & { unequippedArtifactIds?: string[] };

  if (typeof state.coins !== "number") state.coins = 0;
  if (typeof state.satiety !== "number") state.satiety = BALANCE.survival.initialSatiety;
  if (state.pendingArtifactDecision === undefined) state.pendingArtifactDecision = null;
  if (state.secondJackpotArtifactId === undefined) state.secondJackpotArtifactId = null;

  // Old saves kept a shared pool of picked-up-but-unequipped artifacts (A.1). That pool no longer
  // exists — auto-equip each one to the first character with an open slot, or drop it if the whole
  // party is already full (matches the new model: an artifact is either equipped or it never existed).
  const legacyPool = state.unequippedArtifactIds;
  if (legacyPool && legacyPool.length > 0) {
    for (const artifactId of legacyPool) {
      const target = state.party.find((c) => c.equippedArtifactIds.length < MAX_EQUIPPED_ARTIFACTS);
      if (target) target.equippedArtifactIds.push(artifactId);
    }
  }
  delete state.unequippedArtifactIds;

  // Old saves may carry inventory counts for items removed from the catalog (Ration/Water Flask).
  for (const id of Object.keys(state.inventory)) {
    try {
      getItem(id);
    } catch {
      delete state.inventory[id];
    }
  }

  return state;
}
