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
import { expCostForLevel, MAX_LEVEL } from "../data/levelGrowth";

/** Whether `version` is a plain "x.y.z" release version, the only form a save is stamped with. */
export function isVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/** Orders "x.y.z" versions field by field, numerically (1.2.0 < 1.10.0). Throws on any other form. */
export function compareVersions(a: string, b: string): number {
  for (const v of [a, b]) if (!isVersion(v)) throw new Error(`Not an x.y.z version: ${v}`);
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = pa[i]! - pb[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The EXP cost of one level on 1.1.0's curve, for the levels 1.1.1 changed. A record of a released
 * version, not a balance value: it never follows `data/level-growth.json`.
 */
const V1_1_0_EXP_TIERS = [
  { maxLevel: 5, expCost: 115 },
  { maxLevel: 10, expCost: 135 },
  { maxLevel: 15, expCost: 150 },
  { maxLevel: 20, expCost: 165 },
  { maxLevel: 25, expCost: 195 },
  { maxLevel: 30, expCost: 255 },
];

let v1_1_0Costs: number[] | undefined;

/** Cumulative EXP to reach each level on 1.1.0's curve, indexed by level, built once. Levels past the tiers above cost what they cost now. */
function v1_1_0ExpCosts(): number[] {
  if (v1_1_0Costs) return v1_1_0Costs;
  const costs = [0, 0];
  for (let level = 2; level <= MAX_LEVEL; level++) {
    const tier = V1_1_0_EXP_TIERS.find((t) => level <= t.maxLevel);
    costs[level] = costs[level - 1]! + (tier ? tier.expCost : expCostForLevel(level) - expCostForLevel(level - 1));
  }
  return (v1_1_0Costs = costs);
}

/**
 * 1.1.1 raised the EXP cost of levels 2-30. The party keeps its level and its progress toward the
 * next one, as a share of that level's cost, held inside the level so the EXP never reaches the next
 * threshold or drops below its own. A fight's party snapshots are rescaled the same way, each at the
 * level its own EXP reached, since a snapshot can predate a level-up.
 */
function migrateToV1_1_1(state: GameState): void {
  const oldCosts = v1_1_0ExpCosts();
  const oldLevel = (exp: number) => {
    let level = 1;
    while (level < MAX_LEVEL && exp >= oldCosts[level + 1]!) level++;
    return level;
  };
  const rescale = (exp: number, level: number) => {
    const into = exp - oldCosts[level]!;
    if (level >= MAX_LEVEL) return expCostForLevel(level) + Math.max(0, into);
    const oldSpan = oldCosts[level + 1]! - oldCosts[level]!;
    const span = expCostForLevel(level + 1) - expCostForLevel(level);
    return expCostForLevel(level) + Math.min(span - 1, Math.max(0, Math.floor((into * span) / oldSpan)));
  };
  state.partyExp = rescale(state.partyExp, state.party[0]?.level ?? oldLevel(state.partyExp));
  const combat = state.combat;
  if (!combat) return;
  const snapshots = new Set([combat.roundStartPartySnapshot, ...combat.log.map((entry) => entry.partySnapshot)]);
  for (const snapshot of snapshots) if (snapshot) snapshot.partyExp = rescale(snapshot.partyExp, oldLevel(snapshot.partyExp));
}

/**
 * One step per release that changed what a saved value means, oldest first. Each step upgrades a
 * save written by the release before it to `version`; a save runs every step newer than its own
 * version, in order. Saves load from `OLDEST_LOADABLE_SAVE_VERSION` (save.ts) up to the current version.
 */
const VERSION_MIGRATIONS: { version: string; migrate: (state: GameState) => void }[] = [{ version: "1.1.1", migrate: migrateToV1_1_1 }];

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
  "fearChangedIds",
  "debuffLandedIds",
  "dotLandedIds",
  "immuneIds",
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

/**
 * Migrates a GameState from an older save shape to the current one. No-op on an already-current save.
 * `saveVersion` is the version stamped on the save: every `VERSION_MIGRATIONS` step newer than it
 * runs first, oldest first. Without it no version step runs.
 */
export function migrateGameState(raw: unknown, saveVersion?: string): GameState {
  const state = raw as GameState & { unequippedArtifactIds?: string[]; pendingFloorMilestoneMessage?: string | null };

  if (saveVersion !== undefined) {
    for (const step of VERSION_MIGRATIONS) if (compareVersions(step.version, saveVersion) > 0) step.migrate(state);
  }

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
  if (typeof state.pendingGatekeeper !== "boolean") state.pendingGatekeeper = false;
  if (state.gatekeeperAnswer === undefined) state.gatekeeperAnswer = null;
  if (typeof state.blessingRoomsLeft !== "number") state.blessingRoomsLeft = 0;
  if (state.blessedRoomId === undefined) state.blessedRoomId = null;
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
