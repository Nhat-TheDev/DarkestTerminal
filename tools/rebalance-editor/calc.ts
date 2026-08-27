// Balance-calculation core for the rebalance editor (bun run rebalance-editor).
//
// Every formula here is imported straight from the real engine/data modules —
// nothing is hand-copied — so results never drift from what the game
// actually does. This file only adds *read-only* derived views on top
// (growth breakdowns, %maxHp, hits-to-kill, EV per round, ...); it never
// mutates game state.

import { CLASSES, getClass, getSkill, getEffectiveSkill } from "../../src/data/classes";
import { MONSTER_ARCHETYPES, getArchetype, spawnMonster, getMonsterSkill, MONSTER_SKILLS, EXECUTE_COOLDOWN_TURNS } from "../../src/data/monsters";
import {
  growthBonus,
  growthBonusForDepth,
  classGrowthBonus,
  expCostForLevel,
  levelForTotalExp,
  MAX_LEVEL,
  ELITE_MULTIPLIER,
  BOSS_MULTIPLIER,
  EXP_REWARD_DEPTH_RATE,
  BOSS_FLOOR_INTERVAL,
  type GrowthStat,
} from "../../src/data/levelGrowth";
import { statsForLevel } from "../../src/engine/party";
import { mitigatedOffense, getFearTier, getFearAccuracyPenalty, getFearDamagePenalty, type FearTier } from "../../src/engine/resolver";
import { createFloor } from "../../src/data/floor";
import { Rng } from "../../src/engine/rng";
import { STATUS_EFFECTS, getStatusEffect } from "../../src/data/statusEffects";
import { BALANCE } from "../../src/data/balanceConfig";
import type { CharacterClass, MonsterArchetype, MonsterTier, SkillDefinition, SkillEffect } from "../../src/types";

const GROWTH_STATS: GrowthStat[] = ["attack", "defense", "maxHp", "maxMp", "magicPower"];

export function badInput(message: string): { error: string } {
  return { error: message };
}

// ---------------------------------------------------------------------------
// Balance Points — docs/gameplay-decisions/01-class-skill.md "Base stats
// balancing formula (Balance Points)" (char) and docs/gameplay-decisions/
// 02-monster.md "Monster Balance Points" (monster) share the same shape,
// including the speed term. tier1 rates are read via growthBonus() rather
// than hand-copied, so this never drifts from level-growth.json.
// ---------------------------------------------------------------------------

/** Hand-picked constant (not derived from any growth table — speed never scales for char or monster) — see "Monster Balance Points" in 02-monster.md. */
const BALANCE_POINTS_SPEED_RATE = 12;

function balancePointsRate(stat: GrowthStat): number {
  return growthBonus(stat, 2);
}

export function characterBalancePoints(base: { attack: number; defense: number; maxHp: number; maxMp: number; magicPower: number; speed: number }): number {
  return (
    base.attack / balancePointsRate("attack") +
    base.defense / balancePointsRate("defense") +
    base.maxHp / balancePointsRate("maxHp") +
    base.maxMp / balancePointsRate("maxMp") +
    base.magicPower / balancePointsRate("magicPower") +
    base.speed / BALANCE_POINTS_SPEED_RATE
  );
}

export function monsterBalancePoints(base: { attack: number; defense: number; hp: number; speed: number }): number {
  return base.attack / balancePointsRate("attack") + base.defense / balancePointsRate("defense") + base.hp / balancePointsRate("maxHp") + base.speed / BALANCE_POINTS_SPEED_RATE;
}

// ---------------------------------------------------------------------------
// Catalog (static reference data for populating the UI)
// ---------------------------------------------------------------------------

