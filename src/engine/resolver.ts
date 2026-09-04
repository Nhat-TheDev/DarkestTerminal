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

export type StatusCategory = "dot" | "statMod" | "special";

/**
 * Which of the 3 turn-countdown schedules a status follows. Normally inferred from its own
 * perTurnEffects shape (a status is either a HP/MP-over-time effect, a stat modifier, or a
 * "special" effect with no per-turn tick of its own, e.g. stuns/on-hit riders) — `tickCategory`
 * overrides that inference for a status whose shape doesn't match its intended timing, e.g. a
 * pure stat-mod rider that must stay in lockstep with a "special" status it's always co-applied with.
 */
export function statusCategory(def: StatusEffectDefinition): StatusCategory {
  if (def.tickCategory) return def.tickCategory;
  if (def.perTurnEffects.some((e) => e.kind === "damage" || e.kind === "heal" || e.kind === "restoreMp")) return "dot";
  if (def.perTurnEffects.some((e) => e.kind === "modifyCombatStat")) return "statMod";
  return "special";
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
      for (const id of effect.alsoApplyStatusEffectIds ?? []) applyStatusEffectToActor(target, id, ctx);
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
  const existingIndex = actor.activeStatusEffects.findIndex((s) => s.statusEffectId === statusEffectId);
  if (existingIndex !== -1) {
    // Replaced, not mutated in place: a fresh object identity keeps a refreshed "special" status out of
    // the eligibility snapshot tickSpecialEffects checks (see specialStatusSnapshot), so re-casting an
    // active special status doesn't lose a tick to the very turn that refreshed it — same as a first cast.
    const existing = actor.activeStatusEffects[existingIndex]!;
    actor.activeStatusEffects[existingIndex] = { statusEffectId, turnsRemaining: def.durationTurns ?? existing.turnsRemaining };
    ctx.log.push({ text: t("resolver.statusRefresh", { actor: nameOf(actor), effect: statusDisplayName(def) }), kind: isHelpfulStatusEffect(def) ? "buff" : "debuff" });
    return;
  }
  const entry: ActiveStatusEffect = { statusEffectId, turnsRemaining: def.durationTurns ?? 1 };
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

/**
 * Every active-status-effect entry currently on `actor` whose category is "special" — used to
 * snapshot which ones existed *before* this actor's own turn runs, so tickSpecialEffects can tell
 * "already active" from "just applied (or refreshed) by this very turn" without a per-status flag.
 * Tracked by object identity, not statusEffectId: a refresh replaces the entry's identity (see
 * applyStatusEffectToActor), so a status re-cast on its own actor's turn falls out of this snapshot
 * exactly like a first cast would.
 */
export function specialStatusSnapshot(actor: Actor): ReadonlySet<ActiveStatusEffect> {
  return new Set(actor.activeStatusEffects.filter((s) => statusCategory(getStatusEffect(s.statusEffectId)) === "special"));
}

/** Shared tail for every tick path: decrement, then expire once it runs out. */
function decrementAndMaybeExpire(actor: Actor, active: ActiveStatusEffect, ctx: ResolveContext): void {
  active.turnsRemaining -= 1;
  if (active.turnsRemaining <= 0) {
    expireStatusEffect(actor, active, ctx);
  }
}

/** Shared by tickDotEffects/tickStatModEffects — both always tick everything of their category. */
function tickCategoryUnconditionally(actor: Actor, category: "dot" | "statMod", ctx: ResolveContext): void {
  for (const active of [...actor.activeStatusEffects]) {
    const def = getStatusEffect(active.statusEffectId);
    if (statusCategory(def) !== category) continue;
    if (category === "dot") {
      for (const e of def.perTurnEffects) {
        if (e.kind !== "damage" && e.kind !== "heal" && e.kind !== "restoreMp") continue;
        const multiplier = e.kind === "damage" ? vulnerabilityMultiplier(actor, active.statusEffectId) : 1;
        const effectToApply = multiplier !== 1 ? { ...e, amount: (e.amount ?? 0) * multiplier } : e;
        resolveSkillEffect(effectToApply, actor, actor, { log: ctx.log, statusEffectName: statusDisplayName(def) });
      }
      if (!isActorAlive(actor)) continue;
    }
    decrementAndMaybeExpire(actor, active, ctx);
  }
}

/**
 * Called once at the very start of resolveRound, before any actions this round. A DoT/HoT applied
 * *during* this round can't have existed yet when this round's start-tick ran, so it's naturally
 * untouched until the following round's start-tick — a free round with no bookkeeping needed.
 */
export function tickDotEffects(actor: Actor, ctx: ResolveContext): void {
  tickCategoryUnconditionally(actor, "dot", ctx);
}

/**
 * Called once at the end of resolveRound, for every combatant, unconditionally. A fresh stat
 * modifier ticks down the instant the round it was cast in ends — no free round.
 */
export function tickStatModEffects(actor: Actor, ctx: ResolveContext): void {
  tickCategoryUnconditionally(actor, "statMod", ctx);
}

/**
 * Called once per combatant, immediately after resolveRound processes that combatant's own turn
 * (whether they acted, fizzled, or were skipped for being stunned) — only for statuses present in
 * `eligible` (a snapshot taken *before* that turn ran, via specialStatusSnapshot). Skipping anything
 * not in that snapshot is what stops a status from ticking on the very turn that applied (or
 * refreshed) it — e.g. a self-cast buff's own casting action must not count as its first "turn used".
 * Because each combatant gets exactly one turn per round, this alone reproduces the full range of
 * expected timing: a self-cast status (the casting action IS this round's turn) starts ticking next
 * round; a status inflicted on a slower target who hasn't acted yet this round — already present
 * before their own turn runs — ticks as soon as that still-pending turn resolves, later in this same
 * round.
 */
export function tickSpecialEffects(actor: Actor, eligible: ReadonlySet<ActiveStatusEffect>, ctx: ResolveContext): void {
  for (const active of [...actor.activeStatusEffects]) {
    const def = getStatusEffect(active.statusEffectId);
    if (statusCategory(def) !== "special") continue;
    if (!eligible.has(active)) continue;
    decrementAndMaybeExpire(actor, active, ctx);
  }
}
