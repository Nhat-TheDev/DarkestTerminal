import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GameState, Id, Monster } from "../types";
import { Game } from "./game";
import { migrateGameState } from "./migration";
import { recomputeAllPartyStats, MAX_EQUIPPED_ARTIFACTS } from "./party";
import { CLASSES } from "../data/classes";
import { ARTIFACTS } from "../data/artifacts";
import { MAX_LEVEL } from "../data/levelGrowth";
import { BALANCE } from "../data/balanceConfig";
import { PROFILE_FILENAME } from "./profile";
import pkg from "../../package.json";

const APP_DIR_NAME = "darkest-terminal";

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

function resolveSaveDir(): string {
  if (process.env.DARKEST_TERMINAL_SAVE_DIR) return process.env.DARKEST_TERMINAL_SAVE_DIR;
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_DIR_NAME);
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_DIR_NAME);
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), APP_DIR_NAME);
}

const SAVE_DIR = resolveSaveDir();

export const QUICKSAVE_ID = "quicksave";
export const AUTOSAVE_ID = "autosave";

export interface SaveMeta {
  id: Id;
  timestamp: number;
  floorDepth: number;
  partyLevel: number;
  partyClassIds: Id[];
  /** Absent on saves written before this versioning feature existed. */
  saveVersion?: string;
  /** Absent on saves written before runId existed. Same runId across every save (quick/auto/manual) of one playthrough. */
  runId?: string;
}

export interface SaveFile {
  meta: SaveMeta;
  state: GameState;
  monsters: Monster[];
  rngState: number;
}

function ensureSaveDir(): void {
  if (!existsSync(SAVE_DIR)) mkdirSync(SAVE_DIR, { recursive: true });
}

function savePath(id: Id): string {
  return join(SAVE_DIR, `${id}.json`);
}

function buildSaveFile(game: Game, id: Id): SaveFile {
  return {
    meta: {
      id,
      timestamp: Date.now(),
      floorDepth: game.state.floor.depth,
      partyLevel: game.state.party[0]?.level ?? 1,
      partyClassIds: game.state.party.map((c) => c.classId),
      saveVersion: APP_VERSION,
      runId: game.state.runId,
    },
    state: JSON.parse(JSON.stringify(game.state)),
    monsters: JSON.parse(JSON.stringify(game.ctx.monsters)),
    rngState: game.ctx.rng.getState(),
  };
}

function writeSave(game: Game, id: Id): SaveMeta {
  ensureSaveDir();
  const save = buildSaveFile(game, id);
  writeFileSync(savePath(id), JSON.stringify(save));
  return save.meta;
}

export function manualSave(game: Game): SaveMeta {
  return writeSave(game, `save-${Date.now()}`);
}

export function quickSave(game: Game): SaveMeta {
  return writeSave(game, QUICKSAVE_ID);
}

export function autoSave(game: Game): SaveMeta {
  return writeSave(game, AUTOSAVE_ID);
}

/** Skips unreadable/invalid files silently — including `profile.ts`'s PROFILE_FILENAME, which
    deliberately shares this same directory but isn't a SaveFile. */
function forEachSaveFile(fn: (path: string, save: SaveFile) => void): void {
  if (!existsSync(SAVE_DIR)) return;
  for (const file of readdirSync(SAVE_DIR)) {
    if (!file.endsWith(".json") || file === PROFILE_FILENAME) continue;
    const path = join(SAVE_DIR, file);
    let save: SaveFile;
    try {
      save = JSON.parse(readFileSync(path, "utf8")) as SaveFile;
    } catch {
      continue;
    }
    fn(path, save);
  }
}

/** Invalidates every save (quicksave/autosave/manual) of a run — called on permadeath. */
export function deleteSavesForRun(runId: string): void {
  forEachSaveFile((path, save) => {
    if (save.meta.runId !== runId) return;
    try {
      unlinkSync(path);
    } catch (err) {
      console.error(`Failed to delete save file ${path}:`, err);
    }
  });
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
  }
  if (state.gameOver !== "victory" && state.gameOver !== "defeat" && state.gameOver !== null) return false;
  if (!Number.isInteger(state.floor.depth) || state.floor.depth < 1) return false;
  if (!Number.isInteger(state.coins) || state.coins < 0) return false;
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

export function listSaves(): SaveMeta[] {
  const metas: SaveMeta[] = [];
  forEachSaveFile((_path, save) => {
    if (isSaveVersionAllowed(save.meta.saveVersion) && isSaveStateValid(migrateGameState(save.state))) metas.push(save.meta);
  });
  return metas.sort((a, b) => b.timestamp - a.timestamp);
}

export function loadSave(id: Id): SaveFile {
  return JSON.parse(readFileSync(savePath(id), "utf8")) as SaveFile;
}

// `id` lets a pre-runId save get its freshly-migrated runId written back to itself, so
// deleteSavesForRun can later find it. Re-validates rather than trusting the caller pre-filtered.
export function gameFromSave(save: SaveFile, id: Id, seed = Date.now()): Game {
  if (!isSaveVersionAllowed(save.meta.saveVersion)) throw new Error(`Save version not allowed: ${save.meta.saveVersion ?? UNVERSIONED}`);
  const hadRunId = typeof save.state.runId === "string";
  const state = migrateGameState(save.state);
  if (!isSaveStateValid(state)) throw new Error("Save state failed validation");
  const game = new Game(seed, undefined, { state, monsters: save.monsters, rngState: save.rngState });
  recomputeAllPartyStats(game.state);
  if (!hadRunId) {
    try {
      writeSave(game, id);
    } catch {
    }
  }
  return game;
}