export function getCatalog() {
  return {
    classes: CLASSES.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      base: { attack: c.baseAttack, defense: c.baseDefense, maxHp: c.baseMaxHp, maxMp: c.baseMaxMp, magicPower: c.baseMagicPower, aggro: c.baseAggro, speed: c.baseSpeed },
      growthWeights: c.growthWeights,
      growthWeightTotal: Object.values(c.growthWeights).reduce((a, b) => a + b, 0),
      skills: c.skills,
    })),
    monsters: MONSTER_ARCHETYPES.map((m) => ({
      id: m.id,
      name: m.name,
      guardOnly: m.guardOnly ?? false,
      powerTier: m.powerTier ?? null,
      aiPattern: m.aiPattern,
      base: { hp: m.baseHp, attack: m.baseAttack, defense: m.baseDefense, speed: m.baseSpeed },
      expReward: m.expReward,
      isGuardCapable: Boolean(m.eliteSkillIds && m.bossSkillIds),
      actionWeights: m.actionWeights ?? null,
    })),
    monsterSkills: MONSTER_SKILLS,
    statusEffects: STATUS_EFFECTS,
    levelGrowth: {
      maxLevel: MAX_LEVEL,
      eliteMultiplier: ELITE_MULTIPLIER,
      bossMultiplier: BOSS_MULTIPLIER,
      expRewardDepthRate: EXP_REWARD_DEPTH_RATE,
      bossFloorInterval: BOSS_FLOOR_INTERVAL,
      executeCooldownTurns: EXECUTE_COOLDOWN_TURNS,
    },
    balance: BALANCE,
    fearTiers: ([1, 2, 3, 4] as FearTier[]).map((tier) => ({
      tier,
      accuracyPenaltyPercent: getFearAccuracyPenalty(tier) * 100,
      damagePenaltyPercent: getFearDamagePenalty(tier) * 100,
    })),
    expCurve: Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((level) => ({
      level,
      cumulativeExp: expCostForLevel(level),
    })),
  };
}

// ---------------------------------------------------------------------------
// Character inspector
// ---------------------------------------------------------------------------

export interface CharacterComputation {
  classId: string;
  level: number;
  base: Record<GrowthStat, number>;
  growthBonusUnweighted: Record<GrowthStat, number>;
  growthBonusWeighted: Record<GrowthStat, number>;
  final: { maxHp: number; maxMp: number; attack: number; defense: number; magicPower: number; aggro: number; speed: number };
  /** Base-stat Balance Points (docs/gameplay-decisions/01-class-skill.md) — computed off `base`, not `final`/leveled stats. */
  balancePoints: number;
  unlockedSkillIds: string[];
  skills: (SkillDefinition & { unlocked: boolean; rankInfo: { current: number; total: number; nextUnlockLevel: number | null } | null })[];
}

/** Which rank of `skill` is active at `level`, plus when the next one (if any) unlocks. Null if the skill has no ranks. */
function rankInfoAt(skill: SkillDefinition, level: number): { current: number; total: number; nextUnlockLevel: number | null } | null {
  if (!skill.ranks || skill.ranks.length === 0) return null;
  const sorted = [...skill.ranks].sort((a, b) => a.rank - b.rank);
  let current = 0;
  let nextUnlockLevel: number | null = null;
  for (const r of sorted) {
    if (r.unlockLevel <= level) current = r.rank;
    else if (nextUnlockLevel === null) nextUnlockLevel = r.unlockLevel;
  }
  return { current, total: sorted.length, nextUnlockLevel };
}

export function computeCharacter(classId: string, level: number): CharacterComputation | { error: string } {
  let cls: CharacterClass;
  try {
    cls = getClass(classId);
  } catch {
    return badInput(`Unknown class id "${classId}".`);
  }
  if (!Number.isFinite(level) || level < 1 || level > MAX_LEVEL) return badInput(`level must be an integer in [1, ${MAX_LEVEL}].`);
  level = Math.round(level);

  const base: Record<GrowthStat, number> = {
    attack: cls.baseAttack,
    defense: cls.baseDefense,
    maxHp: cls.baseMaxHp,
    maxMp: cls.baseMaxMp,
    magicPower: cls.baseMagicPower,
  };
  const growthBonusUnweighted = Object.fromEntries(GROWTH_STATS.map((s) => [s, growthBonus(s, level)])) as Record<GrowthStat, number>;
  const growthBonusWeighted = Object.fromEntries(GROWTH_STATS.map((s) => [s, classGrowthBonus(s, level, cls.growthWeights)])) as Record<GrowthStat, number>;

  const stats = statsForLevel(cls, level);
  return {
    classId,
    level,
    base,
    growthBonusUnweighted,
    growthBonusWeighted,
    final: { maxHp: stats.maxHp, maxMp: stats.maxMp, attack: stats.attack, defense: stats.defense, magicPower: stats.magicPower, aggro: cls.baseAggro, speed: cls.baseSpeed },
    balancePoints: characterBalancePoints({ ...base, speed: cls.baseSpeed }),
    unlockedSkillIds: stats.unlockedSkillIds,
    skills: cls.skills.map((s) => {
      const unlocked = stats.unlockedSkillIds.includes(s.id);
      const effective = unlocked ? getEffectiveSkill(s, level) : s;
      return { ...effective, id: s.id, name: s.name, unlocked, rankInfo: unlocked ? rankInfoAt(s, level) : null };
    }),
  };
}

