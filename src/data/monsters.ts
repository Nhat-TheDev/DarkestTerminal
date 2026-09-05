import type { MonsterArchetype, Monster, MonsterTier, SkillDefinition } from "../types";
import monstersJson from "../../data/monsters.json";
import monsterSkillsJson from "../../data/monster-skills.json";
import { growthBonusForDepth, EXP_REWARD_DEPTH_RATE, ELITE_MULTIPLIER, BOSS_MULTIPLIER } from "./levelGrowth";
import { BALANCE } from "./balanceConfig";

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

let monsterCounter = 0;

const TIER_MULTIPLIER = { elite: ELITE_MULTIPLIER, boss: BOSS_MULTIPLIER };
const TIER_NAME_SUFFIX = { elite: " (Elite)", boss: " (Boss)" };

export const EXECUTE_COOLDOWN_TURNS = BALANCE.combat.executeCooldownTurns;
export const MONSTER_TYPE_MULTIPLIER = GROWTH_WEIGHTS.monsterGrowthWeights;

export function spawnMonster(archetypeId: string, floorDepth: number, opts?: { tier?: MonsterTier }): Monster {
  const archetype = getArchetype(archetypeId);
  const tier: MonsterTier = opts?.tier ?? "normal";
  const tierMultiplier = tier === "elite" || tier === "boss" ? TIER_MULTIPLIER[tier] : undefined;
  const typeMultiplier = MONSTER_TYPE_MULTIPLIER[archetype.monsterType];

  const growthMaxHp = archetype.baseHp + growthBonusForDepth("maxHp", floorDepth);
  const growthAttack = archetype.baseAttack + growthBonusForDepth("attack", floorDepth);
  const growthDefense = archetype.baseDefense + growthBonusForDepth("defense", floorDepth);
  const scaledExp = archetype.expReward + Math.floor(floorDepth * EXP_REWARD_DEPTH_RATE);

  const maxHp = Math.round(growthMaxHp * typeMultiplier.maxHp * (tierMultiplier?.maxHp ?? 1));
  const attack = Math.round(growthAttack * typeMultiplier.attack * (tierMultiplier?.attack ?? 1));
  const defense = Math.round(growthDefense * typeMultiplier.defense * (tierMultiplier?.defense ?? 1));

  monsterCounter += 1;
  return {
    id: `${archetypeId}-${monsterCounter}`,
    archetypeId,
    name: tier === "elite" || tier === "boss" ? `${archetype.name}${TIER_NAME_SUFFIX[tier]}` : archetype.name,
    hp: maxHp,
    maxHp,
    attack,
    defense,
    speed: archetype.baseSpeed,
    skillIds: archetype.skillIds,
    tier,
    monsterType: archetype.monsterType,
    aiPattern: archetype.aiPattern,
    activeStatusEffects: [],
    expReward: tierMultiplier ? Math.round(scaledExp * tierMultiplier.exp) : scaledExp,
    executeCooldownTurns: tier === "boss" ? EXECUTE_COOLDOWN_TURNS : undefined,
    isChargingExecute: false,
  };
}
