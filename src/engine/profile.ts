import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Id } from "../types";

/**
 * 10-event-narrative.md Part F.2 — the cross-run persistence layer for Ending 1 (Stay), explicitly
 * flagged in the spec as needing its own design pass. Deliberately independent of `save.ts`'s
 * per-run save files (and never imports from it, or from `./game` — `save.ts` imports `Game`, so a
 * dependency in that direction would be circular): this is profile-level data that outlives any
 * single run's save.
 *
 * Adaptation from the spec, made here rather than guessed at silently: the spec's text names "the
 * specific character who stayed" by a personal name, but this game's `Character.name` is always
 * just its class's display name (`createCharacter(id, cls.name, cls)`, src/engine/game.ts) — there
 * is no separate personal-name system anywhere in the game to draw from. Recording (and later
 * naming) the retired character by class only is therefore the honest fit for how this game's data
 * actually works, not a departure from it — and it happens to still match the world-bible's own
 * "nobody down here exchanges names" principle (11-world-bible.md), which the original spec text
 * was written without checking against.
 */

const APP_DIR_NAME = "darkest-terminal";

function resolveProfileDir(): string {
  if (process.env.DARKEST_TERMINAL_SAVE_DIR) return process.env.DARKEST_TERMINAL_SAVE_DIR;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", APP_DIR_NAME);
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_DIR_NAME);
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), APP_DIR_NAME);
}

const PROFILE_DIR = resolveProfileDir();

/** Lives in the same directory as `save.ts`'s per-run save files (deliberately — 1 app-data
    directory, not 2) — `save.ts`'s `forEachSaveFile` must skip this exact filename, since it
    doesn't have the `SaveFile` shape every other `.json` file in that directory has. */
export const PROFILE_FILENAME = "profile.json";

function profilePath(): string {
  return join(PROFILE_DIR, PROFILE_FILENAME);
}

export interface RetiredCharacter {
  classId: Id;
}

export interface Profile {
  retiredCharacters: RetiredCharacter[];
  /** True once the-one-who-stayed has fired in any run, ever — distinct from any single run's
      `GameState.firedOnceEventIds`, which only tracks the current run. */
  shownRetiredCharacterEvent: boolean;
}

const EMPTY_PROFILE: Profile = { retiredCharacters: [], shownRetiredCharacterEvent: false };

function ensureProfileDir(): void {
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
}

/** Never throws — an unreadable/missing/corrupt profile file is treated the same as "no profile
    yet," matching how `save.ts`'s own forEachSaveFile silently skips unreadable saves. */
export function loadProfile(): Profile {
  if (!existsSync(profilePath())) return { ...EMPTY_PROFILE, retiredCharacters: [] };
  try {
    const parsed = JSON.parse(readFileSync(profilePath(), "utf8")) as Partial<Profile>;
    return {
      retiredCharacters: Array.isArray(parsed.retiredCharacters) ? parsed.retiredCharacters : [],
      shownRetiredCharacterEvent: parsed.shownRetiredCharacterEvent === true,
    };
  } catch {
    return { ...EMPTY_PROFILE, retiredCharacters: [] };
  }
}

function writeProfile(profile: Profile): void {
  ensureProfileDir();
  writeFileSync(profilePath(), JSON.stringify(profile));
}

/** Called once, the moment Ending 1 (Stay) is chosen (`Game.pickEndingChoice`). */
export function addRetiredCharacter(classId: Id): void {
  const profile = loadProfile();
  profile.retiredCharacters.push({ classId });
  writeProfile(profile);
}

/** Called once the-one-who-stayed event actually resolves (`closeEvent`), so it never surfaces
    again in any future run once shown. */
export function markRetiredCharacterEventShown(): void {
  const profile = loadProfile();
  profile.shownRetiredCharacterEvent = true;
  writeProfile(profile);
}
