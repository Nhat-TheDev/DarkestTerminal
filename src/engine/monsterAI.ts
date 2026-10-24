import type { AttackRange, Character, Monster, Summon, MonsterArchetype, CombatState, CombatantRef, SkillDefinition, Id } from "../types";
import { getArchetype, getMonsterSkill } from "../data/monsters";
import { BALANCE, TARGETING_FACTORS, type TargetingFactor } from "../data/balanceConfig";
import { rollDodge } from "./artifacts";
import { resolveSkillEffect, rollHits, isCharacter, type Actor } from "./resolver";
import { t } from "../data/strings";
import { applyArtifactReflectDamage } from "./combatHooks";
import {
  getActorByRef,
  livingPlayerSideEnemyFacingRefs,
  livingMonsterRefs,
  hasStunningStatus,
  applySkillEffects,
  applyMonsterHitFear,
  applyOnActStatuses,
  onStruckByMonster,
  type EngineContext,
} from "./combat";
import { getStatusEffect } from "../data/statusEffects";
import { getClass } from "../data/classes";
import { getSummonArchetype } from "../data/summons";
import { Rng } from "./rng";
import { noteBasicAttack, noteLostTurn, noteMiss } from "./logSession";
import { predicateHolds, scoreWeight, type AiView } from "./monsterAiRules";
import { advanceShellAfterOwnTurn } from "./monsterShell";
import { interceptTarget } from "./interception";

type Targetable = Character | Summon;

/** `null` = the basic attack; anything else is a skill id straight out of `actionWeights`. */
type MonsterAction = Id | null;

/** What the acting monster's rules can see: the targetable party side and the monster side's living allies (never itself). */
export function monsterAiView(actor: Monster, combat: CombatState, ctx: EngineContext): AiView {
  const enemies = livingPlayerSideEnemyFacingRefs(combat, ctx).map((r) => getActorByRef(r, ctx));
  const allies = livingMonsterRefs(combat, ctx)
    .map((r) => getActorByRef(r, ctx) as Monster)
    .filter((m) => m.id !== actor.id);
  return { self: actor, enemies, allies };
}

/** Counted at the end of each of the monster's own turns, stunned or not — the same once-per-turn pace a character's cooldowns run at. */
export function advanceMonsterCooldowns(actor: Monster): void {
  for (const id of Object.keys(actor.skillCooldowns ?? {})) {
    if (actor.skillCooldowns![id]! > 0) actor.skillCooldowns![id]! -= 1;
  }
}

/** The tier's own weights, replaced by the latest phase of that tier the monster has entered. */
function currentWeights(archetype: MonsterArchetype, actor: Monster): Record<string, number> | undefined {
  let weights = archetype.actionWeights?.[actor.tier];
  for (const [i, phase] of (archetype.phases ?? []).entries()) {
    if (phase.tier === actor.tier && actor.enteredPhaseIndexes?.includes(i)) weights = phase.weights;
  }
  return weights;
}

function phaseToEnter(archetype: MonsterArchetype, actor: Monster): number | undefined {
  const i = (archetype.phases ?? []).findIndex(
    (p, idx) => p.tier === actor.tier && !actor.enteredPhaseIndexes?.includes(idx) && (actor.hp / actor.maxHp) * 100 < p.hpBelowPercent
  );
  return i === -1 ? undefined : i;
}

function skillReady(skill: SkillDefinition, actor: Monster, view: AiView): boolean {
  if ((actor.skillCooldowns?.[skill.id] ?? 0) > 0) return false;
  if (skill.usesPerCombat !== undefined && (actor.skillUses?.[skill.id] ?? 0) >= skill.usesPerCombat) return false;
  return !skill.aiCondition || predicateHolds(skill.aiCondition, view);
}

