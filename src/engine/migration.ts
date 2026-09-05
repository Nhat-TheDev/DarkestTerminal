import { randomUUID } from "node:crypto";
import type { GameState } from "../types";
import { MAX_EQUIPPED_ARTIFACTS } from "./party";
import { getItem } from "../data/items";
import { getStatusEffect } from "../data/statusEffects";
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
  if (!state.narrativeCounters)
    state.narrativeCounters = { guardianFightsSkipped: 0, artifactsSacrificed: 0, altarPaymentsCount: 0, guardianGrudgeFiredCount: 0, freeRewardsTakenCount: 0 };
  if (typeof state.narrativeCounters.guardianGrudgeFiredCount !== "number") state.narrativeCounters.guardianGrudgeFiredCount = 0;
  if (typeof state.narrativeCounters.freeRewardsTakenCount !== "number") state.narrativeCounters.freeRewardsTakenCount = 0;
  if (!state.eventReflectionStances) state.eventReflectionStances = {};
  if (!state.eventOutcomes) state.eventOutcomes = {};
  if (!Array.isArray(state.firedOnceEventIds)) state.firedOnceEventIds = [];
  if (typeof state.loreExposureCount !== "number") state.loreExposureCount = 0;
  if (state.pendingCampReflectionTier === undefined) state.pendingCampReflectionTier = null;
  if (!state.campReflectionChoices) state.campReflectionChoices = {};
  if (typeof state.pendingEndingCheckpoint !== "boolean") state.pendingEndingCheckpoint = false;
  if (typeof state.continuedPastCheckpoint !== "boolean") state.continuedPastCheckpoint = false;
  if (typeof state.pendingFounderDialogue !== "boolean") state.pendingFounderDialogue = false;
  if (state.retiredCharacterClassId === undefined) state.retiredCharacterClassId = null;
  // Part F.2 — a fresh Game encodes "the-one-who-stayed" is ineligible by pre-inserting its id into
  // firedOnceEventIds; a migrated save never went through that constructor, so restore the same
  // invariant here. Without this, a pre-Ending-System save rolls the event with no retired class
  // recorded and renders its raw {{class}} placeholder.
  if (!state.retiredCharacterClassId && !state.firedOnceEventIds.includes("the-one-who-stayed")) {
    state.firedOnceEventIds.push("the-one-who-stayed");
  }

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

  // Drop active status effects whose id no longer exists (e.g. a rank id removed in a data split) —
  // otherwise the very next getStatusEffect() lookup on load (categorizing or ticking it) throws.
  for (const character of state.party) {
    character.activeStatusEffects = character.activeStatusEffects.filter((s) => {
      try {
        getStatusEffect(s.statusEffectId);
        return true;
      } catch {
        return false;
      }
    });
  }

  return state;
}
