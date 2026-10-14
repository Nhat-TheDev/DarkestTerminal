import type { Character, Monster, Summon, MonsterArchetype, CombatState, CombatantRef, SkillDefinition, Id } from "../types";
import { getArchetype, getMonsterSkill } from "../data/monsters";
import { BALANCE } from "../data/balanceConfig";
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
  triggerCounterAttack,
  type EngineContext,
} from "./combat";
import { getStatusEffect } from "../data/statusEffects";
import { Rng } from "./rng";
import { noteBasicAttack, noteLostTurn, noteMiss } from "./logSession";
import { predicateHolds, scoreWeight, type AiView } from "./monsterAiRules";
import { advanceShellAfterOwnTurn } from "./monsterShell";

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
 * The aggro weighting an `aiPattern` targets by, computed once over the whole living pool.
 *
 * An "opportunistic" monster mirrors every aggro value across the party's own current range, so the
 * quietest character is picked as often as the loudest would otherwise have been. Reflecting rather
 * than inverting (1/aggro) keeps whatever spread the party actually has instead of flattening it to
 * a fixed ratio no matter how hard anyone taunts.
 *
 * The consequence is deliberate: Shield Guard's +40 aggro pushes the Vanguard out of danger and
 * pulls the rest of the party into it, so taunting is the wrong move against these archetypes.
 */
function aggroWeight(actor: Monster, living: Targetable[]): (c: Targetable) => number {
  if (actor.aiPattern !== "opportunistic") return (c) => Math.max(1, c.aggro);
  const aggros = living.map((c) => c.aggro);
  const mirror = Math.max(...aggros) + Math.min(...aggros);
  return (c) => Math.max(1, mirror - c.aggro);
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
  const base = aggroWeight(actor, living);
  const pool = [...living];
  const picked: Targetable[] = [];
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
  const targets = resolveMonsterSkillTargets(skill, archetype, actor, living, view, ctx.rng);
  commitSkill(actor, skill);
  if (skill.telegraph) {
    actor.charging = { skillId: skill.id, targetIds: skill.target === "singleEnemy" ? targets.map((a) => a.id) : [] };
    if (skill.chargeEffects?.length) applySkillEffects({ ...skill, target: "self", effects: skill.chargeEffects }, actor, [actor], combat, ctx, combat.log);
    combat.log.push({
      text:
        skill.target === "singleEnemy"
          ? t("combat.telegraphCharge", { actor: actor.name, skill: skill.name, targets: joinNames(targets) })
          : t("combat.telegraphChargeAoe", { actor: actor.name, skill: skill.name }),
      kind: "info",
    });
    if (skill.target === "singleEnemy") for (const target of targets) noteBasicAttack(combat, actor, target);
    return;
  }
  combat.log.push({ text: monsterSkillLogLine(actor, skill, targets), kind: skill.target === "self" || skill.target === "allAllies" ? "info" : "attack" });
  applySkillEffects(skill, actor, targets, combat, ctx, combat.log);
}

/** Releases the charged skill: on the targets it locked (any that died are re-picked by the skill's own target rules), or on everyone alive for an area telegraph. */
function releaseCharge(archetype: MonsterArchetype, actor: Monster, living: Targetable[], view: AiView, combat: CombatState, ctx: EngineContext): void {
  const skill = getMonsterSkill(actor.charging!.skillId);
  let targets: Actor[];
  if (skill.target !== "singleEnemy") {
    targets = resolveMonsterSkillTargets(skill, archetype, actor, living, view, ctx.rng);
  } else {
    const locked = actor.charging!.targetIds.map((id) => living.find((c) => c.id === id)).filter((c): c is Targetable => c !== undefined);
    const lost = actor.charging!.targetIds.length - locked.length;
    targets = lost > 0 ? [...locked, ...pickTargets(skill, archetype, actor, living.filter((c) => !locked.includes(c)), view, ctx.rng, lost)] : locked;
    if (targets.length === 0) targets = pickTargets(skill, archetype, actor, living, view, ctx.rng);
  }
  actor.charging = undefined;
  combat.log.push({ text: t("combat.telegraphRelease", { actor: actor.name, skill: skill.name }), kind: "attack" });
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

  if (actor.charging) return releaseCharge(archetype, actor, living, view, combat, ctx);

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

  const target = pickTargets(null, archetype, actor, living, view, ctx.rng)[0]!;
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
  if (damageDealt > 0) triggerCounterAttack(target, combat, ctx);
}