function pickMonsterAction(archetype: MonsterArchetype, actor: Monster, view: AiView, rng: Rng): MonsterAction {
  const weights = currentWeights(archetype, actor);
  if (!weights) return null;
  const candidates: [MonsterAction, number][] = [];
  for (const [key, weight] of Object.entries(weights)) {
    if (!weight || weight <= 0) continue;
    if (key === "basicAttack") {
      candidates.push([null, weight]);
      continue;
    }
    const skill = getMonsterSkill(key);
    if (!skillReady(skill, actor, view)) continue;
    const scored = scoreWeight(weight, skill.aiRules, view);
    if (scored > 0) candidates.push([key, scored]);
  }
  if (candidates.length === 0) return null;
  return rng.weightedPick(candidates, ([, weight]) => weight)[0];
}

/**
 * Scores by rank: the first score goes to whoever ranks first under `compare`, ties share a rank, and
 * every rank past the end of `scores` takes the last score.
 */
function rankScores(pool: Targetable[], compare: (a: Targetable, b: Targetable) => number, scores: number[]): Map<Targetable, number> {
  const sorted = [...pool].sort(compare);
  const result = new Map<Targetable, number>();
  let rank = 0;
  for (const [i, c] of sorted.entries()) {
    if (i > 0 && compare(sorted[i - 1]!, c) !== 0) rank++;
    result.set(c, scores[Math.min(rank, scores.length - 1)]!);
  }
  return result;
}

function hpShare(c: Targetable): number {
  return c.hp / c.maxHp;
}

/** A summon has no fear of its own, so it ranks as fearless. */
function fearOf(c: Targetable): number {
  return isCharacter(c) ? c.survival.fear : 0;
}

function attackRangeOf(c: Targetable): AttackRange {
  return isCharacter(c) ? getClass(c.classId).attackRange : getSummonArchetype(c.archetypeId).attackRange;
}

/** Ranks whoever has taken HP off `actor`, most first; anyone who has taken none scores the last score. */
function damageScores(actor: Monster, pool: Targetable[]): Map<Targetable, number> {
  const { damageRankScores } = BALANCE.targeting;
  const taken = (c: Targetable) => actor.damageTakenFrom?.[c.id] ?? 0;
  const dealers = rankScores(pool.filter((c) => taken(c) > 0), (a, b) => taken(b) - taken(a), damageRankScores);
  return new Map(pool.map((c) => [c, dealers.get(c) ?? damageRankScores[damageRankScores.length - 1]!]));
}

/** Each factor's raw score per candidate. A factor that scores everyone the same spreads its weight evenly. */
function factorScores(factor: TargetingFactor, actor: Monster, pool: Targetable[], attackRange: AttackRange): (c: Targetable) => number {
  const { lowHpRankScores, fearRankScores, rangeScores } = BALANCE.targeting;
  switch (factor) {
    case "aggro":
      return (c) => Math.max(1, c.aggro);
    case "lowHp": {
      const scores = rankScores(pool, (a, b) => hpShare(a) - hpShare(b), lowHpRankScores);
      return (c) => scores.get(c)!;
    }
    case "fear": {
      const scores = rankScores(pool, (a, b) => fearOf(b) - fearOf(a), fearRankScores);
      return (c) => scores.get(c)!;
    }
    case "damage": {
      const scores = damageScores(actor, pool);
      return (c) => scores.get(c)!;
    }
    case "range":
      return (c) => (attackRangeOf(c) === attackRange ? rangeScores.sameRange : rangeScores.otherRange);
  }
}

/**
 * The chance each living candidate is picked under the actor's `aiPattern`, before any skill's
 * `targetRules`: every factor turns its scores into shares of 1, and the profile's weights (which
 * sum to 1) mix those shares. `attackRange` is how the attack reaches its target (the `range` factor):
 * the skill's own, or the archetype's for the basic attack and a skill without one. A `targetPull` status hands its bearer that share of the pick first and
 * the profile splits what is left; pulls summing past 1 are scaled down to share the whole pick.
 */
