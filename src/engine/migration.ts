import { randomUUID } from "node:crypto";
import type { ActiveStatusEffect, CombatantSnapshot, CombatState, GameState, Id, LogSession, Monster, Summon } from "../types";
import { MAX_EQUIPPED_ARTIFACTS, characterBaseStats } from "./party";
import { Rng } from "./rng";
import { getItem } from "../data/items";
import { getSkill } from "../data/classes";
import { SUMMON_ARCHETYPES } from "../data/summons";
import { getStatusEffect } from "../data/statusEffects";
import { ABILITIES } from "../data/abilities";
import { BALANCE } from "../data/balanceConfig";
import { getArchetype } from "../data/monsters";
import { getFloorMilestoneOmen, pickFloorMilestoneOmen } from "../data/floorMilestones";

/**
 * Removes the active statuses whose id has left `data/status-effects.json` (a renamed status, a rank
 * removed in a data split) — otherwise the next lookup of one (ticking it, categorising it) throws.
 * A status's stat change was applied straight onto its bearer, so the amount it recorded is taken
 * back off; a character's stats are recomputed on load anyway, a monster's or summon's are not.
 */
function dropUnknownStatuses(bearer: { activeStatusEffects: ActiveStatusEffect[] }): void {
  const stats = bearer as unknown as Record<string, unknown>;
  bearer.activeStatusEffects = bearer.activeStatusEffects.filter((active) => {
    try {
      getStatusEffect(active.statusEffectId);
      return true;
    } catch {
      for (const [stat, amount] of Object.entries(active.appliedAmounts ?? {})) {
        const current = stats[stat];
        if (typeof current === "number" && Number.isFinite(amount)) stats[stat] = current - amount;
      }
      return false;
    }
  });
}

/** Whether `lookup` (a catalog accessor that throws on an unknown id) knows `id`. */
function isKnown(lookup: (id: Id) => unknown, id: Id): boolean {
  try {
    lookup(id);
    return true;
  } catch {
    return false;
  }
}

/** Snapshots are display-only, so a status that has left the catalog is just removed from them, with no stat to take back. */
function stripUnknownStatuses(snapshot: CombatantSnapshot[] | undefined): void {
  for (const unit of snapshot ?? []) {
    if (unit.activeStatusEffects) unit.activeStatusEffects = unit.activeStatusEffects.filter((s) => isKnown(getStatusEffect, s.statusEffectId));
  }
}

const SESSION_ID_LISTS = [
  "attackedIds",
  "debuffedIds",
  "buffedIds",
  "healedIds",
  "missedIds",
  "lifestealIds",
  "tickDamageIds",
  "buffLostIds",
  "lostTurnIds",
  "summonIds",
  "affectedIds",
  "fearGainIds",
] as const satisfies readonly (keyof LogSession)[];

/**
 * A fight saved before a skill, item or status was renamed. An action queued under an id that has
 * left the catalog is dropped, so its character is asked for a new one; a skill commits nothing
 * until it executes, and an item's stock left the inventory together with its id. The round and
 * log snapshots lose the old status ids, and a log session saved before one of its id lists
 * existed gets that list empty.
 */
function migrateCombat(combat: CombatState): void {
  combat.queuedActions = combat.queuedActions.filter((a) =>
    a.source.kind === "skill" ? isKnown(getSkill, a.source.skillId) : isKnown(getItem, a.source.itemId)
  );
  stripUnknownStatuses(combat.roundStartSnapshot);
  for (const entry of combat.log) {
    stripUnknownStatuses(entry.snapshot);
    const session = entry.session;
    if (!session) continue;
    for (const field of SESSION_ID_LISTS) if (!Array.isArray(session[field])) session[field] = [];
  }
}

/**
 * A save from before the route was recorded: follow the cleared rooms from the entrance, each linked to
 * the next, then end on the room the party stands in.
 */
function reconstructRoomPath(state: GameState): Id[] {
  const rooms = state.floor.rooms;
  const path = [state.floor.entryRoomId];
  for (;;) {
    const last = rooms.find((r) => r.id === path[path.length - 1]);
    const next = last?.connectedRoomIds.find((id) => !path.includes(id) && rooms.find((r) => r.id === id)?.cleared);
    if (next === undefined) break;
    path.push(next);
  }
  if (path[path.length - 1] !== state.currentRoomId) path.push(state.currentRoomId);
  return path;
}

