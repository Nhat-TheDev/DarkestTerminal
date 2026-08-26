import type { Character, Monster, SkillEffect, CombatStat, SurvivalStats, ActiveStatusEffect, LogEntry, StatusEffectDefinition, GameState } from "../types";
import { getStatusEffect, statusDisplayName } from "../data/statusEffects";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";

export function isHelpfulStatusEffect(def: StatusEffectDefinition): boolean {
  if (def.stuns || def.vulnerableTo || def.accuracyPenaltyPercent) return false;
  if (def.perTurnEffects.some((e) => e.kind === "damage")) return false;
  if (def.perTurnEffects.some((e) => e.kind === "modifyCombatStat" && (e.amount ?? 0) < 0)) return false;
  return true;
}

const SURVIVAL_STAT_LABEL: Record<keyof SurvivalStats, string> = {
  fear: t("resolver.statLabelFear"),
};

const COMBAT_STAT_LABEL: Record<CombatStat, string> = {
  attack: t("resolver.statLabelAttack"),
  defense: t("resolver.statLabelDefense"),
  aggro: t("resolver.statLabelAggro"),
  speed: t("resolver.statLabelSpeed"),
};

export type Actor = Character | Monster;

export function isCharacter(actor: Actor): actor is Character {
  return "classId" in actor;
}

export function isActorAlive(actor: Actor): boolean {
  return isCharacter(actor) ? actor.isAlive && actor.hp > 0 : actor.hp > 0;
}

export type FearTier = 1 | 2 | 3 | 4;

export function getFearTier(fear: number): FearTier {
  if (fear >= 100) return 4;
  if (fear >= 70) return 3;
  if (fear >= 40) return 2;
  return 1;
}

export function getFearAccuracyPenalty(tier: FearTier): number {
  if (tier === 1) return 0;
  if (tier === 2) return 0.1;
  return 0.2;
}

export function getFearDamagePenalty(tier: FearTier): number {
  return tier >= 3 ? 0.15 : 0;
}

export function rollLosesControl(fear: number, roll: () => number): boolean {
  return getFearTier(fear) === 4 && roll() < 0.25;
}

function statusAccuracyPenaltyPercent(source: Actor): number {
  let total = 0;
  for (const active of source.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (def.accuracyPenaltyPercent) total += def.accuracyPenaltyPercent;
  }
  return total;
}

export function rollHits(source: Actor, roll: () => number): boolean {
  const fearPenalty = isCharacter(source) ? getFearAccuracyPenalty(getFearTier(source.survival.fear)) : 0;
  const penalty = Math.min(1, fearPenalty + statusAccuracyPenaltyPercent(source) / 100);
  return roll() >= penalty;
}

function damageMultiplierFor(source: Actor): number {
  if (!isCharacter(source)) return 1;
  return 1 - getFearDamagePenalty(getFearTier(source.survival.fear));
}

function applyCombatStatDelta(actor: Actor, stat: CombatStat, amount: number): void {
  if (stat === "aggro") {
    if (isCharacter(actor)) actor.aggro += amount;
    return;
  }
  actor[stat] += amount;
}

export interface ResolveContext {
  log: LogEntry[];
  statusEffectName?: string;
  /** Name of the skill this effect came from, shown in the damage log line ("X takes N damage from Y's Skill."). Omit for basic attacks and other unnamed sources. */
  skillName?: string;
  isMagic?: boolean;
  /** Required for a `modifyStat` effect targeting `"satiety"` — that stat lives on GameState (party-wide), not on the Character. */
  gameState?: GameState;
}

function offensiveStatFor(source: Actor, isMagic: boolean | undefined): number {
  if (isMagic && isCharacter(source)) return source.magicPower;
  return source.attack;
}

export function mitigatedOffense(off: number, def: number): number {
  return off - off * (def / (BALANCE.combat.defenseMitigationX + def)) - def / BALANCE.combat.defenseMitigationY;
}