export function targetingWeight(actor: Monster, living: Targetable[], attackRange: AttackRange = getArchetype(actor.archetypeId).attackRange): (c: Targetable) => number {
  const profile = BALANCE.targeting.profiles[actor.aiPattern]!;
  const chance = new Map<Targetable, number>(living.map((c) => [c, 0]));
  for (const factor of TARGETING_FACTORS) {
    const weight = profile[factor];
    if (weight === 0) continue;
    const score = factorScores(factor, actor, living, attackRange);
    const total = living.reduce((sum, c) => sum + score(c), 0);
    for (const c of living) chance.set(c, chance.get(c)! + (weight * score(c)) / total);
  }
  const pull = new Map(living.map((c) => [c, c.activeStatusEffects.reduce((sum, s) => sum + (getStatusEffect(s.statusEffectId).targetPull ?? 0), 0)]));
  const totalPull = living.reduce((sum, c) => sum + pull.get(c)!, 0);
  if (totalPull > 0) {
    const scale = totalPull > 1 ? 1 / totalPull : 1;
    for (const c of living) chance.set(c, pull.get(c)! * scale + (1 - Math.min(1, totalPull)) * chance.get(c)!);
  }
  return (c) => chance.get(c) ?? 0;
}

/** The end of every round dims what the monster remembers of who hurt it, so the `damage` factor follows the recent fight. */
export function fadeDamageMemory(actor: Monster): void {
  if (!actor.damageTakenFrom) return;
  const decay = BALANCE.targeting.damageMemoryDecay;
  actor.damageTakenFrom = Object.fromEntries(Object.entries(actor.damageTakenFrom).map(([id, amount]) => [id, amount * decay]));
}

/** Whoever a `forcesTargetOnSource` status on the monster names, when they are in the targetable pool. */
function provokedBy(actor: Monster, pool: Targetable[]): Targetable | undefined {
  for (const active of actor.activeStatusEffects) {
    if (!active.sourceId || !getStatusEffect(active.statusEffectId).forcesTargetOnSource) continue;
    const source = pool.find((c) => c.id === active.sourceId);
    if (source) return source;
  }
  return undefined;
}

/**
 * A `redirectToAlliesChance` status turns the attack on the monster's own side: every other living
 * monster for an area attack, or as many of them as the attack had targets, picked at random. A monster
 * with no ally left hits itself. Null when no such status rolls true.
 */
function confusedTargets(actor: Monster, targetCount: number, isArea: boolean, combat: CombatState, ctx: EngineContext): Monster[] | null {
  const chance = Math.max(0, ...actor.activeStatusEffects.map((s) => getStatusEffect(s.statusEffectId).redirectToAlliesChance ?? 0));
  if (chance === 0 || !ctx.rng.chance(chance)) return null;
  const allies = livingMonsterRefs(combat, ctx)
    .map((r) => getActorByRef(r, ctx) as Monster)
    .filter((m) => m.id !== actor.id);
  if (allies.length === 0) return [actor];
  if (isArea) return allies;
  const pool = [...allies];
  const picked: Monster[] = [];
  while (picked.length < Math.max(1, targetCount) && pool.length > 0) picked.push(pool.splice(pool.indexOf(ctx.rng.pick(pool)), 1)[0]!);
  return picked;
}

/** Distinct targets, picked one at a time from the weighted pool. A skill without `targetCount` (and the basic attack) picks one; `count` overrides the roll. */
function pickTargets(
  skill: SkillDefinition | null,
  archetype: MonsterArchetype,
  actor: Monster,
  living: Targetable[],
  view: AiView,
  rng: Rng,
  count: number = skill?.targetCount ? rng.int(skill.targetCount.min, skill.targetCount.max) : 1
): Targetable[] {
  const base = targetingWeight(actor, living, skill?.attackRange ?? archetype.attackRange);
  const pool = [...living];
  const picked: Targetable[] = [];
  const forced = provokedBy(actor, pool);
  if (forced && count > 0) {
    picked.push(forced);
    pool.splice(pool.indexOf(forced), 1);
  }
  while (picked.length < count && pool.length > 0) {
    const next = archetype.targeting === "random" ? rng.pick(pool) : rng.weightedPick(pool, (c) => scoreWeight(base(c), skill?.targetRules, view, c));
    picked.push(next);
    pool.splice(pool.indexOf(next), 1);
  }
  return picked;
}

