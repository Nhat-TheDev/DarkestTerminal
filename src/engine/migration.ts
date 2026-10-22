import { randomUUID } from "node:crypto";
import type { ActiveStatusEffect, CombatantSnapshot, CombatState, GameState, Id, LogSession, Monster, Summon } from "../types";
import { MAX_EQUIPPED_ARTIFACTS, characterBaseStats } from "./party";
import { Rng } from "./rng";
import { getItem } from "../data/items";
import { getClass, getSkill } from "../data/classes";
import { SUMMON_ARCHETYPES } from "../data/summons";
import { getStatusEffect } from "../data/statusEffects";
import { ABILITIES } from "../data/abilities";
import { BALANCE } from "../data/balanceConfig";
import { getArchetype } from "../data/monsters";
import { getFloorMilestoneOmen, pickFloorMilestoneOmen } from "../data/floorMilestones";
import { expCostForLevel, MAX_LEVEL } from "../data/levelGrowth";

export function isVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

/** Numeric per field, so 1.2.0 < 1.10.0. */
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

/** 1.1.0's per-level EXP cost for the levels 1.1.1 changed: a frozen record, never follows `data/level-growth.json`. */
const V1_1_0_EXP_TIERS = [
  { maxLevel: 5, expCost: 115 },
  { maxLevel: 10, expCost: 135 },
  { maxLevel: 15, expCost: 150 },
  { maxLevel: 20, expCost: 165 },
  { maxLevel: 25, expCost: 195 },
  { maxLevel: 30, expCost: 255 },
];

let v1_1_0Costs: number[] | undefined;

/** Cumulative EXP by level on 1.1.0's curve; levels past the tiers cost what they cost now. */
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
 * Saves before 1.1.1, which raised the cost of levels 2-30. Progress into the level keeps its share
 * of that level's cost, clamped inside it. Each snapshot rescales at its own level, since one can predate a level-up.
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

/** Class ids 1.2.0 renamed, with the old display name a character carried: a frozen record, never follows `data/classes.json`. */
const V1_2_0_CLASS_RENAMES: Record<Id, { id: Id; oldName: string }> = { vanguard: { id: "knight", oldName: "Vanguard" } };

export function renamedClassId(id: Id): Id {
  return V1_2_0_CLASS_RENAMES[id]?.id ?? id;
}

/** Saves before 1.2.0, which renamed the Vanguard to the Knight. A character's name is its class name. */
function migrateToV1_2_0(state: GameState): void {
  for (const character of state.party) {
    const rename = V1_2_0_CLASS_RENAMES[character.classId];
    if (!rename) continue;
    character.classId = rename.id;
    if (character.name === rename.oldName) character.name = getClass(rename.id).name;
  }
  if (state.retiredCharacterClassId) state.retiredCharacterClassId = renamedClassId(state.retiredCharacterClassId);
}

/** One step per release that changed what a saved value means, oldest first. */
const VERSION_MIGRATIONS: { version: string; migrate: (state: GameState) => void }[] = [
  { version: "1.1.1", migrate: migrateToV1_1_1 },
  { version: "1.2.0", migrate: migrateToV1_2_0 },
];

/**
 * A status whose id left the catalog would throw on its next lookup. Its stat change was applied
 * straight onto the bearer, so take it back; only characters get recomputed on load.
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

function isKnown(lookup: (id: Id) => unknown, id: Id): boolean {
  try {
    lookup(id);
    return true;
  } catch {
    return false;
  }
}

/** Snapshots are display-only: no stat to take back. */
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
 * Dropping a queued action with an unknown id is safe: a skill commits nothing until it executes,
 * and an item's stock left the inventory with its id. The character is asked for a new action.
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

/** Without `saveVersion`, no `VERSION_MIGRATIONS` step runs. */
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
  // Guarded per field: an object predating one would hold `undefined`, and `+= 1` makes it NaN for the run.
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
  // A pending milestone stored as text, or with an unknown omen id, gets a new omen. A separate Rng keeps the run's stream untouched.
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
  // Same ineligibility marker the Game constructor sets; without it the event renders a raw {{class}} placeholder.
  if (!state.retiredCharacterClassId && !state.firedOnceEventIds.includes("the-one-who-stayed")) {
    state.firedOnceEventIds.push("the-one-who-stayed");
  }
  if (typeof state.runStardust !== "number") state.runStardust = 0;
  if (state.pendingAbilityBuyback === undefined) state.pendingAbilityBuyback = null;
  if (state.abilityDeathResults === undefined) state.abilityDeathResults = null;
  // Saving is allowed from `combatOver`, and the reward screen reads `abilityIds` unguarded.
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

  // A legacy shared pool of unequipped artifacts: each goes to the first open slot, or is dropped.
  const legacyPool = state.unequippedArtifactIds;
  if (legacyPool && legacyPool.length > 0) {
    for (const artifactId of legacyPool) {
      const target = state.party.find((c) => c.equippedArtifactIds.length < MAX_EQUIPPED_ARTIFACTS);
      if (target) target.equippedArtifactIds.push(artifactId);
    }
  }
  delete state.unequippedArtifactIds;

  for (const id of Object.keys(state.inventory)) {
    try {
      getItem(id);
    } catch {
      delete state.inventory[id];
    }
  }

  for (const character of state.party) dropUnknownStatuses(character);

  for (const character of state.party) {
    if (character.equippedAbilityId && !ABILITIES.some((a) => a.id === character.equippedAbilityId)) {
      character.equippedAbilityId = null;
    }
  }

  return state;
}

/** Monsters saved without `race`/`subRace`/`traitIds` would throw in `resolveRaceProfile` when hit. */
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

/** A summon with an unknown archetype is dropped as if expired; `pruneOrphanedSummonRefs` clears the fight's refs to it. */
export function migrateSummons(summons: Summon[]): Summon[] {
  const known = summons.filter((s) => SUMMON_ARCHETYPES.some((a) => a.id === s.archetypeId));
  for (const summon of known) dropUnknownStatuses(summon);
  return known;
}
