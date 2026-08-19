import type { Character, Monster, SkillEffect, CombatStat, SurvivalStats, ActiveStatusEffect } from "../types";
import { getStatusEffect } from "../data/statusEffects";
import { t } from "../data/strings";

const SURVIVAL_STAT_LABEL: Record<keyof SurvivalStats, string> = {
  fear: t("resolver.statLabelFear"),
  hunger: t("resolver.statLabelHunger"),
  thirst: t("resolver.statLabelThirst"),
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

// docs/gameplay-decisions.md §3: 4 bậc fear.
export type FearTier = 1 | 2 | 3 | 4;

export function getFearTier(fear: number): FearTier {
  if (fear >= 100) return 4;
  if (fear >= 70) return 3;
  if (fear >= 40) return 2;
  return 1;
}

// docs/gameplay-decisions.md §4.
export function getFearAccuracyPenalty(tier: FearTier): number {
  if (tier === 1) return 0;
  if (tier === 2) return 0.1;
  return 0.2; // tiers 3 and 4 share the same accuracy/damage penalty
}

export function getFearDamagePenalty(tier: FearTier): number {
  return tier >= 3 ? 0.15 : 0;
}

/** Tier 4 only: 25% chance per turn to lose control entirely (skip the action). */
export function rollLosesControl(fear: number, roll: () => number): boolean {
  return getFearTier(fear) === 4 && roll() < 0.25;
}

/**
 * Accuracy check for skills that target enemies ("kỹ năng nhắm địch" per
 * gameplay-decisions.md §4). Only characters have fear; monsters always hit.
 */
export function rollHits(source: Actor, roll: () => number): boolean {
  if (!isCharacter(source)) return true;
  const penalty = getFearAccuracyPenalty(getFearTier(source.survival.fear));
  return roll() >= penalty;
}

function damageMultiplierFor(source: Actor): number {
  if (!isCharacter(source)) return 1;
  return 1 - getFearDamagePenalty(getFearTier(source.survival.fear));
}

function applyCombatStatDelta(actor: Actor, stat: CombatStat, amount: number): void {
  if (stat === "aggro") {
    if (isCharacter(actor)) actor.aggro += amount;
    return; // monsters have no aggro
  }
  actor[stat] += amount;
}

export interface ResolveContext {
  log: string[];
  /** Set only for a status effect's own recurring tick (DoT) — names the effect in the damage log instead of the nonsensical "X nhận sát thương từ X". */
  statusEffectName?: string;
}

/**
 * Applies a single SkillEffect from `source` onto `target`. Returns the
 * notional amount applied for `damage`/`heal` (0 for every other kind) —
 * used by artifact hooks (docs/gameplay-decisions/07-items-artifacts.md §7.2:
 * reflectDamage/lifesteal) that need the *intended* damage, not hp lost
 * clamped by an overkill/dead target's remaining hp.
 */
export function resolveSkillEffect(effect: SkillEffect, source: Actor, target: Actor, ctx: ResolveContext): number {
  switch (effect.kind) {
    case "damage": {
      // source === target only for a status effect's own recurring tick
      // (e.g. Trúng Độc's DoT, applied via tickStatusEffects below) — that's
      // not "an attack", so it's flat effect.amount with no attack/defense/
      // fear roll involved (gameplay-decisions.md §1.3: "mỗi lượt damage 4").
      const isSelfTick = source === target;
      const finalDamage = isSelfTick
        ? Math.max(1, Math.round(effect.amount ?? 0))
        : Math.max(1, Math.round(((effect.amount ?? 0) + source.attack - target.defense) * damageMultiplierFor(source)));
      target.hp = Math.max(0, target.hp - finalDamage);
      const sourceLabel = isSelfTick && ctx.statusEffectName ? ctx.statusEffectName : nameOf(source);
      ctx.log.push(t("resolver.damage", { target: nameOf(target), amount: finalDamage, source: sourceLabel }));
      if (target.hp <= 0 && isCharacter(target)) target.isAlive = false;
      return finalDamage;
    }
    case "heal": {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + (effect.amount ?? 0));
      const healed = target.hp - before;
      ctx.log.push(t("resolver.heal", { target: nameOf(target), amount: healed }));
      return healed;
    }
    case "restoreMp": {
      if (!isCharacter(target)) return 0;
      const before = target.mp;
      target.mp = Math.min(target.maxMp, target.mp + (effect.amount ?? 0));
      ctx.log.push(t("resolver.restoreMp", { target: nameOf(target), amount: target.mp - before }));
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
      if (!isCharacter(target) || !effect.stat) return 0;
      const before = target.survival[effect.stat];
      target.survival[effect.stat] = clamp(before + (effect.amount ?? 0), 0, 100);
      const delta = target.survival[effect.stat] - before;
      // Target-as-subject, same convention as the heal/damage lines above — naming
      // the target IS the "who got buffed/debuffed" info, no separate "cho X" needed.
      if (delta !== 0) {
        const verb = delta < 0 ? t("resolver.verbDecrease") : t("resolver.verbIncrease");
        ctx.log.push(t("resolver.statChange", { target: nameOf(target), verb, amount: Math.abs(delta), stat: SURVIVAL_STAT_LABEL[effect.stat] }));
      }
      return 0;
    }
    case "modifyCombatStat": {
      if (!effect.combatStat) return 0;
      applyCombatStatDelta(target, effect.combatStat, effect.amount ?? 0);
      const delta = effect.amount ?? 0;
      if (delta !== 0) {
        const verb = delta < 0 ? t("resolver.verbDecrease") : t("resolver.verbIncrease");
        ctx.log.push(t("resolver.statChange", { target: nameOf(target), verb, amount: Math.abs(delta), stat: COMBAT_STAT_LABEL[effect.combatStat] }));
      }
      return 0;
    }
    case "triggerMiniGame": {
      // Out of scope for this prototype (see README.md) — no skill/monster uses it.
      ctx.log.push(t("resolver.miniGameSkipped"));
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
  const existing = actor.activeStatusEffects.find((s) => s.statusEffectId === statusEffectId);
  if (existing) {
    existing.turnsRemaining = def.durationTurns ?? existing.turnsRemaining;
    ctx.log.push(t("resolver.statusRefresh", { actor: nameOf(actor), effect: def.name }));
    return;
  }
  const entry: ActiveStatusEffect = { statusEffectId, turnsRemaining: def.durationTurns ?? 1 };
  actor.activeStatusEffects.push(entry);
  // Combat-stat modifiers install once immediately; they're undone once at
  // expiry (technical-decisions.md §3). Other perTurnEffects (damage/heal/
  // modifyStat) are recurring and tick at end-of-round instead (see combat.ts).
  for (const e of def.perTurnEffects) {
    if (e.kind === "modifyCombatStat" && e.combatStat) {
      applyCombatStatDelta(actor, e.combatStat, e.amount ?? 0);
    }
  }
  ctx.log.push(t("resolver.statusApply", { actor: nameOf(actor), effect: def.name }));
}

function removeStatusEffectFromActor(actor: Actor, statusEffectId: string | undefined, ctx: ResolveContext): void {
  const target = statusEffectId
    ? actor.activeStatusEffects.find((s) => s.statusEffectId === statusEffectId)
    : actor.activeStatusEffects[0]; // "gỡ 1 debuff bất kỳ" (Thanh Tẩy) — no id given, remove the first active one.
  if (!target) return;
  expireStatusEffect(actor, target, ctx);
}

/** Undoes any modifyCombatStat effects and removes the entry from the actor. */
export function expireStatusEffect(actor: Actor, active: ActiveStatusEffect, ctx: ResolveContext): void {
  const def = getStatusEffect(active.statusEffectId);
  for (const e of def.perTurnEffects) {
    if (e.kind === "modifyCombatStat" && e.combatStat) {
      applyCombatStatDelta(actor, e.combatStat, -(e.amount ?? 0));
    }
  }
  actor.activeStatusEffects = actor.activeStatusEffects.filter((s) => s !== active);
  ctx.log.push(t("resolver.statusExpire", { actor: nameOf(actor), effect: def.name }));
}

/**
 * Product of every `vulnerableTo` multiplier currently active on `actor`
 * that targets `statusEffectId` — e.g. Venom Thorn's `poison-vulnerable`
 * doubles `poisoned`'s own DoT tick (docs/gameplay-decisions/07-items-artifacts.md
 * §7.1). 1 (no-op) when nothing matches.
 */
function vulnerabilityMultiplier(actor: Actor, statusEffectId: string): number {
  let multiplier = 1;
  for (const active of actor.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (def.vulnerableTo?.statusEffectId === statusEffectId) multiplier *= def.vulnerableTo.multiplier;
  }
  return multiplier;
}

/**
 * End-of-round tick for one actor's active status effects: applies the
 * recurring (non-combat-stat) perTurnEffects once, decrements duration, and
 * expires anything that reaches 0.
 */
export function tickStatusEffects(actor: Actor, ctx: ResolveContext): void {
  for (const active of [...actor.activeStatusEffects]) {
    const def = getStatusEffect(active.statusEffectId);
    for (const e of def.perTurnEffects) {
      if (e.kind !== "modifyCombatStat") {
        const multiplier = e.kind === "damage" ? vulnerabilityMultiplier(actor, active.statusEffectId) : 1;
        const effectToApply = multiplier !== 1 ? { ...e, amount: (e.amount ?? 0) * multiplier } : e;
        resolveSkillEffect(effectToApply, actor, actor, { log: ctx.log, statusEffectName: def.name });
      }
    }
    if (!isActorAlive(actor)) continue;
    active.turnsRemaining -= 1;
    if (active.turnsRemaining <= 0) {
      expireStatusEffect(actor, active, ctx);
    }
  }
}
