import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Id, AbilityProfile } from "../types";
import { ABILITIES } from "../data/abilities";
import { SAVE_DIR } from "./paths";
import { renamedClassId } from "./migration";

/**
 * One profile per save slot, kept beside the slot's run file and surviving its permadeath clear. Never import
 * `./save` or `./game` here: they import this module, so the dependency would be circular.
 */
export const LEGACY_PROFILE_FILENAME = "profile.json";
const CURRENT_VERSION = 1;

export interface RetiredCharacter {
  classId: Id;
}

export interface Profile extends AbilityProfile {
  retiredCharacters: RetiredCharacter[];
  /** Across all runs in the slot, unlike `GameState.firedOnceEventIds`. */
  shownRetiredCharacterEvent: boolean;
  /** Runs started in the slot; the current or last one is this number. */
  runCount: number;
}

export function profileFilename(slotId: Id): string {
  return `${slotId}.profile.json`;
}

function profilePath(slotId: Id): string {
  return join(SAVE_DIR, profileFilename(slotId));
}

function defaultProfile(): Profile {
  return { version: CURRENT_VERSION, unlockedAbilityIds: [], retiredCharacters: [], shownRetiredCharacterEvent: false, runCount: 0 };
}

function isKnownAbility(id: Id): boolean {
  return ABILITIES.some((a) => a.id === id);
}

/** Unknown ids are pruned. */
export function parseProfile(text: string): Profile {
  const raw = JSON.parse(text) as Partial<Profile>;
  return {
    version: CURRENT_VERSION,
    unlockedAbilityIds: Array.isArray(raw.unlockedAbilityIds) ? raw.unlockedAbilityIds.filter(isKnownAbility) : [],
    retiredCharacters: Array.isArray(raw.retiredCharacters) ? raw.retiredCharacters.map((r) => ({ classId: renamedClassId(r.classId) })) : [],
    shownRetiredCharacterEvent: raw.shownRetiredCharacterEvent === true,
    runCount: Number.isInteger(raw.runCount) && (raw.runCount as number) > 0 ? (raw.runCount as number) : 0,
  };
}

/** No slot, a missing file or an unparseable one all mean a fresh profile: only commons are available. */
export function loadProfile(slotId: Id | null): Profile {
  if (!slotId || !existsSync(profilePath(slotId))) return defaultProfile();
  try {
    return parseProfile(readFileSync(profilePath(slotId), "utf8"));
  } catch {
    return defaultProfile();
  }
}

/** A run with no slot keeps nothing. */
export function saveProfile(slotId: Id | null, profile: Profile): void {
  if (!slotId) return;
  if (!existsSync(SAVE_DIR)) mkdirSync(SAVE_DIR, { recursive: true });
  writeFileSync(profilePath(slotId), JSON.stringify(profile));
}

export function deleteProfile(slotId: Id): void {
  const path = profilePath(slotId);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch (err) {
    console.error(`Failed to delete profile file ${path}:`, err);
  }
}

export function beginRun(slotId: Id): void {
  const profile = loadProfile(slotId);
  profile.runCount += 1;
  saveProfile(slotId, profile);
}

export function addRetiredCharacter(slotId: Id | null, classId: Id): void {
  const profile = loadProfile(slotId);
  profile.retiredCharacters.push({ classId });
  saveProfile(slotId, profile);
}

export function markRetiredCharacterEventShown(slotId: Id | null): void {
  const profile = loadProfile(slotId);
  profile.shownRetiredCharacterEvent = true;
  saveProfile(slotId, profile);
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
