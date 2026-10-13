import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CombatantRef, GameState, Id, Monster, Summon } from "../types";
import { Game } from "./game";
import { compareVersions, isVersion, migrateGameState, migrateMonsters, migrateSummons } from "./migration";
import { recomputeAllPartyStats, MAX_EQUIPPED_ARTIFACTS } from "./party";
import { CLASSES } from "../data/classes";
import { ARTIFACTS } from "../data/artifacts";
import { ABILITIES } from "../data/abilities";
import { MONSTER_SKILLS } from "../data/monsters";
import { MAX_LEVEL } from "../data/levelGrowth";
import { BALANCE } from "../data/balanceConfig";
import { SAVE_DIR } from "./paths";
import { DEV_MODE } from "./devMode";
import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;

export const UNVERSIONED = "unversioned";

/** Saves outside this..APP_VERSION are hidden from Continue but left on disk. Raise only to drop support for older saves. */
export const OLDEST_LOADABLE_SAVE_VERSION = "1.1.0";

export function isSaveVersionAllowed(version: string | undefined): boolean {
  if (version === undefined || !isVersion(version)) return false;
  return compareVersions(version, OLDEST_LOADABLE_SAVE_VERSION) >= 0 && compareVersions(version, APP_VERSION) <= 0;
}

export const NUM_SAVE_SLOTS = 5;
export const SLOT_IDS: readonly Id[] = Array.from({ length: NUM_SAVE_SLOTS }, (_, i) => `slot${i + 1}`);

export interface SaveMeta {
  id: Id;
  timestamp: number;
  floorDepth: number;
  partyLevel: number;
  partyClassIds: Id[];
  saveVersion?: string;
  runId?: string;
  /** Set only by `writeDevDumpSave`; see `isDevDumpAllowed`. */
  devDump?: true;
  /** Seconds, across every session of the run. */
  playTime: number;
}

/** `devMode` is a parameter only so tests can exercise the blocked branch. */
export function isDevDumpAllowed(meta: Pick<SaveMeta, "devDump">, devMode: boolean = DEV_MODE): boolean {
  return !meta.devDump || devMode;
}

export interface SaveFile {
  meta: SaveMeta;
  state: GameState;
  monsters: Monster[];
  rngState: number;
  /** Absent means `[]`. */
  summons?: Summon[];
}

export interface SlotEntry {
  id: Id;
  meta: SaveMeta | null;
}

function ensureSaveDir(): void {
  if (!existsSync(SAVE_DIR)) mkdirSync(SAVE_DIR, { recursive: true });
}

// `id` goes straight into a filename and can be user input (dev save dump): block path traversal.
const SAFE_SAVE_ID = /^[A-Za-z0-9_-]+$/;

function savePath(id: Id): string {
  if (!SAFE_SAVE_ID.test(id)) throw new Error(`Invalid save id: ${id}`);
  return join(SAVE_DIR, `${id}.json`);
}

function buildSaveFile(game: Game, id: Id, devDump?: true): SaveFile {
  return {
    meta: {
      id,
      timestamp: Date.now(),
      floorDepth: game.state.floor.depth,
      partyLevel: game.state.party[0]?.level ?? 1,
      partyClassIds: game.state.party.map((c) => c.classId),
      saveVersion: APP_VERSION,
      runId: game.state.runId,
      playTime: game.playTimeSec(),
      ...(devDump ? { devDump } : {}),
    },
    state: JSON.parse(JSON.stringify(game.state)),
    monsters: JSON.parse(JSON.stringify(game.ctx.monsters)),
    summons: JSON.parse(JSON.stringify(game.ctx.summons)),
    rngState: game.ctx.rng.getState(),
  };
}

function writeSave(game: Game, id: Id, devDump?: true): SaveMeta {
  ensureSaveDir();
  const save = buildSaveFile(game, id, devDump);
  writeFileSync(savePath(id), JSON.stringify(save));
  return save.meta;
}

export function saveRun(game: Game): SaveMeta | null {
  if (!game.currentSaveSlot) return null;
  return writeSave(game, game.currentSaveSlot);
}

export function writeDevDumpSave(game: Game, id: Id): SaveMeta {
  if (!DEV_MODE) throw new Error("writeDevDumpSave is only available in dev mode");
  return writeSave(game, id, true);
}

export function deleteSlot(id: Id): void {
  const path = savePath(id);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch (err) {
    console.error(`Failed to delete save file ${path}:`, err);
  }
}

function existsInCatalog<T extends { id: Id }>(catalog: T[], id: Id): boolean {
  return catalog.some((entry) => entry.id === id);
}

const isCount = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 0;
const areCounts = (record: Record<Id, number> | undefined): boolean => record === undefined || Object.values(record).every(isCount);

/** Refuses a hand-edited or truncated guard-room monster state here rather than on some later turn. */
export function isSaveMonstersValid(monsters: Monster[]): boolean {
  const ids = new Set(monsters.map((m) => m.id));
  return monsters.every((m) => {
    if (!areCounts(m.skillCooldowns) || !areCounts(m.skillUses)) return false;
    if (m.enteredPhaseIndexes !== undefined && !(Array.isArray(m.enteredPhaseIndexes) && m.enteredPhaseIndexes.every(isCount))) return false;
    if (m.charging !== undefined) {
      if (!existsInCatalog(MONSTER_SKILLS, m.charging.skillId)) return false;
      if (!Array.isArray(m.charging.targetIds) || !m.charging.targetIds.every((id) => typeof id === "string")) return false;
    }
    if (m.shell !== undefined) {
      if (m.shell.state !== "intact" && m.shell.state !== "broken") return false;
      if (!isCount(m.shell.hitsLeft) || !isCount(m.shell.ownTurnsSinceBreak)) return false;
    }
    return m.summonerId === undefined || ids.has(m.summonerId);
  });
}