function resolveMonsterSkillTargets(skill: SkillDefinition, archetype: MonsterArchetype, actor: Monster, living: Targetable[], view: AiView, rng: Rng): Actor[] {
  // Without this, a self-targeted skill falls through to the enemy case and heals or buffs a party member.
  if (skill.target === "self") return [actor];
  if (skill.target === "allEnemies") return living;
  if (skill.target === "allAllies") return [actor, ...view.allies];
  return pickTargets(skill, archetype, actor, living, view, rng);
}

/** Each single-target hit goes to whoever guards its target; one cast never lands on the same guardian twice. */
function interceptAll(attacker: Monster, targets: Actor[], combat: CombatState, ctx: EngineContext): Actor[] {
  const mapped: Actor[] = [];
  for (const [i, target] of targets.entries()) mapped.push(interceptTarget(attacker, target, [...mapped, ...targets.slice(i + 1)], combat, ctx));
  return mapped;
}

function joinNames(actors: Actor[]): string {
  const names = actors.map((a) => a.name);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")}${t("combat.targetListJoiner")}${names[names.length - 1]}`;
}

function monsterSkillLogLine(actor: Monster, skill: SkillDefinition, targets: Actor[]): string {
  if (skill.target === "allEnemies" && !(skill.effects ?? []).some((e) => e.kind === "damage")) return t("combat.useSkillPlain", { actor: actor.name, skill: skill.name });
  if (skill.target === "allEnemies") return t("combat.monsterSkillAoe", { actor: actor.name, skill: skill.name });
  if (skill.target === "self" || skill.target === "allAllies") return t("combat.useSkillPlain", { actor: actor.name, skill: skill.name });
  return t("combat.monsterSkillOnTargets", { actor: actor.name, skill: skill.name, targets: joinNames(targets) });
}

/** Starts the skill's cooldown and spends one of its uses; a telegraph commits both on its charge turn, not on release. */
function commitSkill(actor: Monster, skill: SkillDefinition): void {
  if (skill.cooldownTurns) actor.skillCooldowns = { ...actor.skillCooldowns, [skill.id]: skill.cooldownTurns };
  if (skill.usesPerCombat !== undefined) actor.skillUses = { ...actor.skillUses, [skill.id]: (actor.skillUses?.[skill.id] ?? 0) + 1 };
}

function useMonsterSkill(skill: SkillDefinition, archetype: MonsterArchetype, actor: Monster, living: Targetable[], view: AiView, combat: CombatState, ctx: EngineContext): void {
  let targets = resolveMonsterSkillTargets(skill, archetype, actor, living, view, ctx.rng);
  // A telegraph is aimed when it is charged, so only an attack that lands now can be turned.
  if (!skill.telegraph && (skill.target === "singleEnemy" || skill.target === "allEnemies")) {
    const turned = confusedTargets(actor, targets.length, skill.target === "allEnemies", combat, ctx);
    if (turned) {
      combat.log.push({ text: t("combat.confusedAttack", { actor: actor.name }), kind: "info" });
      targets = turned;
    } else if (skill.target === "singleEnemy" && (skill.effects ?? []).some((e) => e.kind === "damage")) {
      targets = interceptAll(actor, targets, combat, ctx);
    }
  }
  commitSkill(actor, skill);
  combat.log.push({ text: monsterSkillLogLine(actor, skill, targets), kind: skill.target === "self" || skill.target === "allAllies" ? "info" : "attack" });
  applySkillEffects(skill, actor, targets, combat, ctx, combat.log);
}

export function runMonsterTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const actor = getActorByRef(ref, ctx) as Monster;
  try {
    takeMonsterTurn(actor, combat, ctx);
  } finally {
    finishMonsterTurn(actor, combat, ctx);
  }
}

/** What passes with every one of a monster's own turns, whether it acted, was stunned, or lost the turn to an Overwatch shot. */
export function finishMonsterTurn(actor: Monster, combat: CombatState, ctx: EngineContext): void {
  advanceMonsterCooldowns(actor);
  advanceShellAfterOwnTurn(actor, ctx.rng, { log: combat.log });
}

