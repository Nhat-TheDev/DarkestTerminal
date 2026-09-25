import type { MonsterArchetype, Monster, MonsterTier, SkillDefinition } from "../types";
import monstersJson from "../../data/monsters.json";
import monsterSkillsJson from "../../data/monster-skills.json";
import {
  monsterGrowthBonus,
  EXP_REWARD_DEPTH_RATE,
  ELITE_MULTIPLIER,
  BOSS_MULTIPLIER,
  monsterDepthBuffPercent,
  MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS,
} from "./levelGrowth";
import { BALANCE } from "./balanceConfig";
import { assertRaceDataConsistent, resolveRaceProfile } from "./monsterRaces";

import { GROWTH_WEIGHTS } from "./growthWeights";

export const MONSTER_ARCHETYPES = monstersJson as unknown as MonsterArchetype[];

if (MONSTER_ARCHETYPES.length === 0) throw new Error("data/monsters.json: no monster archetypes defined");

export function getArchetype(id: string): MonsterArchetype {
  const found = MONSTER_ARCHETYPES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown monster archetype: ${id}`);
  return found;
}

export const MONSTER_SKILLS = monsterSkillsJson as unknown as SkillDefinition[];

export function getMonsterSkill(id: string): SkillDefinition {
  const found = MONSTER_SKILLS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown monster skill: ${id}`);
  return found;
}

/**
 * An action-weight key names a skill and nothing else, so a typo used to be invisible: nothing
 * resolved it, and the monster quietly spent the rest of its life on basic attacks. Checked once
 * for the whole catalog, here, where the error can name the archetype that caused it.
 *
 * `roles` is the single source of truth for where an archetype can appear:
 * ["normal"] = trash, ["normal","elite","boss"] = triple-role,
 * ["elite","boss"] = guard-only, ["boss"] + finalBoss = scripted final boss.
 */
export function assertMonsterDataConsistent(archetypes: MonsterArchetype[]): void {
  const validTiers: MonsterTier[] = ["normal", "elite", "boss"];
  let finalBossCount = 0;
  for (const archetype of archetypes) {
    if (!Array.isArray(archetype.roles) || archetype.roles.length === 0) {
      throw new Error(`data/monsters.json: "${archetype.id}" needs a non-empty "roles" array`);
    }
    const roleSet = new Set(archetype.roles);
    if (roleSet.size !== archetype.roles.length) {
      throw new Error(`data/monsters.json: "${archetype.id}" has duplicate entries in "roles"`);
    }
    for (const role of archetype.roles) {
      if (!validTiers.includes(role)) {
        throw new Error(`data/monsters.json: "${archetype.id}" has unknown role "${role}"`);
      }
    }
    if (archetype.finalBoss) {
      finalBossCount += 1;
      if (archetype.roles.length !== 1 || archetype.roles[0] !== "boss") {
        throw new Error(`data/monsters.json: "${archetype.id}" finalBoss must have roles ["boss"]`);
      }
      if (archetype.minFloor !== undefined) {
        throw new Error(`data/monsters.json: "${archetype.id}" is finalBoss and must not set "minFloor"`);
      }
    } else {
      if (archetype.minFloor === undefined || archetype.minFloor < 0 || archetype.minFloor % 10 !== 0) {
        throw new Error(`data/monsters.json: "${archetype.id}" needs a "minFloor" that is a non-negative multiple of 10`);
      }
    }
    const weightTiers = new Set(Object.keys(archetype.actionWeights ?? {}));
    if (weightTiers.size !== roleSet.size || ![...roleSet].every((r) => weightTiers.has(r))) {
      throw new Error(
        `data/monsters.json: "${archetype.id}" roles [${archetype.roles.join(",")}] must match actionWeights keys [${[...weightTiers].join(",")}]`
      );
    }
    if (roleSet.has("normal") && archetype.powerTier === undefined) {
      throw new Error(`data/monsters.json: "${archetype.id}" has role "normal" so it needs a "powerTier"`);
    }
    if (!roleSet.has("normal") && archetype.powerTier !== undefined) {
      throw new Error(`data/monsters.json: "${archetype.id}" has no role "normal" so it must not set "powerTier"`);
    }
    const declared = new Set(archetype.skillIds);
    for (const id of archetype.executeSkillId ? [...archetype.skillIds, archetype.executeSkillId] : archetype.skillIds) {
      getMonsterSkill(id); // throws on an unknown id
    }
    for (const [tier, weights] of Object.entries(archetype.actionWeights ?? {})) {
      for (const key of Object.keys(weights)) {
        if (key !== "basicAttack" && !declared.has(key)) {
          throw new Error(`data/monsters.json: "${archetype.id}" actionWeights.${tier} key "${key}" is not in its skillIds`);
        }
      }
    }
  }
  if (finalBossCount !== 1) {
    throw new Error(`data/monsters.json: catalog must define exactly 1 finalBoss, found ${finalBossCount}`);
  }
  const weakAtZero = archetypes.some((a) => a.powerTier === "weak" && (a.minFloor ?? 0) === 0);
  if (!weakAtZero) throw new Error("data/monsters.json: at least 1 weak-tier archetype must have minFloor 0");
  const mediumAtZero = archetypes.some((a) => a.powerTier === "medium" && (a.minFloor ?? 0) === 0);
  if (!mediumAtZero) throw new Error("data/monsters.json: at least 1 medium-tier archetype must have minFloor 0");
  const guardAtZero = archetypes.some((a) => a.roles.includes("elite") && a.roles.includes("boss") && (a.minFloor ?? 0) === 0);
  if (!guardAtZero) throw new Error("data/monsters.json: at least 1 elite+boss-role archetype must have minFloor 0");
}