// Inventory item ids aren't checked: migrateGameState prunes unknown ones.
export function isSaveStateValid(state: GameState): boolean {
  if (state.party.length !== BALANCE.party.size) return false;
  for (const c of state.party) {
    if (!existsInCatalog(CLASSES, c.classId)) return false;
    if (!Number.isInteger(c.level) || c.level < 1 || c.level > MAX_LEVEL) return false;
    if (!Number.isFinite(c.hp) || c.hp < 0 || c.hp > c.maxHp) return false;
    if (!Number.isFinite(c.maxHp) || c.maxHp <= 0) return false;
    if (!Number.isFinite(c.mp) || c.mp < 0 || c.mp > c.maxMp) return false;
    if (!Number.isFinite(c.maxMp) || c.maxMp < 0) return false;
    // Debuffs can push these negative; only non-finite is invalid.
    if (!Number.isFinite(c.attack) || !Number.isFinite(c.defense) || !Number.isFinite(c.magicPower) || !Number.isFinite(c.aggro) || !Number.isFinite(c.speed)) {
      return false;
    }
    if (c.equippedArtifactIds.length > MAX_EQUIPPED_ARTIFACTS) return false;
    for (const artifactId of c.equippedArtifactIds) {
      if (!existsInCatalog(ARTIFACTS, artifactId)) return false;
    }
    if (c.equippedAbilityId != null && !existsInCatalog(ABILITIES, c.equippedAbilityId)) return false;
  }
  if (state.gameOver !== "victory" && state.gameOver !== "defeat" && state.gameOver !== null) return false;
  if (!Number.isInteger(state.floor.depth) || state.floor.depth < 1) return false;
  if (!Number.isInteger(state.coins) || state.coins < 0) return false;
  if (!Number.isInteger(state.runStardust) || state.runStardust < 0) return false;
  if (!Number.isFinite(state.satiety) || state.satiety < 0 || state.satiety > 100) return false;
  for (const count of Object.values(state.inventory)) {
    if (!Number.isInteger(count) || count < 0) return false;
  }
  if (state.combat !== null) {
    const combat = state.combat;
    if (combat.phase !== "command" && combat.phase !== "resolution" && combat.phase !== "over") return false;
    if (!Number.isInteger(combat.roundNumber) || combat.roundNumber < 1) return false;
    if (!Number.isInteger(combat.activeTurnIndex) || combat.activeTurnIndex < 0) return false;
  }
  return true;
}

/** A slot that can't be loaded reads as empty; its file stays on disk. */
export function listSlots(): SlotEntry[] {
  return SLOT_IDS.map((id) => {
    try {
      const save = JSON.parse(readFileSync(savePath(id), "utf8")) as SaveFile;
      const loadable =
        isSaveVersionAllowed(save.meta.saveVersion) &&
        isDevDumpAllowed(save.meta) &&
        isSaveStateValid(migrateGameState(save.state, save.meta.saveVersion)) &&
        isSaveMonstersValid(save.monsters ?? []);
      return { id, meta: loadable ? save.meta : null };
    } catch {
      return { id, meta: null };
    }
  });
}

export function firstFreeSlotId(): Id | null {
  return listSlots().find((slot) => slot.meta === null)?.id ?? null;
}

export function loadSave(id: Id): SaveFile {
  return JSON.parse(readFileSync(savePath(id), "utf8")) as SaveFile;
}

// A ref to a summon that wasn't saved (or that `migrateSummons` dropped) would make `getActorByRef`
// throw. Drop it as if the summon had expired, along with the buffs linked to it.
function pruneOrphanedSummonRefs(state: GameState, summons: Summon[]): void {
  const validIds = new Set(summons.map((s) => s.id));
  for (const character of state.party) {
    character.activeStatusEffects = character.activeStatusEffects.filter((s) => s.linkedSummonId === undefined || validIds.has(s.linkedSummonId));
  }
  const combat = state.combat;
  if (!combat) return;
  const isOrphaned = (ref: CombatantRef) => ref.kind === "summon" && !validIds.has(ref.id);
  combat.combatants = combat.combatants.filter((c) => !isOrphaned(c.ref));
  combat.turnQueue = combat.turnQueue.filter((ref) => !isOrphaned(ref));
  combat.queuedActions = combat.queuedActions.filter((a) => !isOrphaned(a.actor)).map((a) => ({ ...a, targets: a.targets.filter((t) => !isOrphaned(t)) }));
}

// Re-validates rather than trusting the caller pre-filtered.
export function gameFromSave(save: SaveFile, id: Id, seed = Date.now()): Game {
  if (!isSaveVersionAllowed(save.meta.saveVersion)) throw new Error(`Save version not allowed: ${save.meta.saveVersion ?? UNVERSIONED}`);
  if (!isDevDumpAllowed(save.meta)) throw new Error("Dev-dump saves can only be loaded in dev mode");
  const state = migrateGameState(save.state, save.meta.saveVersion);
  if (!isSaveStateValid(state)) throw new Error("Save state failed validation");
  const monsters = migrateMonsters(save.monsters);
  if (!isSaveMonstersValid(monsters)) throw new Error("Save state failed validation");
  const summons = migrateSummons(save.summons ?? []);
  pruneOrphanedSummonRefs(state, summons);
  const game = new Game(seed, undefined, { state, monsters, summons, rngState: save.rngState, playTimeSec: save.meta.playTime });
  recomputeAllPartyStats(game.state);
  game.currentSaveSlot = id;
  return game;
}
