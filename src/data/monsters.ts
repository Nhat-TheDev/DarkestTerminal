import type { BossTelegraph, Id, MonsterAiPredicate, MonsterAiRule, MonsterArchetype, Monster, MonsterTier, SkillDefinition } from "../types";
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
import { ATTACK_RANGES, BALANCE } from "./balanceConfig";
import { t } from "./strings";
import { assertRaceDataConsistent, resolveRaceProfile } from "./monsterRaces";
import { STATUS_EFFECTS } from "./statusEffects";

import { GROWTH_WEIGHTS } from "./growthWeights";

export const MONSTER_ARCHETYPES = monstersJson as unknown as MonsterArchetype[];

if (MONSTER_ARCHETYPES.length === 0) throw new Error("data/monsters.json: no monster archetypes defined");

export function getArchetype(id: string): MonsterArchetype {
  const found = MONSTER_ARCHETYPES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown monster archetype: ${id}`);
  return found;
}

export function getBossTelegraph(archetype: MonsterArchetype, barIndex = 0): BossTelegraph | undefined {
  return archetype.bars?.[barIndex]?.bossTelegraph ?? archetype.bossTelegraph;
}

export const MONSTER_SKILLS = monsterSkillsJson as unknown as SkillDefinition[];

export function getMonsterSkill(id: string): SkillDefinition {
  const found = MONSTER_SKILLS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown monster skill: ${id}`);
  return found;
}

