import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Id, AbilityProfile } from "../types";
import { ABILITIES } from "../data/abilities";
import { SAVE_DIR } from "./save";

/**
 * `profile.json` — the one piece of state that survives permadeath's save-wipe
 * (`deleteSavesForRun`). A single global file per install, shared by every save slot, never part of
 * any `SaveFile`. `11-abilities.md` §11.1 "The persistent profile".
 * Also stores cross-run narrative state (Ending 1's `RetiredCharacter`).
 */
export const PROFILE_FILENAME = "profile.json";
const PROFILE_PATH = join(SAVE_DIR, PROFILE_FILENAME);
const CURRENT_VERSION = 1;

export interface RetiredCharacter {
  classId: Id;
}

export interface Profile extends AbilityProfile {
  retiredCharacters: RetiredCharacter[];
  /** True once the-one-who-stayed has fired in any run, ever — distinct from any single run's
      `GameState.firedOnceEventIds`, which only tracks the current run. */
  shownRetiredCharacterEvent: boolean;
}

function defaultProfile(): Profile {
  return { version: CURRENT_VERSION, unlockedAbilityIds: [], retiredCharacters: [], shownRetiredCharacterEvent: false };
}

function isKnownAbility(id: Id): boolean {
  return ABILITIES.some((a) => a.id === id);
}

/** A fresh install (no `profile.json` yet), or one that fails to parse, is treated as "only commons available" — never a hard error. Prunes ids no longer in the catalog, the same defensive stance `migrateGameState` takes for inventory items. */
export function loadProfile(): Profile {
  if (!existsSync(PROFILE_PATH)) return defaultProfile();
  try {
    const raw = JSON.parse(readFileSync(PROFILE_PATH, "utf8")) as Partial<Profile>;
    const unlockedAbilityIds = Array.isArray(raw.unlockedAbilityIds) ? raw.unlockedAbilityIds.filter(isKnownAbility) : [];
    return {
      version: CURRENT_VERSION,
      unlockedAbilityIds,
      retiredCharacters: Array.isArray(raw.retiredCharacters) ? raw.retiredCharacters : [],
      shownRetiredCharacterEvent: raw.shownRetiredCharacterEvent === true,
    };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: Profile): void {
  if (!existsSync(SAVE_DIR)) mkdirSync(SAVE_DIR, { recursive: true });
  writeFileSync(PROFILE_PATH, JSON.stringify(profile));
}

/** Called once, the moment Ending 1 (Stay) is chosen (`Game.pickEndingChoice`). */
export function addRetiredCharacter(classId: Id): void {
  const profile = loadProfile();
  profile.retiredCharacters.push({ classId });
  saveProfile(profile);
}

/** Called once the-one-who-stayed event actually resolves (`closeEvent`), so it never surfaces
    again in any future run once shown. */
export function markRetiredCharacterEventShown(): void {
  const profile = loadProfile();
  profile.shownRetiredCharacterEvent = true;
  saveProfile(profile);
}

/** Adds `id` if not already unlocked (no-op otherwise, including for `common` ids which never need this). Does not persist — call `saveProfile` after. */
export function unlockAbility(profile: Profile, id: Id): void {
  if (!profile.unlockedAbilityIds.includes(id)) profile.unlockedAbilityIds.push(id);
}

/** Strikes `id` from the unlocked list — the guaranteed-loss half of the death flow. No-op if it wasn't there (e.g. a `common` ability, which was never in this list to begin with). */
export function lockAbility(profile: Profile, id: Id): void {
  const idx = profile.unlockedAbilityIds.indexOf(id);
  if (idx !== -1) profile.unlockedAbilityIds.splice(idx, 1);
}

export function isAbilityUnlocked(profile: Profile, id: Id): boolean {
  return getAbilityRarity(id) === "common" || profile.unlockedAbilityIds.includes(id);
}

function getAbilityRarity(id: Id): string | undefined {
  return ABILITIES.find((a) => a.id === id)?.rarity;
}
