import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameState, Id, Monster } from "../types";
import { Game } from "./game";
import { migrateGameState } from "./migration";
import { recomputeAllPartyStats, MAX_EQUIPPED_ARTIFACTS } from "./party";
import { CLASSES } from "../data/classes";
import { ARTIFACTS } from "../data/artifacts";
import { ABILITIES } from "../data/abilities";
import { MAX_LEVEL } from "../data/levelGrowth";
import { BALANCE } from "../data/balanceConfig";
import { SAVE_DIR } from "./paths";
import { DEV_MODE } from "./devMode";
import pkg from "../../package.json";

/** Save-format version, stamped on every save at write time. Tied to the app's own release version (package.json). */
export const APP_VERSION: string = pkg.version;

/** Sentinel for a save file with no `saveVersion` field (written before this versioning feature existed). */
export const UNVERSIONED = "unversioned";

/**
 * Older save versions still safe to load with the current code. Saves whose version is neither
 * `APP_VERSION` nor listed here are hidden from Continue (file stays on disk, untouched).
 * Add an old version here only after confirming its save shape still loads cleanly via migrateGameState.
 */
export const ALLOWED_LEGACY_SAVE_VERSIONS: string[] = [];

export function isSaveVersionAllowed(version: string | undefined): boolean {
  const normalized = version ?? UNVERSIONED;
  return normalized === APP_VERSION || ALLOWED_LEGACY_SAVE_VERSIONS.includes(normalized);
}

export const NUM_SAVE_SLOTS = 5;
export const SLOT_IDS: readonly Id[] = Array.from({ length: NUM_SAVE_SLOTS }, (_, i) => `slot${i + 1}`);

export interface SaveMeta {
  id: Id;
  timestamp: number;
  floorDepth: number;
  partyLevel: number;
  partyClassIds: Id[];
  /** Absent on saves written before this versioning feature existed. */
  saveVersion?: string;
  /** Absent on saves written before runId existed. */
  runId?: string;
  /** Set only by `writeDevDumpSave` (tools/dev-save-dump). Gates loading — see `isDevDumpAllowed`. */
  devDump?: true;
  /** Seconds played across every session of the run, up to this save. */
  playTime: number;
}

/** A `devDump` save only loads/lists in dev mode — a release binary can never load one, hard-gated
    at compile time via `DEV_MODE`. `devMode` is overridable only so tests can exercise the blocked
    branch; every real call site relies on the default. */
export function isDevDumpAllowed(meta: Pick<SaveMeta, "devDump">, devMode: boolean = DEV_MODE): boolean {
  return !meta.devDump || devMode;
}

export interface SaveFile {
  meta: SaveMeta;
  state: GameState;
  monsters: Monster[];
  rngState: number;
}

/** `meta` is null for an empty slot (or one whose file can't be loaded — see `listSlots`). */
export interface SlotEntry {
  id: Id;
  meta: SaveMeta | null;
}

function ensureSaveDir(): void {
  if (!existsSync(SAVE_DIR)) mkdirSync(SAVE_DIR, { recursive: true });
}

// `id` ends up straight in a filename here — reject anything else so a caller passing an untrusted
// id (e.g. tools/dev-save-dump/server.ts's user-supplied save name) can't write or read outside
// SAVE_DIR via a path-traversal id.
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
    rngState: game.ctx.rng.getState(),
  };
}

function writeSave(game: Game, id: Id, devDump?: true): SaveMeta {
  ensureSaveDir();
  const save = buildSaveFile(game, id, devDump);
  writeFileSync(savePath(id), JSON.stringify(save));
  return save.meta;
}

/** Writes the run to its slot. A run with no slot (tests, dev tools) isn't persisted. */
export function saveRun(game: Game): SaveMeta | null {
  if (!game.currentSaveSlot) return null;
  return writeSave(game, game.currentSaveSlot);
}

/** Only entry point that writes a `devDump` save (tools/dev-save-dump) — refuses outside dev mode
    so the tool can't accidentally produce a save a release binary would then also refuse to load. */
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

// Skips inventory item-id existence on purpose — migrateGameState already prunes unknown ids on
// load, so checking here would hide old-but-valid saves that migration would fix cleanly.
export function isSaveStateValid(state: GameState): boolean {
  if (state.party.length !== BALANCE.party.size) return false;
  for (const c of state.party) {
    if (!existsInCatalog(CLASSES, c.classId)) return false;
    if (!Number.isInteger(c.level) || c.level < 1 || c.level > MAX_LEVEL) return false;
    if (!Number.isFinite(c.hp) || c.hp < 0 || c.hp > c.maxHp) return false;
    if (!Number.isFinite(c.maxHp) || c.maxHp <= 0) return false;
    if (!Number.isFinite(c.mp) || c.mp < 0 || c.mp > c.maxMp) return false;
    if (!Number.isFinite(c.maxMp) || c.maxMp < 0) return false;
    // Debuffs (e.g. Webbed: -20 speed) can legitimately push these negative — only non-finite is invalid.
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

/** Always one entry per slot. A slot whose file is unreadable, from a disallowed version, a dev dump
    outside dev mode, or fails validation reads as empty (the file itself is left on disk). */
export function listSlots(): SlotEntry[] {
  return SLOT_IDS.map((id) => {
    try {
      const save = JSON.parse(readFileSync(savePath(id), "utf8")) as SaveFile;
      const loadable = isSaveVersionAllowed(save.meta.saveVersion) && isDevDumpAllowed(save.meta) && isSaveStateValid(migrateGameState(save.state));
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

// Binds the loaded run to the slot it was read from. Re-validates rather than trusting the caller pre-filtered.
export function gameFromSave(save: SaveFile, id: Id, seed = Date.now()): Game {
  if (!isSaveVersionAllowed(save.meta.saveVersion)) throw new Error(`Save version not allowed: ${save.meta.saveVersion ?? UNVERSIONED}`);
  if (!isDevDumpAllowed(save.meta)) throw new Error("Dev-dump saves can only be loaded in dev mode");
  const state = migrateGameState(save.state);
  if (!isSaveStateValid(state)) throw new Error("Save state failed validation");
  const game = new Game(seed, undefined, { state, monsters: save.monsters, rngState: save.rngState, playTimeSec: save.meta.playTime });
  recomputeAllPartyStats(game.state);
  game.currentSaveSlot = id;
  return game;
}
