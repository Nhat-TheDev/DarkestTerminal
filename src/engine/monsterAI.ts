import type { Character, Monster, MonsterArchetype, MonsterTier, CombatState, CombatantRef, SkillDefinition } from "../types";
import { getArchetype, getMonsterSkill, EXECUTE_COOLDOWN_TURNS } from "../data/monsters";
import { BALANCE } from "../data/balanceConfig";
import { rollDodge } from "./artifacts";
import { resolveSkillEffect, rollHits } from "./resolver";
import { t } from "../data/strings";
import { applyArtifactReflectDamage } from "./combatHooks";
import { getActorByRef, livingCharacterRefs, hasStunningStatus, applySkillEffects, type EngineContext } from "./combat";
import { Rng } from "./rng";

function pickMonsterTarget(actor: Monster, livingChars: Character[], rng: Rng): Character {
  if (actor.aiPattern === "erratic") return rng.pick(livingChars);
  return pickAggroWeighted(livingChars, rng);
}

type MonsterAction = "basicAttack" | "skill" | "strike" | "cleave" | "debuff";

function pickMonsterAction(archetype: MonsterArchetype, tier: MonsterTier, rng: Rng): MonsterAction {
  const weights = archetype.actionWeights?.[tier];
  if (!weights) return "basicAttack";
  const candidates: [MonsterAction, number][] = [];
  for (const [key, weight] of Object.entries(weights) as [MonsterAction, number | undefined][]) {
    if (!weight || weight <= 0) continue;
    if (key === "skill" && archetype.skillIds.length === 0) continue;
    if ((key === "strike" || key === "cleave") && !archetype.eliteSkillIds) continue;
    if (key === "debuff" && !archetype.bossSkillIds) continue;
    candidates.push([key, weight]);
  }
  if (candidates.length === 0) return "basicAttack";
  return rng.weightedPick(candidates, ([, weight]) => weight)[0];
}

function resolveMonsterSkillTargets(skill: SkillDefinition, actor: Monster, livingChars: Character[], rng: Rng): Character[] {
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

  if (actor.tier === "boss" && archetype.bossSkillIds) {
    if (actor.isChargingExecute) {
      const target = livingChars.find((c) => c.id === actor.executeTargetId) ?? pickAggroWeighted(livingChars, ctx.rng);
      combat.log.push({ text: t("combat.bossExecuteRelease", { actor: actor.name, target: target.name }), kind: "attack" });
      applySkillEffects(getMonsterSkill(archetype.bossSkillIds.execute), actor, [target], combat, ctx, combat.log);
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

  if (
    actor.tier === "normal" &&
    archetype.aiPattern === "defensive" &&
    archetype.skillIds.length > 0 &&
    actor.hp < actor.maxHp * 0.4 &&
    ctx.rng.chance(BALANCE.combat.defensiveLowHpSkillChance)
  ) {
    const skill = getMonsterSkill(archetype.skillIds[0]!);
    combat.log.push({ text: t("combat.useSkillPlain", { actor: actor.name, skill: skill.name }), kind: "info" });
    applySkillEffects(skill, actor, [actor], combat, ctx, combat.log);
    return;
  }

  switch (pickMonsterAction(archetype, actor.tier, ctx.rng)) {
    case "debuff": {
      const target = pickAggroWeighted(livingChars, ctx.rng);
      const skill = getMonsterSkill(archetype.bossSkillIds!.debuff);
      combat.log.push({ text: t("combat.useSkillPlain", { actor: actor.name, skill: skill.name }), kind: "info" });
      applySkillEffects(skill, actor, [target], combat, ctx, combat.log);
      return;
    }
    case "cleave": {
      const skill = getMonsterSkill(archetype.eliteSkillIds!.cleave);
      combat.log.push({ text: t("combat.eliteCleave", { actor: actor.name, skill: skill.name }), kind: "attack" });
      applySkillEffects(skill, actor, livingChars, combat, ctx, combat.log);
      return;
    }
    case "strike": {
      const target = pickMonsterTarget(actor, livingChars, ctx.rng);
      const skill = getMonsterSkill(archetype.eliteSkillIds!.strike);
      combat.log.push({ text: t("combat.eliteStrike", { actor: actor.name, skill: skill.name, target: target.name }), kind: "attack" });
      applySkillEffects(skill, actor, [target], combat, ctx, combat.log);
      return;
    }
    case "skill": {
      const skill = getMonsterSkill(ctx.rng.pick(archetype.skillIds));
      const targets = resolveMonsterSkillTargets(skill, actor, livingChars, ctx.rng);
      combat.log.push({ text: t("combat.useSkillPlain", { actor: actor.name, skill: skill.name }), kind: "info" });
      applySkillEffects(skill, actor, targets, combat, ctx, combat.log);
      return;
    }
    case "basicAttack": {
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
      return;
    }
  }
}

function pickAggroWeighted(characters: Character[], rng: Rng): Character {
  return rng.weightedPick(characters, (c) => Math.max(1, c.aggro));
}