assertMonsterDataConsistent(MONSTER_ARCHETYPES);
assertRaceDataConsistent(MONSTER_ARCHETYPES);

/** Ordinary combat rooms: every archetype with a normal kit. */
export const COMBAT_ROOM_ARCHETYPES = MONSTER_ARCHETYPES.filter((a) => a.roles.includes("normal"));

/** Guard rooms: every archetype able to act as elite and boss, excluding the scripted final boss. */
export const GUARD_ROOM_ARCHETYPES = MONSTER_ARCHETYPES.filter(
  (a) => a.roles.includes("elite") && a.roles.includes("boss") && !a.finalBoss
);

/** The single scripted final boss. */
export const FINAL_BOSS_ARCHETYPE = MONSTER_ARCHETYPES.find((a) => a.finalBoss)!;

let monsterCounter = 0;

const TIER_MULTIPLIER = { elite: ELITE_MULTIPLIER, boss: BOSS_MULTIPLIER };
const TIER_NAME_SUFFIX = { elite: " (Elite)", boss: " (Boss)" };

export const EXECUTE_COOLDOWN_TURNS = BALANCE.combat.executeCooldownTurns;
export const MONSTER_TYPE_MULTIPLIER = GROWTH_WEIGHTS.monsterGrowthWeights;

export function spawnMonster(archetypeId: string, floorDepth: number, opts?: { tier?: MonsterTier }): Monster {
  const archetype = getArchetype(archetypeId);
  const tier: MonsterTier = opts?.tier ?? "normal";
  if (!archetype.roles.includes(tier)) {
    throw new Error(`Cannot spawn "${archetypeId}" as "${tier}" — roles are [${archetype.roles.join(",")}]`);
  }
  const tierMultiplier = tier === "elite" || tier === "boss" ? TIER_MULTIPLIER[tier] : undefined;
  const typeMultiplier = MONSTER_TYPE_MULTIPLIER[archetype.monsterType];
  const race = resolveRaceProfile(archetype.race, archetype.subRace, archetype.traitIds ?? []);
  const depthBonus = monsterDepthBuffPercent(floorDepth);

  // monsterType's multiplier scales only the depth-growth curve — same rule as a class's growth
  // weight (classGrowthBonus) — so `baseX` itself never gets touched by it. Everything else
  // (tier, depth buff, race/subRace/traits) still scales the whole base+growth total.
  const weightedGrowthMaxHp = monsterGrowthBonus("maxHp", floorDepth, typeMultiplier.maxHp);
  const weightedGrowthAttack = monsterGrowthBonus("attack", floorDepth, typeMultiplier.attack);
  const weightedGrowthDefense = monsterGrowthBonus("defense", floorDepth, typeMultiplier.defense);
  const scaledExp = archetype.expReward + Math.floor(floorDepth * EXP_REWARD_DEPTH_RATE);

  const maxHp = Math.round(
    (archetype.baseHp + weightedGrowthMaxHp) *
      (tierMultiplier?.maxHp ?? 1) *
      (1 + (depthBonus * MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS.maxHp) / 100) *
      (1 + race.statBuff.maxHpPercent / 100)
  );
  const attack = Math.round(
    (archetype.baseAttack + weightedGrowthAttack) *
      (tierMultiplier?.attack ?? 1) *
      (1 + (depthBonus * MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS.attack) / 100) *
      (1 + race.statBuff.attackPercent / 100)
  );
  const defense = Math.round(
    (archetype.baseDefense + weightedGrowthDefense) *
      (tierMultiplier?.defense ?? 1) *
      (1 + (depthBonus * MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS.defense) / 100) *
      (1 + race.statBuff.defensePercent / 100)
  );
  const speed = Math.max(1, archetype.baseSpeed + race.statBuff.speedFlat);

  monsterCounter += 1;
  return {
    id: `${archetypeId}-${monsterCounter}`,
    archetypeId,
    name: tier === "elite" || tier === "boss" ? `${archetype.name}${TIER_NAME_SUFFIX[tier]}` : archetype.name,
    hp: maxHp,
    maxHp,
    attack,
    defense,
    speed,
    tier,
    monsterType: archetype.monsterType,
    aiPattern: archetype.aiPattern,
    race: archetype.race,
    subRace: archetype.subRace,
    traitIds: archetype.traitIds,
    activeStatusEffects: [],
    expReward: tierMultiplier ? Math.round(scaledExp * tierMultiplier.exp) : scaledExp,
    executeCooldownTurns: tier === "boss" ? EXECUTE_COOLDOWN_TURNS : undefined,
    isChargingExecute: false,
  };
}