function takeMonsterTurn(actor: Monster, combat: CombatState, ctx: EngineContext): void {
  if (hasStunningStatus(actor)) {
    combat.log.push({ text: t("combat.stunnedSkipTurn", { actor: actor.name }), kind: "info" });
    noteLostTurn(combat, actor);
    return;
  }

  const living = livingPlayerSideEnemyFacingRefs(combat, ctx).map((r) => getActorByRef(r, ctx) as Targetable);
  if (living.length === 0) return;

  applyOnActStatuses(actor, combat, ctx);
  if (actor.hp <= 0) return;

  const archetype = getArchetype(actor.archetypeId);
  const view = monsterAiView(actor, combat, ctx);

  const phase = phaseToEnter(archetype, actor);
  if (phase !== undefined) {
    actor.enteredPhaseIndexes = [...(actor.enteredPhaseIndexes ?? []), phase];
    combat.log.push({ text: t("combat.monsterPhase", { actor: actor.name }), kind: "info" });
    const onEnter = archetype.phases![phase]!.onEnterSkillId;
    if (onEnter !== undefined) return useMonsterSkill(getMonsterSkill(onEnter), archetype, actor, living, view, combat, ctx);
  }

  // A silenced monster still crosses into a new phase, but every skill of its own choosing is locked.
  const silenced = actor.activeStatusEffects.some((s) => getStatusEffect(s.statusEffectId).silences);

  // skillIds spans every tier, so this must pick a self-targeted skill, not just the first one.
  if (!silenced && actor.tier === "normal" && archetype.aiPattern === "defensive" && actor.hp < actor.maxHp * BALANCE.combat.defensiveLowHpThresholdFraction) {
    const tierWeights = currentWeights(archetype, actor) ?? {};
    const selfSkillId = archetype.skillIds.find((id) => id in tierWeights && getMonsterSkill(id).target === "self");
    if (selfSkillId !== undefined && ctx.rng.chance(BALANCE.combat.defensiveLowHpSkillChance)) {
      const skill = getMonsterSkill(selfSkillId);
      combat.log.push({ text: t("combat.useSkillPlain", { actor: actor.name, skill: skill.name }), kind: "info" });
      applySkillEffects(skill, actor, [actor], combat, ctx, combat.log);
      return;
    }
  }

  const skillId = silenced ? null : pickMonsterAction(archetype, actor, view, ctx.rng);
  if (skillId !== null) return useMonsterSkill(getMonsterSkill(skillId), archetype, actor, living, view, combat, ctx);

  const turned = confusedTargets(actor, 1, false, combat, ctx);
  if (turned) {
    const victim = turned[0]!;
    combat.log.push({ text: t("combat.confusedAttack", { actor: actor.name }), kind: "info" });
    noteBasicAttack(combat, actor, victim);
    combat.log.push({ text: t("combat.basicAttack", { actor: actor.name, target: victim.name }), kind: "attack" });
    resolveSkillEffect({ kind: "damage", amount: 0 }, actor, victim, { log: combat.log, rollDamage: () => ctx.rng.next() });
    return;
  }
  const target = interceptTarget(actor, pickTargets(null, archetype, actor, living, view, ctx.rng)[0]!, [], combat, ctx);
  noteBasicAttack(combat, actor, target);
  if (!rollHits(actor, () => ctx.rng.next())) {
    noteMiss(combat, target);
    combat.log.push({ text: t("combat.missedFear", { source: actor.name, target: target.name }), kind: "info" });
    return;
  }
  if (isCharacter(target) && rollDodge(target, ctx.rng)) {
    noteMiss(combat, target);
    combat.log.push({ text: t("combat.dodge", { target: target.name, actor: actor.name }), kind: "info" });
    return;
  }
  combat.log.push({ text: t("combat.basicAttack", { actor: actor.name, target: target.name }), kind: "attack" });
  const damageDealt = resolveSkillEffect({ kind: "damage", amount: 0 }, actor, target, { log: combat.log, rollDamage: () => ctx.rng.next() });
  if (damageDealt > 0 && isCharacter(target)) applyArtifactReflectDamage(target, actor, damageDealt, combat.log);
  if (damageDealt > 0) applyMonsterHitFear(actor, target, combat, ctx);
  if (damageDealt > 0) onStruckByMonster(target, actor, combat, ctx);
}