/** An action-weight key nothing resolves would silently leave the monster on basic attacks, so it must name a declared skill. */
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
    if (!(archetype.aiPattern in BALANCE.targeting.profiles)) {
      throw new Error(`data/monsters.json: "${archetype.id}" has aiPattern "${archetype.aiPattern}", which has no profile in balance-config targeting.profiles`);
    }
    if (!ATTACK_RANGES.includes(archetype.attackRange)) {
      throw new Error(`data/monsters.json: "${archetype.id}" needs an "attackRange" of ${ATTACK_RANGES.join(" or ")}`);
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
    for (const id of archetype.skillIds) getMonsterSkill(id);
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

const PREDICATE_STATUS_FIELDS = ["selfHasStatusId", "selfLacksStatusId", "targetHasStatusId", "targetLacksStatusId"] as const;

function assertPredicate(where: string, p: MonsterAiPredicate | undefined): void {
  if (!p) return;
  for (const field of PREDICATE_STATUS_FIELDS) {
    const id = p[field];
    if (id !== undefined && !STATUS_EFFECTS.some((s) => s.id === id)) {
      throw new Error(`${where}: ${field} "${id}" is not a status in data/status-effects.json`);
    }
  }
}

function assertRules(where: string, rules: MonsterAiRule[] | undefined): void {
  for (const [i, rule] of (rules ?? []).entries()) {
    if (!(rule.weightMultiplier >= 0)) throw new Error(`${where}[${i}]: weightMultiplier must be >= 0`);
    assertPredicate(`${where}[${i}].if`, rule.if);
  }
}

/**
 * The AI and mechanic fields a kit declares (`aiCondition`, `targetCount`, `summonMonster`,
 * `phases`, `shell`) name statuses, archetypes and skills by id and carry ranges; a typo or an
 * inverted range would otherwise surface mid-fight, so it is rejected here with the owner named.
 */
export function assertMonsterKitConsistent(archetypes: MonsterArchetype[], skills: SkillDefinition[]): void {
  const byId = new Map(skills.map((s) => [s.id, s]));
  for (const skill of skills) {
    const where = `data/monster-skills.json: "${skill.id}"`;
    assertPredicate(`${where} aiCondition`, skill.aiCondition);
    assertRules(`${where} aiRules`, skill.aiRules);
    assertRules(`${where} targetRules`, skill.targetRules);
    if (skill.attackRange !== undefined && !ATTACK_RANGES.includes(skill.attackRange)) throw new Error(`${where}: attackRange must be ${ATTACK_RANGES.join(" or ")}`);
    // Cooldowns and uses land in the saved Monster as counts; a fraction or a negative would make that save unloadable.
    for (const field of ["cooldownTurns", "initialCooldownTurns"] as const) {
      const value = skill[field];
      if (value !== undefined && !(Number.isInteger(value) && value >= 0)) throw new Error(`${where}: ${field} must be a non-negative integer`);
    }
    if (skill.usesPerCombat !== undefined && !(Number.isInteger(skill.usesPerCombat) && skill.usesPerCombat >= 1)) {
      throw new Error(`${where}: usesPerCombat must be a positive integer`);
    }
    if ((skill.chargeEffects ?? []).some((e) => e.kind === "damage")) {
      throw new Error(`${where}: chargeEffects resolve on the caster, so they must not deal damage`);
    }
    for (const effect of [...(skill.effects ?? []), ...(skill.chargeEffects ?? [])]) {
      for (const id of [effect.statusEffectId, ...(effect.alsoApplyStatusEffectIds ?? [])]) {
        if (id !== undefined && !STATUS_EFFECTS.some((st) => st.id === id)) throw new Error(`${where}: status "${id}" is not in data/status-effects.json`);
      }
    }
    if (skill.targetCount) {
      const { min, max } = skill.targetCount;
      if (skill.target !== "singleEnemy" || !(min >= 1 && min <= max)) {
        throw new Error(`${where}: targetCount needs target "singleEnemy" and 1 <= min <= max`);
      }
    }
    for (const effect of [...(skill.effects ?? []), ...(skill.chargeEffects ?? [])]) {
      if (effect.kind !== "summonMonster") continue;
      const summoned = archetypes.find((a) => a.id === effect.monsterArchetypeId);
      if (!summoned || !summoned.roles.includes("normal")) {
        throw new Error(`${where}: summonMonster "${effect.monsterArchetypeId}" must be an archetype with role "normal"`);
      }
      if (!(effect.count !== undefined && effect.count >= 1)) throw new Error(`${where}: summonMonster needs count >= 1`);
    }
  }
  for (const archetype of archetypes) {
    const where = `data/monsters.json: "${archetype.id}"`;
    const declared = new Set(archetype.skillIds);
    const isTelegraph = (id: string) => byId.get(id)?.telegraph === true;
    for (const key of Object.keys(archetype.actionWeights?.elite ?? {})) {
      if (isTelegraph(key)) throw new Error(`${where}: telegraph "${key}" is in its elite weights; telegraphs are boss-only`);
    }
    const lastThreshold: Partial<Record<string, number>> = {};
    for (const [i, phase] of (archetype.phases ?? []).entries()) {
      if (!archetype.roles.includes(phase.tier)) {
        throw new Error(`${where}: phase ${i} is for tier "${phase.tier}", which is not in its roles`);
      }
      if (!(phase.hpBelowPercent > 0 && phase.hpBelowPercent <= 100)) throw new Error(`${where}: phase ${i} hpBelowPercent must be in (0, 100]`);
      // The latest entered phase of a tier sets the weights, so a tier's phases must be listed in the order they are entered.
      const previous = lastThreshold[phase.tier];
      if (previous !== undefined && !(phase.hpBelowPercent < previous)) {
        throw new Error(`${where}: phase ${i} must have a lower hpBelowPercent than the ${phase.tier} phase before it`);
      }
      lastThreshold[phase.tier] = phase.hpBelowPercent;
      if (phase.onEnterSkillId !== undefined && isTelegraph(phase.onEnterSkillId)) {
        throw new Error(`${where}: phase ${i} onEnterSkillId "${phase.onEnterSkillId}" is a telegraph`);
      }
      for (const key of Object.keys(phase.weights)) {
        if (key !== "basicAttack" && !declared.has(key)) {
          throw new Error(`${where}: phase ${i} weight key "${key}" is not in its skillIds`);
        }
      }
      if (phase.onEnterSkillId !== undefined && !declared.has(phase.onEnterSkillId)) {
        throw new Error(`${where}: phase ${i} onEnterSkillId "${phase.onEnterSkillId}" is not in its skillIds`);
      }
    }
    const checkTelegraph = (bossTelegraph: BossTelegraph, label: string) => {
      if (!declared.has(bossTelegraph.skillId)) throw new Error(`${where}: ${label} skill "${bossTelegraph.skillId}" is not in its skillIds`);
      if (!isTelegraph(bossTelegraph.skillId)) throw new Error(`${where}: ${label} skill "${bossTelegraph.skillId}" is not a telegraph skill`);
      if (!(Number.isInteger(bossTelegraph.meterLength) && bossTelegraph.meterLength >= 1)) {
        throw new Error(`${where}: ${label} meterLength must be a positive integer`);
      }
    };
    if (archetype.bossTelegraph) {
      if (!archetype.roles.includes("boss")) throw new Error(`${where}: bossTelegraph needs the role "boss"`);
      checkTelegraph(archetype.bossTelegraph, "bossTelegraph");
    }
    if (archetype.bars) {
      if (!archetype.roles.includes("boss")) throw new Error(`${where}: bars need the role "boss"`);
      if (archetype.phases) throw new Error(`${where}: bars and phases cannot be combined`);
      if (archetype.bars.length < 2) throw new Error(`${where}: bars needs at least two bars`);
      for (const [i, bar] of archetype.bars.entries()) {
        if (!(bar.hpMultiplier > 0)) throw new Error(`${where}: bar ${i} hpMultiplier must be above 0`);
        if (i === 0 && bar.onEnterSkillId !== undefined) throw new Error(`${where}: bar 0 is the opening bar and has no onEnterSkillId`);
        if (bar.onEnterSkillId !== undefined) {
          if (!declared.has(bar.onEnterSkillId)) throw new Error(`${where}: bar ${i} onEnterSkillId "${bar.onEnterSkillId}" is not in its skillIds`);
          if (isTelegraph(bar.onEnterSkillId)) throw new Error(`${where}: bar ${i} onEnterSkillId "${bar.onEnterSkillId}" is a telegraph`);
        }
        for (const key of Object.keys(bar.weights ?? {})) {
          if (key !== "basicAttack" && !declared.has(key)) throw new Error(`${where}: bar ${i} weight key "${key}" is not in its skillIds`);
        }
        if (bar.bossTelegraph) checkTelegraph(bar.bossTelegraph, `bar ${i} bossTelegraph`);
        else if (!archetype.bossTelegraph) throw new Error(`${where}: bar ${i} has no telegraph and the archetype declares none`);
      }
    }
    for (const weights of [...Object.values(archetype.actionWeights ?? {}), ...(archetype.phases ?? []).map((p) => p.weights), ...(archetype.bars ?? []).flatMap((b) => (b.weights ? [b.weights] : []))]) {
      for (const key of Object.keys(weights)) {
        if (isTelegraph(key)) throw new Error(`${where}: telegraph "${key}" is in an action weight; a boss telegraph is released by its meter`);
      }
    }
    if (archetype.shell) {
      const { hitsToBreak, breakStatusId, hitDamageCapMaxHpPercent, breakDurationTurns, reformAfterOwnTurns } = archetype.shell;
      if (!(hitDamageCapMaxHpPercent > 0)) throw new Error(`${where}: shell hitDamageCapMaxHpPercent must be above 0`);
      for (const [field, value] of [["breakDurationTurns", breakDurationTurns], ["reformAfterOwnTurns", reformAfterOwnTurns]] as const) {
        if (!(Number.isInteger(value) && value >= 1)) throw new Error(`${where}: shell ${field} must be a positive integer`);
      }
      if (!(hitsToBreak.min >= 1 && hitsToBreak.min <= hitsToBreak.max)) {
        throw new Error(`${where}: shell hitsToBreak needs 1 <= min <= max`);
      }
      if (!STATUS_EFFECTS.some((s) => s.id === breakStatusId)) {
        throw new Error(`${where}: shell breakStatusId "${breakStatusId}" is not a status`);
      }
    }
    for (const id of archetype.skillIds) {
      if (!byId.has(id)) throw new Error(`${where}: skill "${id}" is not in data/monster-skills.json`);
    }
  }
}

assertMonsterDataConsistent(MONSTER_ARCHETYPES);
assertMonsterKitConsistent(MONSTER_ARCHETYPES, MONSTER_SKILLS);
assertRaceDataConsistent(MONSTER_ARCHETYPES);

export const COMBAT_ROOM_ARCHETYPES = MONSTER_ARCHETYPES.filter((a) => a.roles.includes("normal"));

export const GUARD_ROOM_ARCHETYPES = MONSTER_ARCHETYPES.filter(
  (a) => a.roles.includes("elite") && a.roles.includes("boss") && !a.finalBoss
);

export const FINAL_BOSS_ARCHETYPE = MONSTER_ARCHETYPES.find((a) => a.finalBoss)!;

let monsterCounter = 0;

const TIER_MULTIPLIER = { elite: ELITE_MULTIPLIER, boss: BOSS_MULTIPLIER };
const TIER_NAME_SUFFIX = { elite: t("monster.eliteNameSuffix"), boss: t("monster.bossNameSuffix") };

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
  // A normal-tier monster never carries guard-room state.
  const skillCooldowns =
    tier === "normal"
      ? undefined
      : Object.fromEntries(
          archetype.skillIds
            .map(getMonsterSkill)
            .filter((s) => s.initialCooldownTurns)
            .map((s) => [s.id, s.initialCooldownTurns!])
        );

  const bars = tier === "boss" ? archetype.bars : undefined;
  const firstBarHp = bars ? Math.round(maxHp * bars[0]!.hpMultiplier) : maxHp;

  monsterCounter += 1;
  return {
    id: `${archetypeId}-${monsterCounter}`,
    archetypeId,
    name: tier === "elite" || tier === "boss" ? `${archetype.name}${TIER_NAME_SUFFIX[tier]}` : archetype.name,
    hp: firstBarHp,
    maxHp: firstBarHp,
    ...(bars ? { barBaseHp: maxHp } : {}),
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
    skillCooldowns,
  };
}
