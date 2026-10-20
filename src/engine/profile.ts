import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Id, AbilityProfile } from "../types";
import { ABILITIES } from "../data/abilities";
import { SAVE_DIR } from "./paths";

/**
 * Survives permadeath's slot-clear; one global file shared by every slot. Never import `./save` or
 * `./game` here: they import this module, so the dependency would be circular.
 */
export const PROFILE_FILENAME = "profile.json";
const PROFILE_PATH = join(SAVE_DIR, PROFILE_FILENAME);
const CURRENT_VERSION = 1;

export interface RetiredCharacter {
  classId: Id;
}

export interface Profile extends AbilityProfile {
  retiredCharacters: RetiredCharacter[];
  /** Across all runs, unlike `GameState.firedOnceEventIds`. */
  shownRetiredCharacterEvent: boolean;
}

function defaultProfile(): Profile {
  return { version: CURRENT_VERSION, unlockedAbilityIds: [], retiredCharacters: [], shownRetiredCharacterEvent: false };
}

function isKnownAbility(id: Id): boolean {
  return ABILITIES.some((a) => a.id === id);
}

/** A missing or unparseable file means only commons are available; unknown ids are pruned. */
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

export function addRetiredCharacter(classId: Id): void {
  const profile = loadProfile();
  profile.retiredCharacters.push({ classId });
  saveProfile(profile);
}

export function markRetiredCharacterEventShown(): void {
  const profile = loadProfile();
  profile.shownRetiredCharacterEvent = true;
  saveProfile(profile);
}

/** Does not persist; call `saveProfile` after. */
export function unlockAbility(profile: Profile, id: Id): void {
  if (!profile.unlockedAbilityIds.includes(id)) profile.unlockedAbilityIds.push(id);
}

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
