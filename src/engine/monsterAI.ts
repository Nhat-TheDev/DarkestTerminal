import type { Character, Monster, MonsterArchetype, MonsterTier, CombatState, CombatantRef, SkillDefinition, Id } from "../types";
import { getArchetype, getMonsterSkill, EXECUTE_COOLDOWN_TURNS } from "../data/monsters";
import { BALANCE } from "../data/balanceConfig";
import { rollDodge } from "./artifacts";
import { resolveSkillEffect, rollHits, type Actor } from "./resolver";
import { t } from "../data/strings";
import { applyArtifactReflectDamage } from "./combatHooks";
import { getActorByRef, livingCharacterRefs, hasStunningStatus, applySkillEffects, type EngineContext } from "./combat";
import { Rng } from "./rng";

function pickMonsterTarget(actor: Monster, livingChars: Character[], rng: Rng): Character {
  if (actor.aiPattern === "opportunistic") return pickInverseAggroWeighted(livingChars, rng);
  return pickAggroWeighted(livingChars, rng);
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

function resolveMonsterSkillTargets(skill: SkillDefinition, actor: Monster, livingChars: Character[], rng: Rng): Actor[] {
  // A monster's self-targeted skill (Regeneration, Guard Stance) has to land on the monster.
  // Without this branch it falls through to the enemy case and the monster heals or buffs a
  // party member instead — reachable the moment such a skill is given a non-zero action weight.
  if (skill.target === "self") return [actor];
  if (skill.target === "allEnemies") return livingChars;
  return [pickMonsterTarget(actor, livingChars, rng)];
}

export function runMonsterTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const actor = getActorByRef(ref, ctx) as Monster;
  if (hasStunningStatus(actor)) {
    combat.log.push({ text: t("combat.stunnedSkipTurn", { actor: actor.name }), kind: "info" });
    return;
  }

  const livingChars = livingCharacterRefs(combat, ctx).map((r) => getActorByRef(r, ctx) as Character);
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
      return;
    }
    actor.executeCooldownTurns = (actor.executeCooldownTurns ?? 0) - 1;
  }

  // A defensive monster low on HP reaches for its own self-heal / self-buff. Resolved inside the
  // branch rather than above it: this is a rare case, and every monster turn would otherwise pay
  // for a catalog lookup per skill id. It has to be a self-targeted skill specifically — skillIds
  // holds every skill an archetype can roll at any tier, so taking the first one would have a
  // normal-tier Skeleton Guard swinging Cleaving Strike at itself.
  if (actor.tier === "normal" && archetype.aiPattern === "defensive" && actor.hp < actor.maxHp * 0.4) {
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
  if (!rollHits(actor, () => ctx.rng.next())) {
    combat.log.push({ text: t("combat.missedFear", { source: actor.name, target: target.name }), kind: "info" });
    return;
  }
  if (rollDodge(target, ctx.rng)) {
    combat.log.push({ text: t("combat.dodge", { target: target.name, actor: actor.name }), kind: "info" });
    return;
  }
  combat.log.push({ text: t("combat.basicAttack", { actor: actor.name, target: target.name }), kind: "attack" });
  const damageDealt = resolveSkillEffect({ kind: "damage", amount: 0 }, actor, target, { log: combat.log });
  if (damageDealt > 0) applyArtifactReflectDamage(target, actor, damageDealt, combat.log);
}

function pickAggroWeighted(characters: Character[], rng: Rng): Character {
  return rng.weightedPick(characters, (c) => Math.max(1, c.aggro));
}

/**
 * The mirror of pickAggroWeighted: every aggro value is reflected across the party's own current
 * range, so the quietest character is picked as often as the loudest would otherwise have been.
 * Reflecting rather than inverting (1/aggro) keeps whatever spread the party actually has instead
 * of flattening it to a fixed ratio no matter how hard anyone taunts.
 *
 * The consequence is deliberate: Shield Guard's +40 aggro pushes the Vanguard out of danger and
 * pulls the rest of the party into it, so taunting is the wrong move against these archetypes.
 */
function pickInverseAggroWeighted(characters: Character[], rng: Rng): Character {
  const aggros = characters.map((c) => c.aggro);
  const mirror = Math.max(...aggros) + Math.min(...aggros);
  return rng.weightedPick(characters, (c) => Math.max(1, mirror - c.aggro));
}
