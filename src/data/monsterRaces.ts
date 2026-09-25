import type { DamageType, Id, MonsterArchetype, RaceDefinition, RaceProfile, TraitDefinition } from "../types";
import racesJson from "../../data/monster-races.json";
import traitsJson from "../../data/monster-traits.json";

export const RACES = racesJson as unknown as RaceDefinition[];
export const TRAITS = traitsJson as unknown as TraitDefinition[];

const ALL_DAMAGE_TYPES: DamageType[] = ["physical", "magic", "fire", "ice", "lightning", "poison", "bleed", "holy"];
const STAT_BUFF_KEYS = ["maxHpPercent", "attackPercent", "defensePercent", "speedFlat"] as const;

export function getRace(id: Id): RaceDefinition {
  const found = RACES.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown race: ${id}`);
  return found;
}

export function getSubRace(raceId: Id, subRaceId: Id) {
  const race = getRace(raceId);
  const found = race.subRaces.find((s) => s.id === subRaceId);
  if (!found) throw new Error(`Unknown subRace "${subRaceId}" for race "${raceId}"`);
  return found;
}

export function getTrait(id: Id): TraitDefinition {
  const found = TRAITS.find((t) => t.id === id);
  if (!found) throw new Error(`Unknown trait: ${id}`);
  return found;
}

export interface ResolvedRaceProfile {
  resistPercent: Record<DamageType, number>;
  weakPercent: Record<DamageType, number>;
  statBuff: { maxHpPercent: number; attackPercent: number; defensePercent: number; speedFlat: number };
}

function emptyResolved(): ResolvedRaceProfile {
  const resistPercent = {} as Record<DamageType, number>;
  const weakPercent = {} as Record<DamageType, number>;
  for (const t of ALL_DAMAGE_TYPES) {
    resistPercent[t] = 0;
    weakPercent[t] = 0;
  }
  return { resistPercent, weakPercent, statBuff: { maxHpPercent: 0, attackPercent: 0, defensePercent: 0, speedFlat: 0 } };
}

/** Race -> subRace: resistPercent/weakPercent keys REPLACE the race's value for that exact damage
 *  type (unmentioned keys stay inherited). statBuff fields ADD to the race's. */
function applyOverride(base: ResolvedRaceProfile, layer: RaceProfile): void {
  for (const [k, v] of Object.entries(layer.resistPercent ?? {})) base.resistPercent[k as DamageType] = v as number;
  for (const [k, v] of Object.entries(layer.weakPercent ?? {})) base.weakPercent[k as DamageType] = v as number;
  for (const key of STAT_BUFF_KEYS) {
    const delta = layer.statBuff?.[key];
    if (delta !== undefined) base.statBuff[key] += delta;
  }
}

/** (Race+subRace) -> traits: every field ADDS (sum, not override). */
function applyAdditive(base: ResolvedRaceProfile, layer: RaceProfile): void {
  for (const [k, v] of Object.entries(layer.resistPercent ?? {})) base.resistPercent[k as DamageType] += v as number;
  for (const [k, v] of Object.entries(layer.weakPercent ?? {})) base.weakPercent[k as DamageType] += v as number;
  for (const key of STAT_BUFF_KEYS) {
    const delta = layer.statBuff?.[key];
    if (delta !== undefined) base.statBuff[key] += delta;
  }
}

export function resolveRaceProfile(raceId: Id, subRaceId: Id | undefined, traitIds: Id[]): ResolvedRaceProfile {
  const race = getRace(raceId);
  const resolved = emptyResolved();
  applyOverride(resolved, race.profile);
  if (subRaceId) applyOverride(resolved, getSubRace(raceId, subRaceId).profile);
  for (const traitId of traitIds) applyAdditive(resolved, getTrait(traitId).profile);
  for (const t of ALL_DAMAGE_TYPES) {
    resolved.resistPercent[t] = Math.max(0, Math.min(100, resolved.resistPercent[t]));
    resolved.weakPercent[t] = Math.max(0, Math.min(100, resolved.weakPercent[t]));
  }
  return resolved;
}

export function assertRaceDataConsistent(archetypes: MonsterArchetype[]): void {
  const statBuffKeySet = new Set<string>(STAT_BUFF_KEYS);
  const damageTypeSet = new Set<string>(ALL_DAMAGE_TYPES);

  function checkProfile(label: string, profile: RaceProfile): void {
    for (const key of Object.keys(profile.resistPercent ?? {})) {
      if (!damageTypeSet.has(key)) throw new Error(`${label}: unknown damage type "${key}" in resistPercent`);
    }
    for (const key of Object.keys(profile.weakPercent ?? {})) {
      if (!damageTypeSet.has(key)) throw new Error(`${label}: unknown damage type "${key}" in weakPercent`);
    }
    for (const key of Object.keys(profile.statBuff ?? {})) {
      if (!statBuffKeySet.has(key)) throw new Error(`${label}: unknown statBuff key "${key}"`);
    }
  }

  for (const race of RACES) {
    checkProfile(`data/monster-races.json: race "${race.id}"`, race.profile);
    if (race.subRaces.length < 1 || race.subRaces.length > 3) {
      throw new Error(`data/monster-races.json: race "${race.id}" must have 1-3 subRaces, has ${race.subRaces.length}`);
    }
    for (const sub of race.subRaces) checkProfile(`data/monster-races.json: race "${race.id}" subRace "${sub.id}"`, sub.profile);
  }
  for (const trait of TRAITS) checkProfile(`data/monster-traits.json: trait "${trait.id}"`, trait.profile);

  for (const archetype of archetypes) {
    getRace(archetype.race); // throws if unknown
    if (archetype.subRace) getSubRace(archetype.race, archetype.subRace); // throws if unknown or mismatched
    for (const traitId of archetype.traitIds ?? []) getTrait(traitId); // throws if unknown
  }
}
