import type { Character, Monster, Summon, MonsterArchetype, MonsterTier, CombatState, CombatantRef, SkillDefinition, Id } from "../types";
import { getArchetype, getMonsterSkill, EXECUTE_COOLDOWN_TURNS } from "../data/monsters";
import { BALANCE } from "../data/balanceConfig";
import { rollDodge } from "./artifacts";
import { resolveSkillEffect, rollHits, isCharacter, type Actor } from "./resolver";
import { t } from "../data/strings";
import { applyArtifactReflectDamage } from "./combatHooks";
import { getActorByRef, livingPlayerSideEnemyFacingRefs, hasStunningStatus, applySkillEffects, applyMonsterHitFear, type EngineContext } from "./combat";
import { Rng } from "./rng";
import { noteBasicAttack, noteLostTurn, noteMiss } from "./logSession";

type Targetable = Character | Summon;

function pickMonsterTarget(actor: Monster, livingTargets: Targetable[], rng: Rng): Targetable {
  if (actor.aiPattern === "opportunistic") return pickInverseAggroWeighted(livingTargets, rng);
  return pickAggroWeighted(livingTargets, rng);
}

/** `null` = the basic attack; anything else is a skill id straight out of `actionWeights`. */
type MonsterAction = Id | null;

function pickMonsterAction(archetype: MonsterArchetype, tier: MonsterTier, rng: Rng): MonsterAction {
  const weights = archetype.actionWeights?.[tier];
  if (!weights) return null;
  const candidates: [MonsterAction, number][] = [];
  for (const [key, weight] of Object.entries(weights)) {
    if (!weight || weight <= 0) continue;
    candidates.push([key === "basicAttack" ? null : key, weight]);
  }
  if (candidates.length === 0) return null;
  return rng.weightedPick(candidates, ([, weight]) => weight)[0];
}

function monsterSkillLogLine(actor: Monster, skill: SkillDefinition, targets: Actor[]): string {
  if (skill.target === "allEnemies") return t("combat.monsterSkillAoe", { actor: actor.name, skill: skill.name });
  if (skill.target === "self") return t("combat.useSkillPlain", { actor: actor.name, skill: skill.name });
  return t("combat.monsterSkillOnTarget", { actor: actor.name, skill: skill.name, target: targets[0]!.name });
}

function resolveMonsterSkillTargets(skill: SkillDefinition, actor: Monster, livingTargets: Targetable[], rng: Rng): Actor[] {
  // Without this, a self-targeted skill falls through to the enemy case and heals or buffs a party member.
  if (skill.target === "self") return [actor];
  if (skill.target === "allEnemies") return livingTargets;
  return [pickMonsterTarget(actor, livingTargets, rng)];
}

export function runMonsterTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const actor = getActorByRef(ref, ctx) as Monster;
  if (hasStunningStatus(actor)) {
    combat.log.push({ text: t("combat.stunnedSkipTurn", { actor: actor.name }), kind: "info" });
    noteLostTurn(combat, actor);
    return;
  }

  const livingChars = livingPlayerSideEnemyFacingRefs(combat, ctx).map((r) => getActorByRef(r, ctx) as Targetable);
  if (livingChars.length === 0) return;

  const archetype = getArchetype(actor.archetypeId);

  if (actor.tier === "boss" && archetype.executeSkillId) {
    if (actor.isChargingExecute) {
      const target = livingChars.find((c) => c.id === actor.executeTargetId) ?? pickAggroWeighted(livingChars, ctx.rng);
      combat.log.push({ text: t("combat.bossExecuteRelease", { actor: actor.name, target: target.name }), kind: "attack" });
      applySkillEffects(getMonsterSkill(archetype.executeSkillId), actor, [target], combat, ctx, combat.log);
      actor.isChargingExecute = false;
      actor.executeTargetId = undefined;
      actor.executeCooldownTurns = EXECUTE_COOLDOWN_TURNS;
      return;
    }
    if ((actor.executeCooldownTurns ?? 0) <= 0) {
      const target = pickAggroWeighted(livingChars, ctx.rng);
      actor.isChargingExecute = true;
      actor.executeTargetId = target.id;
      combat.log.push({ text: t("combat.bossExecuteCharge", { actor: actor.name, target: target.name }), kind: "info" });
      noteBasicAttack(combat, actor, target);
      return;
    }
    actor.executeCooldownTurns = (actor.executeCooldownTurns ?? 0) - 1;
  }

  // skillIds spans every tier, so this must pick a self-targeted skill, not just the first one.
  if (actor.tier === "normal" && archetype.aiPattern === "defensive" && actor.hp < actor.maxHp * BALANCE.combat.defensiveLowHpThresholdFraction) {
    const selfSkillId = archetype.skillIds.find((id) => getMonsterSkill(id).target === "self");
    if (selfSkillId !== undefined && ctx.rng.chance(BALANCE.combat.defensiveLowHpSkillChance)) {
      const skill = getMonsterSkill(selfSkillId);
      combat.log.push({ text: t("combat.useSkillPlain", { actor: actor.name, skill: skill.name }), kind: "info" });
      applySkillEffects(skill, actor, [actor], combat, ctx, combat.log);
      return;
    }
  }

  const skillId = pickMonsterAction(archetype, actor.tier, ctx.rng);
  if (skillId !== null) {
    const skill = getMonsterSkill(skillId);
    const targets = resolveMonsterSkillTargets(skill, actor, livingChars, ctx.rng);
    combat.log.push({ text: monsterSkillLogLine(actor, skill, targets), kind: skill.target === "self" ? "info" : "attack" });
    applySkillEffects(skill, actor, targets, combat, ctx, combat.log);
    return;
  }

  const target = pickMonsterTarget(actor, livingChars, ctx.rng);
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
}

function pickAggroWeighted(characters: Targetable[], rng: Rng): Targetable {
  return rng.weightedPick(characters, (c) => Math.max(1, c.aggro));
}

/** Reflects each aggro across the party's current range (max + min - aggro), so the quietest is
 *  picked as often as the loudest would be, keeping the party's actual spread rather than 1/aggro. */
function pickInverseAggroWeighted(characters: Targetable[], rng: Rng): Targetable {
  const aggros = characters.map((c) => c.aggro);
  const mirror = Math.max(...aggros) + Math.min(...aggros);
  return rng.weightedPick(characters, (c) => Math.max(1, mirror - c.aggro));
}
