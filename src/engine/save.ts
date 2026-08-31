import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GameState, Id, Monster } from "../types";
import { Game } from "./game";
import { migrateGameState } from "./migration";
import { recomputeAllPartyStats, MAX_EQUIPPED_ARTIFACTS } from "./party";
import { getClass } from "../data/classes";
import { getArtifact } from "../data/artifacts";
import { MAX_LEVEL } from "../data/levelGrowth";
import { BALANCE } from "../data/balanceConfig";
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
export const ALLOWED_LEGACY_SAVE_VERSIONS: string[] = ["0.1.2"];

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

/** Deletes every save (quicksave/autosave/manual) belonging to the given run. Used to invalidate them on permadeath. */
export function deleteSavesForRun(runId: string): void {
  if (!existsSync(SAVE_DIR)) return;
  for (const file of readdirSync(SAVE_DIR)) {
    if (!file.endsWith(".json")) continue;
    const path = join(SAVE_DIR, file);
    try {
      const save = JSON.parse(readFileSync(path, "utf8")) as SaveFile;
      if (save.meta.runId === runId) unlinkSync(path);
    } catch {
    }
  }
}

/**
 * Structural/range sanity check on a loaded GameState, independent of saveVersion. Catches both
 * corrupted files and hand-edited saves with nonsensical values (e.g. negative coins, HP above max).
 * Deliberately does NOT check that inventory item ids still exist in the catalog — migrateGameState
 * already strips unknown item ids on load, so flagging that here would hide old-but-valid saves
 * that migration would have fixed cleanly.
 */
export function isSaveStateValid(state: GameState): boolean {
  if (state.party.length !== BALANCE.party.size) return false;
  for (const c of state.party) {
    try {
      getClass(c.classId);
    } catch {
      return false;
    }
    if (!Number.isInteger(c.level) || c.level < 1 || c.level > MAX_LEVEL) return false;
    if (!Number.isFinite(c.hp) || c.hp < 0 || c.hp > c.maxHp) return false;
    if (!Number.isFinite(c.maxHp) || c.maxHp <= 0) return false;
    if (!Number.isFinite(c.mp) || c.mp < 0 || c.mp > c.maxMp) return false;
    if (!Number.isFinite(c.maxMp) || c.maxMp < 0) return false;
    if (c.attack < 0 || c.defense < 0 || c.magicPower < 0 || c.aggro < 0 || c.speed < 0) return false;
    if (c.equippedArtifactIds.length > MAX_EQUIPPED_ARTIFACTS) return false;
    for (const artifactId of c.equippedArtifactIds) {
      try {
        getArtifact(artifactId);
      } catch {
        return false;
      }
    }
  }
  if (state.gameOver !== "victory" && state.gameOver !== "defeat" && state.gameOver !== null) return false;
  if (!Number.isInteger(state.floor.depth) || state.floor.depth < 1) return false;
  if (!Number.isInteger(state.coins) || state.coins < 0) return false;
  if (!Number.isFinite(state.satiety) || state.satiety < 0 || state.satiety > 100) return false;
  for (const count of Object.values(state.inventory)) {
    if (!Number.isInteger(count) || count < 0) return false;
  }
  return true;
}

export function listSaves(): SaveMeta[] {
  if (!existsSync(SAVE_DIR)) return [];
  const metas: SaveMeta[] = [];
  for (const file of readdirSync(SAVE_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const save = JSON.parse(readFileSync(join(SAVE_DIR, file), "utf8")) as SaveFile;
      if (isSaveVersionAllowed(save.meta.saveVersion) && isSaveStateValid(migrateGameState(save.state))) metas.push(save.meta);
    } catch {
    }
  }
  return metas.sort((a, b) => b.timestamp - a.timestamp);
}

export function loadSave(id: Id): SaveFile {
  return JSON.parse(readFileSync(savePath(id), "utf8")) as SaveFile;
}

export function gameFromSave(save: SaveFile, seed = Date.now()): Game {
  const state = migrateGameState(save.state);
  const game = new Game(seed, undefined, { state, monsters: save.monsters, rngState: save.rngState });
  recomputeAllPartyStats(game.state);
  return game;
}
