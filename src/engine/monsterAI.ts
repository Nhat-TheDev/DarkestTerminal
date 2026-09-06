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
  if (actor.aiPattern === "erratic") return rng.pick(livingChars);
  return pickAggroWeighted(livingChars, rng);
}

type WeightKey = "basicAttack" | "skill" | "strike" | "cleave" | "debuff";

function pickMonsterAction(archetype: MonsterArchetype, tier: MonsterTier, rng: Rng): WeightKey {
  const weights = archetype.actionWeights?.[tier];
  if (!weights) return "basicAttack";
  const candidates: [WeightKey, number][] = [];
  for (const [key, weight] of Object.entries(weights) as [WeightKey, number | undefined][]) {
    if (!weight || weight <= 0) continue;
    if (!hasSkillForWeightKey(archetype, key)) continue;
    candidates.push([key, weight]);
  }
  if (candidates.length === 0) return "basicAttack";
  return rng.weightedPick(candidates, ([, weight]) => weight)[0];
}

function hasSkillForWeightKey(archetype: MonsterArchetype, key: WeightKey): boolean {
  if (key === "skill") return archetype.skillIds.length > 0;
  if (key === "strike" || key === "cleave") return Boolean(archetype.eliteSkillIds);
  if (key === "debuff") return Boolean(archetype.bossSkillIds);
  return true;
}

/**
 * The one place an action-weight key still means anything: which skill it names. Everything
 * downstream — who it hits, how it reads in the log — comes from the skill itself, which is why
 * strike/cleave/debuff/skill all resolve into a single branch below.
 */
function skillIdForWeightKey(archetype: MonsterArchetype, key: WeightKey, rng: Rng): Id {
  if (key === "strike") return archetype.eliteSkillIds!.strike;
  if (key === "cleave") return archetype.eliteSkillIds!.cleave;
  if (key === "debuff") return archetype.bossSkillIds!.debuff;
  return rng.pick(archetype.skillIds);
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

  const weightKey = pickMonsterAction(archetype, actor.tier, ctx.rng);
  switch (weightKey) {
    case "skill":
    case "strike":
    case "cleave":
    case "debuff": {
      const skill = getMonsterSkill(skillIdForWeightKey(archetype, weightKey, ctx.rng));
      const targets = resolveMonsterSkillTargets(skill, actor, livingChars, ctx.rng);
      combat.log.push({ text: monsterSkillLogLine(actor, skill, targets), kind: skill.target === "self" ? "info" : "attack" });
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
