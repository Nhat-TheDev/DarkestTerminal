import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AbilityProfile, Id } from "../types";
import { ABILITIES } from "../data/abilities";
import { SAVE_DIR } from "./save";

/**
 * `profile.json` — the one piece of state that survives permadeath's save-wipe
 * (`deleteSavesForRun`). A single global file per install, shared by every save slot, never part of
 * any `SaveFile`. `11-abilities.md` §11.1 "The persistent profile".
 */
const PROFILE_PATH = join(SAVE_DIR, "profile.json");

const CURRENT_VERSION = 1;

function defaultProfile(): AbilityProfile {
  return { version: CURRENT_VERSION, unlockedAbilityIds: [] };
}

function isKnownAbility(id: Id): boolean {
  return ABILITIES.some((a) => a.id === id);
}

/** A fresh install (no `profile.json` yet), or one that fails to parse, is treated as "only commons available" — never a hard error. Prunes ids no longer in the catalog, the same defensive stance `migrateGameState` takes for inventory items. */
export function loadProfile(): AbilityProfile {
  if (!existsSync(PROFILE_PATH)) return defaultProfile();
  try {
    const raw = JSON.parse(readFileSync(PROFILE_PATH, "utf8")) as Partial<AbilityProfile>;
    const unlockedAbilityIds = Array.isArray(raw.unlockedAbilityIds) ? raw.unlockedAbilityIds.filter(isKnownAbility) : [];
    return { version: CURRENT_VERSION, unlockedAbilityIds };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: AbilityProfile): void {
  if (!existsSync(SAVE_DIR)) mkdirSync(SAVE_DIR, { recursive: true });
  writeFileSync(PROFILE_PATH, JSON.stringify(profile));
}

/** Adds `id` if not already unlocked (no-op otherwise, including for `common` ids which never need this). Does not persist — call `saveProfile` after. */
export function unlockAbility(profile: AbilityProfile, id: Id): void {
  if (!profile.unlockedAbilityIds.includes(id)) profile.unlockedAbilityIds.push(id);
}

/** Strikes `id` from the unlocked list — the guaranteed-loss half of the death flow. No-op if it wasn't there (e.g. a `common` ability, which was never in this list to begin with). */
export function lockAbility(profile: AbilityProfile, id: Id): void {
  const idx = profile.unlockedAbilityIds.indexOf(id);
  if (idx !== -1) profile.unlockedAbilityIds.splice(idx, 1);
}

export function isAbilityUnlocked(profile: AbilityProfile, id: Id): boolean {
  return getAbilityRarity(id) === "common" || profile.unlockedAbilityIds.includes(id);
}

function getAbilityRarity(id: Id): string | undefined {
  return ABILITIES.find((a) => a.id === id)?.rarity;
}