/** Migrates a GameState from an older save shape to the current one. No-op on an already-current save. */
export function migrateGameState(raw: unknown): GameState {
  const state = raw as GameState & { unequippedArtifactIds?: string[]; pendingFloorMilestoneMessage?: string | null };

  if (typeof state.runId !== "string") state.runId = randomUUID();
  if (typeof state.coins !== "number") state.coins = 0;
  if (typeof state.satiety !== "number") state.satiety = BALANCE.survival.initialSatiety;
  if (state.pendingArtifactDecision === undefined) state.pendingArtifactDecision = null;
  if (state.secondJackpotArtifactId === undefined) state.secondJackpotArtifactId = null;
  if (!Array.isArray(state.metNarrativeNpcIds)) state.metNarrativeNpcIds = [];
  if (!state.narrativeCounters)
    state.narrativeCounters = { guardianFightsSkipped: 0, artifactsSacrificed: 0, altarPaymentsCount: 0, guardianGrudgeFiredCount: 0, freeRewardsTakenCount: 0 };
  // Individually guarded (not just the whole-object fallback above) so a save whose narrativeCounters
  // object already exists but predates one of these fields doesn't load with it `undefined` — the
  // next `+= 1` on an undefined counter computes NaN and permanently breaks that counter's threshold
  // checks for the run.
  if (typeof state.narrativeCounters.guardianFightsSkipped !== "number") state.narrativeCounters.guardianFightsSkipped = 0;
  if (typeof state.narrativeCounters.artifactsSacrificed !== "number") state.narrativeCounters.artifactsSacrificed = 0;
  if (typeof state.narrativeCounters.altarPaymentsCount !== "number") state.narrativeCounters.altarPaymentsCount = 0;
  if (typeof state.narrativeCounters.guardianGrudgeFiredCount !== "number") state.narrativeCounters.guardianGrudgeFiredCount = 0;
  if (typeof state.narrativeCounters.freeRewardsTakenCount !== "number") state.narrativeCounters.freeRewardsTakenCount = 0;
  if (!state.eventReflectionStances) state.eventReflectionStances = {};
  if (!state.eventOutcomes) state.eventOutcomes = {};
  if (!Array.isArray(state.firedOnceEventIds)) state.firedOnceEventIds = [];
  if (typeof state.loreExposureCount !== "number") state.loreExposureCount = 0;
  if (state.pendingCampReflectionTier === undefined) state.pendingCampReflectionTier = null;
  if (state.restRunner === undefined) state.restRunner = null;
  if (!Array.isArray(state.roomPath)) state.roomPath = reconstructRoomPath(state);
  if (!Array.isArray(state.pendingBarterBuffs)) state.pendingBarterBuffs = [];
  if (state.barterUsedDepth === undefined) state.barterUsedDepth = null;
  if (!Array.isArray(state.shownFloorMilestoneIds)) state.shownFloorMilestoneIds = [];
  // A milestone screen still pending from a save that stored its text, or whose omen id has since left
  // data/floor-milestones.json, gets a valid omen picked for it. A separate Rng keeps the run's own stream untouched.
  const pendingOmenId = state.pendingFloorMilestoneOmenId;
  if (state.pendingFloorMilestoneMessage || (pendingOmenId && !getFloorMilestoneOmen(pendingOmenId))) {
    const omen = pickFloorMilestoneOmen(state.floor.depth, state.shownFloorMilestoneIds, new Rng(state.floor.depth));
    state.shownFloorMilestoneIds.push(omen.id);
    state.pendingFloorMilestoneOmenId = omen.id;
  }
  delete state.pendingFloorMilestoneMessage;
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
  if (typeof state.runStardust !== "number") state.runStardust = 0;
  if (state.pendingAbilityBuyback === undefined) state.pendingAbilityBuyback = null;
  if (state.abilityDeathResults === undefined) state.abilityDeathResults = null;
  // A save written before Abilities existed can still carry an unread `lastRoomDrops` (saving is
  // allowed from `combatOver`, and the reward screen reads `.abilityIds.length` unguarded).
  if (state.lastRoomDrops && !Array.isArray(state.lastRoomDrops.abilityIds)) state.lastRoomDrops.abilityIds = [];
  for (const character of state.party) {
    if (character.equippedAbilityId === undefined) character.equippedAbilityId = null;
    // Re-derived from class and level, so a skill id renamed in data/classes.json never leaves a saved character holding the old one.
    character.unlockedSkillIds = characterBaseStats(character).unlockedSkillIds;
    for (const counters of [character.cooldownsRemaining, character.usesRemainingThisCombat]) {
      for (const skillId of Object.keys(counters)) if (!isKnown(getSkill, skillId)) delete counters[skillId];
    }
  }
  if (state.combat) migrateCombat(state.combat);

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

  for (const character of state.party) dropUnknownStatuses(character);

  // Same defensive pruning for a since-removed ability id (e.g. a future catalog edit).
  for (const character of state.party) {
    if (character.equippedAbilityId && !ABILITIES.some((a) => a.id === character.equippedAbilityId)) {
      character.equippedAbilityId = null;
    }
  }

  return state;
}

/** Monsters saved before the race/trait system (feat/monster-race-damage-scaling) don't carry
 *  `race`/`subRace`/`traitIds` — backfilled here from the archetype, the same source spawnMonster
 *  reads them from. Without this, any damage effect against such a monster throws inside
 *  `resolveRaceProfile` the instant it's targeted. */
export function migrateMonsters(monsters: Monster[]): Monster[] {
  for (const monster of monsters) {
    dropUnknownStatuses(monster);
    if (monster.race !== undefined) continue;
    const archetype = getArchetype(monster.archetypeId);
    monster.race = archetype.race;
    monster.subRace = archetype.subRace;
    monster.traitIds = archetype.traitIds;
  }
  return monsters;
}

/**
 * Summons are saved with the run. One whose archetype has left `data/summons.json` is dropped, as if
 * it had expired when the save was made (`pruneOrphanedSummonRefs` then clears the fight's refs to
 * it); a survivor can still carry a status whose id has since left the catalog.
 */
export function migrateSummons(summons: Summon[]): Summon[] {
  const known = summons.filter((s) => SUMMON_ARCHETYPES.some((a) => a.id === s.archetypeId));
  for (const summon of known) dropUnknownStatuses(summon);
  return known;
}
