import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GameState, Id, Monster } from "../types";
import { Game } from "./game";
import { migrateGameState } from "./migration";
import { recomputeAllPartyStats } from "./party";
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

export function listSaves(): SaveMeta[] {
  if (!existsSync(SAVE_DIR)) return [];
  const metas: SaveMeta[] = [];
  for (const file of readdirSync(SAVE_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const save = JSON.parse(readFileSync(join(SAVE_DIR, file), "utf8")) as SaveFile;
      if (isSaveVersionAllowed(save.meta.saveVersion)) metas.push(save.meta);
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
