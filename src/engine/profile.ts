import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Id, AbilityProfile, DroppedJournal, JournalLineState, SlotJournal } from "../types";
import { ABILITIES } from "../data/abilities";
import { MONSTER_ARCHETYPES } from "../data/monsters";
import { JOURNAL_LINES, getJournalEcho, getJournalFragment } from "../data/journal";
import { SAVE_DIR, writeFileAtomic } from "./paths";
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

export interface LastRun {
  playTime: number;
  endedAt: number;
}

export interface Profile extends AbilityProfile {
  retiredCharacters: RetiredCharacter[];
  /** Across all runs in the slot, unlike `GameState.firedOnceEventIds`. */
  shownRetiredCharacterEvent: boolean;
  /** Runs started in the slot; the current or last one is this number. */
  runCount: number;
  /** Set by the slot's first boss-tier kill; it opens the Memory screen. */
  memoryUnlocked: boolean;
  /** The one-time Memory intro has been read; `[m]` is offered only after it. */
  memoryIntroShown: boolean;
  journal: SlotJournal;
  /** The readings a wiped party tore out, lying at its death depth. */
  droppedJournal: DroppedJournal | null;
  /** Written as a wipe deletes the save, which held the run's play time. */
  lastRun: LastRun | null;
  /** Monster archetypes the slot has fought, in the order first met; the bestiary lists these. */
  seenMonsterIds: Id[];
}

export function profileFilename(slotId: Id): string {
  return `${slotId}.profile.json`;
}

function profilePath(slotId: Id): string {
  return join(SAVE_DIR, profileFilename(slotId));
}

export function corruptProfileFilename(slotId: Id): string {
  return `${slotId}.profile.corrupt.json`;
}

function defaultProfile(): Profile {
  return { version: CURRENT_VERSION, unlockedAbilityIds: [], retiredCharacters: [], shownRetiredCharacterEvent: false, runCount: 0, memoryUnlocked: false, memoryIntroShown: false, journal: { fragments: [], lines: {}, echoes: [] }, droppedJournal: null, lastRun: null, seenMonsterIds: [] };
}

function isKnownArchetype(id: unknown): id is Id {
  return MONSTER_ARCHETYPES.some((a) => a.id === id);
}

function isKnownAbility(id: Id): boolean {
  return ABILITIES.some((a) => a.id === id);
}

function parseJournalLines(raw: unknown): Record<Id, JournalLineState> {
  const lines: Record<Id, JournalLineState> = {};
  if (!raw || typeof raw !== "object") return lines;
  for (const [lineId, value] of Object.entries(raw as Record<Id, Partial<JournalLineState>>)) {
    const line = JOURNAL_LINES.find((l) => l.id === lineId);
    if (!line || !value) continue;
    const known = (id: unknown): id is Id => line.directions.some((d) => d.id === id);
    const entry: JournalLineState = { struck: Array.isArray(value.struck) ? value.struck.filter(known) : [] };
    if (known(value.directionId)) entry.directionId = value.directionId;
    if (Array.isArray(value.split) && value.split.length === 2 && value.split.every(known)) entry.split = [value.split[0]!, value.split[1]!];
    if (typeof value.writerClassId === "string") entry.writerClassId = renamedClassId(value.writerClassId);
    if (Number.isInteger(value.run)) entry.run = value.run;
    if (entry.directionId || entry.split || entry.struck.length > 0) lines[lineId] = entry;
  }
  return lines;
}

function parseJournal(raw: Partial<SlotJournal> | undefined): SlotJournal {
  const fragments = Array.isArray(raw?.fragments)
    ? raw.fragments.filter((f) => f && getJournalFragment(f.id) && Number.isInteger(f.run) && Number.isInteger(f.depth)).map((f) => ({ id: f.id, run: f.run, depth: f.depth }))
    : [];
  const echoes = Array.isArray(raw?.echoes)
    ? raw.echoes.filter((e) => e && getJournalEcho(e.id) && Number.isInteger(e.run) && Number.isInteger(e.depth)).map((e) => ({ id: e.id, run: e.run, depth: e.depth }))
    : [];
  return { fragments, lines: parseJournalLines(raw?.lines), echoes };
}

function parseDroppedJournal(raw: Partial<DroppedJournal> | null | undefined): DroppedJournal | null {
  if (!raw || !Number.isInteger(raw.depth) || !Array.isArray(raw.hands)) return null;
  const hands = raw.hands
    .filter((h) => h && Number.isInteger(h.run) && Array.isArray(h.classIds))
    .map((h) => ({ run: h.run, classIds: h.classIds.map(renamedClassId), lines: parseJournalLines(h.lines) }))
    .filter((h) => Object.keys(h.lines).length > 0);
  return hands.length > 0 ? { depth: raw.depth!, hands } : null;
}

function parseLastRun(raw: Partial<LastRun> | null | undefined): LastRun | null {
  if (!raw || !Number.isInteger(raw.playTime) || !Number.isInteger(raw.endedAt)) return null;
  return { playTime: raw.playTime!, endedAt: raw.endedAt! };
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
    memoryUnlocked: raw.memoryUnlocked === true,
    memoryIntroShown: raw.memoryIntroShown === true,
    journal: parseJournal(raw.journal),
    droppedJournal: parseDroppedJournal(raw.droppedJournal),
    lastRun: parseLastRun(raw.lastRun),
    seenMonsterIds: Array.isArray(raw.seenMonsterIds) ? [...new Set(raw.seenMonsterIds.filter(isKnownArchetype))] : [],
  };
}

export function hasProfile(slotId: Id): boolean {
  return existsSync(profilePath(slotId));
}

/**
 * No slot, a missing file or an unparseable one all mean a fresh profile: only commons are available.
 * An unparseable file is moved aside first, so the next write cannot destroy what it held.
 */
export function loadProfile(slotId: Id | null): Profile {
  if (!slotId || !existsSync(profilePath(slotId))) return defaultProfile();
  try {
    return parseProfile(readFileSync(profilePath(slotId), "utf8"));
  } catch {
    try {
      renameSync(profilePath(slotId), join(SAVE_DIR, corruptProfileFilename(slotId)));
    } catch (err) {
      console.error(`Failed to set aside unreadable profile ${profilePath(slotId)}:`, err);
    }
    return defaultProfile();
  }
}

/** A run with no slot keeps nothing. */
export function saveProfile(slotId: Id | null, profile: Profile): void {
  if (!slotId) return;
  writeFileAtomic(profilePath(slotId), JSON.stringify(profile));
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

export function recordRunEnd(slotId: Id, playTime: number): void {
  saveProfile(slotId, { ...loadProfile(slotId), lastRun: { playTime, endedAt: Date.now() } });
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