// ---------------------------------------------------------------------------
// Monster inspector
// ---------------------------------------------------------------------------

export interface MonsterComputation {
  archetypeId: string;
  depth: number;
  tier: MonsterTier;
  base: { hp: number; attack: number; defense: number; speed: number };
  /** Base-stat Balance Points (docs/gameplay-decisions/02-monster.md "Monster Balance Points") — computed off `base`, before eliteMultiplier/bossMultiplier or floor-depth scaling. */
  balancePoints: number;
  growthBonus: { maxHp: number; attack: number; defense: number };
  multiplier: { maxHp: number; attack: number; defense: number; exp: number } | null;
  final: { hp: number; maxHp: number; attack: number; defense: number; speed: number; expReward: number };
  isBossFloor: boolean;
  skillKit: {
    basicAttack: { amount: number };
    regularSkillIds: string[];
    elite: { strike: SkillDefinition; cleave: SkillDefinition } | null;
    boss: { execute: SkillDefinition; debuff: SkillDefinition } | null;
  };
  actionWeights: MonsterArchetype["actionWeights"] extends infer T ? (T extends object ? T[keyof T] : never) : never | null;
}

export function computeMonster(archetypeId: string, depth: number, tier: MonsterTier): MonsterComputation | { error: string } {
  let archetype: MonsterArchetype;
  try {
    archetype = getArchetype(archetypeId);
  } catch {
    return badInput(`Unknown monster archetype id "${archetypeId}".`);
  }
  if (!Number.isFinite(depth) || depth < 1) return badInput("depth must be an integer >= 1.");
  depth = Math.round(depth);
  if (tier !== "normal" && tier !== "elite" && tier !== "boss") return badInput('tier must be "normal", "elite", or "boss".');
  if ((tier === "elite" || tier === "boss") && !(archetype.eliteSkillIds && archetype.bossSkillIds)) {
    return badInput(`"${archetypeId}" has no elite/boss skill kit — it can only be spawned at tier "normal".`);
  }

  const monster = spawnMonster(archetypeId, depth, tier === "normal" ? undefined : { tier });
  const multiplier = tier === "elite" ? ELITE_MULTIPLIER : tier === "boss" ? BOSS_MULTIPLIER : null;

  return {
    archetypeId,
    depth,
    tier,
    base: { hp: archetype.baseHp, attack: archetype.baseAttack, defense: archetype.baseDefense, speed: archetype.baseSpeed },
    balancePoints: monsterBalancePoints({ attack: archetype.baseAttack, defense: archetype.baseDefense, hp: archetype.baseHp, speed: archetype.baseSpeed }),
    growthBonus: { maxHp: growthBonusForDepth("maxHp", depth), attack: growthBonusForDepth("attack", depth), defense: growthBonusForDepth("defense", depth) },
    multiplier,
    final: { hp: monster.hp, maxHp: monster.maxHp, attack: monster.attack, defense: monster.defense, speed: monster.speed, expReward: monster.expReward },
    isBossFloor: depth % BOSS_FLOOR_INTERVAL === 0,
    skillKit: {
      basicAttack: { amount: 0 },
      regularSkillIds: archetype.skillIds,
      elite: archetype.eliteSkillIds ? { strike: getMonsterSkill(archetype.eliteSkillIds.strike), cleave: getMonsterSkill(archetype.eliteSkillIds.cleave) } : null,
      boss: archetype.bossSkillIds ? { execute: getMonsterSkill(archetype.bossSkillIds.execute), debuff: getMonsterSkill(archetype.bossSkillIds.debuff) } : null,
    },
    actionWeights: (archetype.actionWeights?.[tier] as never) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Damage calculator (freeform + skill-against-target previews)
// ---------------------------------------------------------------------------

export interface DamageBreakdown {
  offense: number;
  defense: number;
  effectiveDefense: number;
  amount: number;
  mitigatedOffense: number;
  /** Damage the hit would deal if the target had 0 effective defense (amount + offense, fear-adjusted). */
  unmitigatedTotal: number;
  /** How much of that unmitigated damage was removed by defense, as a percentage of unmitigatedTotal. */
  defenseReductionPercent: number;
  rawTotal: number;
  fearDamageMultiplier: number;
  finalDamage: number;
  percentOfTargetMaxHp: number | null;
  hitsToKill: number | null;
  hitChancePercent: number | null;
  expectedDamage: number | null;
}

export function computeDamage(opts: {
  offense: number;
  defense: number;
  amount: number;
  ignoreDefensePercent?: number;
  fearTier?: FearTier;
  sourceIsCharacter?: boolean;
  targetMaxHp?: number;
}): DamageBreakdown | { error: string } {
  const { offense, defense, amount } = opts;
  if (![offense, defense, amount].every(Number.isFinite)) return badInput("offense, defense, and amount must be numbers.");
  const ignoreDefensePercent = opts.ignoreDefensePercent ?? 0;
  const effectiveDefense = defense * (1 - ignoreDefensePercent / 100);
  const mo = mitigatedOffense(offense, effectiveDefense);
  const fearTier = opts.fearTier ?? 1;
  const sourceIsCharacter = opts.sourceIsCharacter ?? true;
  const fearDamageMultiplier = sourceIsCharacter ? 1 - getFearDamagePenalty(fearTier) : 1;
  const rawTotal = (amount + mo) * fearDamageMultiplier;
  const finalDamage = Math.max(1, Math.round(rawTotal));
  // "Original" damage = the same hit against 0 defense; the gap to finalDamage is what defense removed.
  const unmitigatedTotal = (amount + offense) * fearDamageMultiplier;
  const defenseReductionPercent = unmitigatedTotal > 0 ? Math.max(0, (1 - rawTotal / unmitigatedTotal) * 100) : 0;
  const hitChancePercent = sourceIsCharacter ? (1 - getFearAccuracyPenalty(fearTier)) * 100 : 100;
  const targetMaxHp = opts.targetMaxHp;

  return {
    offense,
    defense,
    effectiveDefense,
    amount,
    mitigatedOffense: mo,
    unmitigatedTotal: Number(unmitigatedTotal.toFixed(2)),
    defenseReductionPercent: Number(defenseReductionPercent.toFixed(1)),
    rawTotal,
    fearDamageMultiplier,
    finalDamage,
    percentOfTargetMaxHp: targetMaxHp ? Number(((finalDamage / targetMaxHp) * 100).toFixed(1)) : null,
    hitsToKill: targetMaxHp ? Math.ceil(targetMaxHp / finalDamage) : null,
    hitChancePercent,
    expectedDamage: Number((finalDamage * (hitChancePercent / 100)).toFixed(1)),
  };
}

function effectsOf(skill: SkillDefinition): SkillEffect[] {
  return skill.effectsByRelation ? skill.effectsByRelation.enemy : (skill.effects ?? []);
}

export interface SkillDamagePreview {
  skillId: string;
  skillName: string;
  target: string;
  perEffect: (DamageBreakdown & { effectAmount: number; effectChancePercent: number | null; appliesStatusEffectId?: string })[];
  totalUnmitigatedDamage: number;
  totalFinalDamage: number;
  totalExpectedDamage: number;
}

/** Previews every `damage` effect of a skill against a single defense/maxHp target. Non-damage effects (heal/status/etc.) are omitted from the numeric preview but their status-effect ids are still attached where relevant so the caller can look them up. */
export function previewSkillDamage(
  skill: SkillDefinition,
  source: { attack: number; magicPower?: number },
  target: { defense: number; maxHp?: number },
  fearTier: FearTier,
  sourceIsCharacter: boolean
): SkillDamagePreview {
  const offense = skill.isMagic ? (source.magicPower ?? 0) : source.attack;
  const damageEffects = effectsOf(skill).filter((e) => e.kind === "damage");
  const perEffect = damageEffects.map((e) => {
    const breakdown = computeDamage({
      offense,
      defense: target.defense,
      amount: e.amount ?? 0,
      ignoreDefensePercent: e.ignoreDefensePercent,
      fearTier,
      sourceIsCharacter,
      targetMaxHp: target.maxHp,
    });
    if ("error" in breakdown) throw new Error(breakdown.error);
    return { ...breakdown, effectAmount: e.amount ?? 0, effectChancePercent: e.chance !== undefined ? e.chance * 100 : null };
  });
  return {
    skillId: skill.id,
    skillName: skill.name,
    target: skill.target,
    perEffect,
    totalUnmitigatedDamage: perEffect.reduce((sum, e) => sum + e.unmitigatedTotal * (e.effectChancePercent !== null ? e.effectChancePercent / 100 : 1), 0),
    totalFinalDamage: perEffect.reduce((sum, e) => sum + e.finalDamage * (e.effectChancePercent !== null ? e.effectChancePercent / 100 : 1), 0),
    totalExpectedDamage: perEffect.reduce((sum, e) => sum + (e.expectedDamage ?? 0) * (e.effectChancePercent !== null ? e.effectChancePercent / 100 : 1), 0),
  };
}

const BASIC_ATTACK_SKILL: SkillDefinition = { id: "basic-attack", name: "Basic Attack", description: "The free, unassigned slot-0 attack every character/monster has.", mpCost: 0, target: "singleEnemy", effects: [{ kind: "damage", amount: 0 }], slot: 0, unlockLevel: 1 };

/** Looks up a skill by id across every catalog (class skills, monster skills, or the synthetic "basic-attack" placeholder) — lets the UI preview any skill without needing to know which catalog it came from. */
export function findSkillById(skillId: string): SkillDefinition | undefined {
  if (skillId === "basic-attack") return BASIC_ATTACK_SKILL;
  try {
    return getSkill(skillId);
  } catch {
    // not a class skill — fall through
  }
  try {
    return getMonsterSkill(skillId);
  } catch {
    return undefined;
  }
}

export function computeSkillPreview(opts: {
  skillId: string;
  sourceAttack: number;
  sourceMagicPower?: number;
  targetDefense: number;
  targetMaxHp?: number;
  fearTier?: FearTier;
  sourceIsCharacter?: boolean;
  /** When the source is a character, resolves the skill to the rank active at this level (see getEffectiveSkill). No-op for monster skills, which have no ranks. */
  characterLevel?: number;
}): SkillDamagePreview | { error: string } {
  let skill = findSkillById(opts.skillId);
  if (!skill) return badInput(`Unknown skill id "${opts.skillId}".`);
  if (!Number.isFinite(opts.sourceAttack) || !Number.isFinite(opts.targetDefense)) return badInput("sourceAttack and targetDefense must be numbers.");
  if ((opts.sourceIsCharacter ?? true) && opts.characterLevel !== undefined && Number.isFinite(opts.characterLevel)) {
    skill = getEffectiveSkill(skill, opts.characterLevel);
  }
  return previewSkillDamage(
    skill,
    { attack: opts.sourceAttack, magicPower: opts.sourceMagicPower },
    { defense: opts.targetDefense, maxHp: opts.targetMaxHp },
    opts.fearTier ?? 1,
    opts.sourceIsCharacter ?? true
  );
}

// ---------------------------------------------------------------------------
// Matchup — character vs monster, both directions
// ---------------------------------------------------------------------------

export function computeMatchup(opts: { classId: string; level: number; archetypeId: string; depth: number; tier: MonsterTier; fearTier?: FearTier }) {
  const character = computeCharacter(opts.classId, opts.level);
  if ("error" in character) return character;
  const monster = computeMonster(opts.archetypeId, opts.depth, opts.tier);
  if ("error" in monster) return monster;
  const fearTier = opts.fearTier ?? 1;

  const characterOffense = { attack: character.final.attack, magicPower: character.final.magicPower };
  const monsterTarget = { defense: monster.final.defense, maxHp: monster.final.maxHp };
  const outgoing = character.skills
    .filter((s) => s.unlocked && effectsOf(s).some((e) => e.kind === "damage") && (s.target === "singleEnemy" || s.target === "allEnemies" || s.target === "singleAllyOrEnemy" || s.target === "allAlliesAndEnemies"))
    .map((s) => previewSkillDamage(s, characterOffense, monsterTarget, fearTier, true));

  const monsterOffense = { attack: monster.final.attack };
  const characterTarget = { defense: character.final.defense, maxHp: character.final.maxHp };
  const incoming: (SkillDamagePreview & { actionWeightPercent: number | null })[] = [];

  const weights = monster.actionWeights as Partial<Record<string, number>> | null;
  const weightTotal = weights ? Object.values(weights).reduce((a: number, b) => a + (b ?? 0), 0) : 0;
  const weightPercent = (key: string) => (weights && weightTotal > 0 ? ((weights[key] ?? 0) / weightTotal) * 100 : null);

  // Gate by the monster's *current* tier, not just whether the archetype is capable of elite/boss —
  // an elite-tier instance never rolls Execute/Debuff even though its archetype has a bossSkillIds kit.
  incoming.push({ ...previewSkillDamage(BASIC_ATTACK_SKILL, monsterOffense, characterTarget, fearTier, false), actionWeightPercent: weightPercent("basicAttack") });
  if ((opts.tier === "elite" || opts.tier === "boss") && monster.skillKit.elite) {
    incoming.push({ ...previewSkillDamage(monster.skillKit.elite.strike, monsterOffense, characterTarget, fearTier, false), actionWeightPercent: weightPercent("strike") });
    incoming.push({ ...previewSkillDamage(monster.skillKit.elite.cleave, monsterOffense, characterTarget, fearTier, false), actionWeightPercent: weightPercent("cleave") });
  }
  if (opts.tier === "boss" && monster.skillKit.boss) {
    incoming.push({ ...previewSkillDamage(monster.skillKit.boss.execute, monsterOffense, characterTarget, fearTier, false), actionWeightPercent: null });
    incoming.push({ ...previewSkillDamage(monster.skillKit.boss.debuff, monsterOffense, characterTarget, fearTier, false), actionWeightPercent: weightPercent("debuff") });
  }

  const rollingActions = incoming.filter((a) => a.actionWeightPercent !== null && a.actionWeightPercent > 0);
  const expectedDamagePerRoundFromRolling = rollingActions.reduce((sum, a) => sum + a.totalExpectedDamage * ((a.actionWeightPercent ?? 0) / 100), 0);

  return {
    character,
    monster,
    outgoing,
    incoming,
    expectedDamagePerRoundFromRolling: Number(expectedDamagePerRoundFromRolling.toFixed(1)),
    executeCycleNote: monster.skillKit.boss
      ? `Finishing Blow isn't part of the weighted roll — it fires once every ~${EXECUTE_COOLDOWN_TURNS + 2} rounds (1 charge turn + 1 release turn + ${EXECUTE_COOLDOWN_TURNS} cooldown turns), always for the "boss.execute" row's damage regardless of the roll above.`
      : null,
  };
}

// ---------------------------------------------------------------------------
// Floor depth <-> average character level projection
// ---------------------------------------------------------------------------

export interface LevelByDepthRow {
  depth: number;
  isBossFloor: boolean;
  avgPartyExp: number;
  avgLevel: number;
  minLevel: number;
  maxLevel: number;
}

/** Reproduces docs/gameplay-decisions/06-level-system.md §6.7's own stated methodology: replay createFloor(rng, depth) continuously from floor 1, summing every monster's expReward (combat rooms + the guard room; branch stages only spawn combat monsters on their "" side, event rooms spawn none — so this already matches "1 path through", no extra bookkeeping needed), across `seeds` different seeds, averaged. */
export function simulateLevelByDepth(seeds: number, maxDepth: number): LevelByDepthRow[] {
  if (!Number.isFinite(seeds) || seeds < 1 || seeds > 500) throw new Error("seeds must be an integer in [1, 500].");
  if (!Number.isFinite(maxDepth) || maxDepth < 1 || maxDepth > 500) throw new Error("maxDepth must be an integer in [1, 500].");
  seeds = Math.round(seeds);
  maxDepth = Math.round(maxDepth);

  const expBySeed: number[][] = [];
  for (let seed = 0; seed < seeds; seed++) {
    const rng = new Rng(seed * 104729 + 7);
    let exp = 0;
    const perDepth: number[] = [];
    for (let depth = 1; depth <= maxDepth; depth++) {
      const { monsters } = createFloor(rng, depth);
      for (const m of monsters) exp += m.expReward;
      perDepth.push(exp);
    }
    expBySeed.push(perDepth);
  }

  const rows: LevelByDepthRow[] = [];
  for (let i = 0; i < maxDepth; i++) {
    const expAtDepth = expBySeed.map((row) => row[i]!);
    const levelsAtDepth = expAtDepth.map((exp) => levelForTotalExp(exp));
    const avgExp = expAtDepth.reduce((a, b) => a + b, 0) / seeds;
    rows.push({
      depth: i + 1,
      isBossFloor: (i + 1) % BOSS_FLOOR_INTERVAL === 0,
      avgPartyExp: Math.round(avgExp),
      avgLevel: levelForTotalExp(avgExp),
      minLevel: Math.min(...levelsAtDepth),
      maxLevel: Math.max(...levelsAtDepth),
    });
  }
  return rows;
}