export function resolveSkillEffect(effect: SkillEffect, source: Actor, target: Actor, ctx: ResolveContext): number {
  switch (effect.kind) {
    case "damage": {
      const isSelfTick = source === target;
      const effectiveDefense = target.defense * (1 - (effect.ignoreDefensePercent ?? 0) / 100);
      const finalDamage = isSelfTick
        ? Math.max(1, Math.round(effect.amount ?? 0))
        : Math.max(
            1,
            Math.round(
              ((effect.amount ?? 0) + mitigatedOffense(offensiveStatFor(source, ctx.isMagic), effectiveDefense)) * damageMultiplierFor(source)
            )
          );
      target.hp = Math.max(0, target.hp - finalDamage);
      const sourceLabel = isSelfTick && ctx.statusEffectName ? ctx.statusEffectName : nameOf(source);
      const damageText =
        !isSelfTick && ctx.skillName
          ? t("resolver.damageWithSkill", { target: nameOf(target), amount: finalDamage, source: sourceLabel, skill: ctx.skillName })
          : t("resolver.damage", { target: nameOf(target), amount: finalDamage, source: sourceLabel });
      ctx.log.push({ text: damageText, kind: "attack" });
      if (target.hp <= 0 && isCharacter(target)) target.isAlive = false;
      if (target.hp <= 0) ctx.log.push({ text: t("resolver.defeated", { target: nameOf(target) }), kind: "death" });
      if (!isSelfTick && effect.lifestealPercent) {
        const healed = Math.min(source.maxHp - source.hp, Math.round(finalDamage * (effect.lifestealPercent / 100)));
        if (healed > 0) {
          source.hp += healed;
          ctx.log.push({ text: t("resolver.heal", { target: nameOf(source), amount: healed }), kind: "heal" });
        }
      }
      return finalDamage;
    }
    case "heal": {
      const before = target.hp;
      const healPower = ctx.isMagic && isCharacter(source) ? source.magicPower : 0;
      target.hp = Math.min(target.maxHp, target.hp + (effect.amount ?? 0) + healPower);
      const healed = target.hp - before;
      ctx.log.push({ text: t("resolver.heal", { target: nameOf(target), amount: healed }), kind: "heal" });
      return healed;
    }
    case "restoreMp": {
      if (!isCharacter(target)) return 0;
      const before = target.mp;
      target.mp = Math.min(target.maxMp, target.mp + (effect.amount ?? 0));
      ctx.log.push({ text: t("resolver.restoreMp", { target: nameOf(target), amount: target.mp - before }), kind: "heal" });
      return 0;
    }
    case "applyStatusEffect": {
      if (!effect.statusEffectId) return 0;
      applyStatusEffectToActor(target, effect.statusEffectId, ctx);
      return 0;
    }
    case "removeStatusEffect": {
      removeStatusEffectFromActor(target, effect.statusEffectId, ctx);
      return 0;
    }
    case "modifyStat": {
      if (!effect.stat) return 0;
      if (effect.stat === "satiety") {
        if (!ctx.gameState) return 0;
        const before = ctx.gameState.satiety;
        ctx.gameState.satiety = clamp(before + (effect.amount ?? 0), 0, 100);
        const delta = ctx.gameState.satiety - before;
        if (delta !== 0) {
          const verb = delta < 0 ? t("resolver.verbDecrease") : t("resolver.verbIncrease");
          ctx.log.push({
            text: t("resolver.statChange", { target: t("resolver.partyTarget"), verb, amount: Math.abs(delta), stat: t("resolver.statLabelSatiety") }),
            kind: delta < 0 ? "debuff" : "buff",
          });
        }
        return 0;
      }
      if (!isCharacter(target)) return 0;
      const before = target.survival[effect.stat];
      target.survival[effect.stat] = clamp(before + (effect.amount ?? 0), 0, 100);
      const delta = target.survival[effect.stat] - before;
      if (delta !== 0) {
        const verb = delta < 0 ? t("resolver.verbDecrease") : t("resolver.verbIncrease");
        ctx.log.push({
          text: t("resolver.statChange", { target: nameOf(target), verb, amount: Math.abs(delta), stat: SURVIVAL_STAT_LABEL[effect.stat] }),
          kind: delta < 0 ? "buff" : "debuff",
        });
      }
      return 0;
    }
    case "modifyCombatStat": {
      if (!effect.combatStat) return 0;
      applyCombatStatDelta(target, effect.combatStat, effect.amount ?? 0);
      const delta = effect.amount ?? 0;
      if (delta !== 0) {
        const verb = delta < 0 ? t("resolver.verbDecrease") : t("resolver.verbIncrease");
        ctx.log.push({
          text: t("resolver.statChange", { target: nameOf(target), verb, amount: Math.abs(delta), stat: COMBAT_STAT_LABEL[effect.combatStat] }),
          kind: delta < 0 ? "debuff" : "buff",
        });
      }
      return 0;
    }
    case "triggerMiniGame": {
      ctx.log.push({ text: t("resolver.miniGameSkipped"), kind: "info" });
      return 0;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nameOf(actor: Actor): string {
  return actor.name;
}

function applyStatusEffectToActor(actor: Actor, statusEffectId: string, ctx: ResolveContext): void {
  const def = getStatusEffect(statusEffectId);
  // Buffs count down starting the same round they're cast in (tick right after that round's action
  // phase). Debuffs delay their countdown by 1 round — the round they're cast in is "free," and the
  // duration is only consumed starting from the action phase after the one that cast it.
  const deferFirstTick = !isHelpfulStatusEffect(def);
  const existing = actor.activeStatusEffects.find((s) => s.statusEffectId === statusEffectId);
  if (existing) {
    existing.turnsRemaining = def.durationTurns ?? existing.turnsRemaining;
    existing.justApplied = deferFirstTick;
    ctx.log.push({ text: t("resolver.statusRefresh", { actor: nameOf(actor), effect: statusDisplayName(def) }), kind: isHelpfulStatusEffect(def) ? "buff" : "debuff" });
    return;
  }
  const entry: ActiveStatusEffect = { statusEffectId, turnsRemaining: def.durationTurns ?? 1, justApplied: deferFirstTick };
  actor.activeStatusEffects.push(entry);
  for (const e of def.perTurnEffects) {
    if (e.kind === "modifyCombatStat" && e.combatStat) {
      applyCombatStatDelta(actor, e.combatStat, e.amount ?? 0);
    }
  }
  ctx.log.push({ text: t("resolver.statusApply", { actor: nameOf(actor), effect: statusDisplayName(def) }), kind: isHelpfulStatusEffect(def) ? "buff" : "debuff" });
}

function removeStatusEffectFromActor(actor: Actor, statusEffectId: string | undefined, ctx: ResolveContext): void {
  const target = statusEffectId
    ? actor.activeStatusEffects.find((s) => s.statusEffectId === statusEffectId)
    : actor.activeStatusEffects[0];
  if (!target) return;
  expireStatusEffect(actor, target, ctx);
}

export function expireStatusEffect(actor: Actor, active: ActiveStatusEffect, ctx: ResolveContext): void {
  const def = getStatusEffect(active.statusEffectId);
  for (const e of def.perTurnEffects) {
    if (e.kind === "modifyCombatStat" && e.combatStat) {
      applyCombatStatDelta(actor, e.combatStat, -(e.amount ?? 0));
    }
  }
  actor.activeStatusEffects = actor.activeStatusEffects.filter((s) => s !== active);
  ctx.log.push({ text: t("resolver.statusExpire", { actor: nameOf(actor), effect: statusDisplayName(def) }), kind: "info" });
}

function vulnerabilityMultiplier(actor: Actor, statusEffectId: string): number {
  let multiplier = 1;
  for (const active of actor.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (def.vulnerableTo?.statusEffectId === statusEffectId) multiplier *= def.vulnerableTo.multiplier;
  }
  return multiplier;
}

export function tickStatusEffects(actor: Actor, ctx: ResolveContext): void {
  for (const active of [...actor.activeStatusEffects]) {
    const def = getStatusEffect(active.statusEffectId);
    for (const e of def.perTurnEffects) {
      if (e.kind !== "modifyCombatStat") {
        const multiplier = e.kind === "damage" ? vulnerabilityMultiplier(actor, active.statusEffectId) : 1;
        const effectToApply = multiplier !== 1 ? { ...e, amount: (e.amount ?? 0) * multiplier } : e;
        resolveSkillEffect(effectToApply, actor, actor, { log: ctx.log, statusEffectName: statusDisplayName(def) });
      }
    }
    if (!isActorAlive(actor)) continue;
    if (active.justApplied) {
      // Debuff applied/refreshed this same round — its countdown starts next round instead.
      active.justApplied = false;
      continue;
    }
    active.turnsRemaining -= 1;
    if (active.turnsRemaining <= 0) {
      expireStatusEffect(actor, active, ctx);
    }
  }
}
