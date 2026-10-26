import type { Character, Monster, Summon, SkillEffect, CombatStat, SurvivalStats, ActiveStatusEffect, LogEntry, StatusEffectDefinition, GameState, DamageType, Id } from "../types";
import { getStatusEffect, statusDisplayName, statusSatisfiesRequirement, COMBAT_STAT_LABEL } from "../data/statusEffects";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";
import { resolveRaceProfile } from "../data/monsterRaces";
import { getClass, ownPassiveRank, passiveRankDef } from "../data/classes";
import { adjustFear, formatFear, resistedFearGain } from "./survival";
import { noteShellHit, shellAdjustedDamage } from "./monsterShell";
import { advanceBar } from "./monsterBars";

export function isHelpfulStatusEffect(def: StatusEffectDefinition): boolean {
  if (def.harmful) return false;
  if (def.stuns || def.vulnerableTo || def.accuracyPenaltyPercent) return false;
  if (def.perTurnEffects.some((e) => e.kind === "damage")) return false;
  if (def.perTurnEffects.some((e) => e.kind === "modifyCombatStat" && statDirection(e) < 0)) return false;
  return true;
}

/** Sign of `amount`, or of `minPercent` when `amount` is 0. */
export function statDirection(effect: { amount?: number; minPercent?: number }): number {
  return Math.sign(effect.amount ?? 0) || Math.sign(effect.minPercent ?? 0);
}

export type StatusRole = "buff" | "debuff" | "heal";

export function statusRole(def: StatusEffectDefinition): StatusRole | null {
  const statChanges = def.perTurnEffects.filter((e) => e.kind === "modifyCombatStat");
  if (statChanges.length > 0) return statChanges.some((e) => statDirection(e) < 0) ? "debuff" : "buff";
  if (def.stuns || def.accuracyPenaltyPercent) return "debuff";
  if (def.dodgePercent) return "buff";
  if (def.perTurnEffects.some((e) => e.kind === "heal" || e.kind === "restoreMp")) return "heal";
  return null;
}

export type StatusCategory = "dot" | "statMod" | "special";

export function statusCategory(def: StatusEffectDefinition): StatusCategory {
  if (def.tickCategory) return def.tickCategory;
  if (def.perTurnEffects.some((e) => e.kind === "damage" || e.kind === "heal" || e.kind === "restoreMp")) return "dot";
  if (def.perTurnEffects.some((e) => e.kind === "modifyCombatStat")) return "statMod";
  return "special";
}

const SURVIVAL_STAT_LABEL: Record<keyof SurvivalStats, string> = {
  fear: t("resolver.statLabelFear"),
};

export type Actor = Character | Monster | Summon;

export function isCharacter(actor: Actor): actor is Character {
  return "classId" in actor;
}

export function isSummon(actor: Actor): actor is Summon {
  return "ownerId" in actor;
}

export function isMonster(actor: Actor): actor is Monster {
  return "archetypeId" in actor && !isSummon(actor);
}

/** Use for side checks; `isCharacter` is only for what real characters alone have (MP, fear, abilities, skill ranks). */
export function isPlayerSide(actor: Actor): boolean {
  return isCharacter(actor) || isSummon(actor);
}

export function isActorAlive(actor: Actor): boolean {
  return isCharacter(actor) ? actor.isAlive && actor.hp > 0 : actor.hp > 0;
}

export type FearTier = 1 | 2 | 3 | 4;

export function getFearTier(fear: number): FearTier {
  const [tier2, tier3, tier4] = BALANCE.combat.fearTierThresholds;
  if (fear >= tier4) return 4;
  if (fear >= tier3) return 3;
  if (fear >= tier2) return 2;
  return 1;
}

export function getFearAccuracyPenalty(tier: FearTier): number {
  return BALANCE.combat.fearAccuracyPenaltyByTier[tier - 1]!;
}

export function getFearDamagePenalty(tier: FearTier): number {
  return BALANCE.combat.fearDamagePenaltyByTier[tier - 1]!;
}

export function rollLosesControl(fear: number, roll: () => number): boolean {
  return getFearTier(fear) === 4 && roll() < BALANCE.combat.fearLoseControlChance;
}

/** Paladin's passive — fear still builds on the bearer, but none of its combat penalties apply. */
export function ignoresFearEffects(actor: Actor): boolean {
  return isCharacter(actor) && passiveRankDef(getClass(actor.classId).passiveSkill, actor.level) !== null && getClass(actor.classId).passiveSkill.ignoresFearEffects === true;
}

/** The fear tier whose combat penalties apply to `actor`: its own, or the calmest one if it ignores fear. */
export function combatFearTier(actor: Character): FearTier {
  return ignoresFearEffects(actor) ? 1 : getFearTier(actor.survival.fear);
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
  const fearPenalty = isCharacter(source) ? getFearAccuracyPenalty(combatFearTier(source)) : 0;
  const penalty = Math.min(1, fearPenalty + statusAccuracyPenaltyPercent(source) / 100);
  return roll() >= penalty;
}

function damageMultiplierFor(source: Actor): number {
  if (!isCharacter(source)) return 1;
  return 1 - getFearDamagePenalty(combatFearTier(source));
}

function applyCombatStatDelta(actor: Actor, stat: CombatStat, amount: number): void {
  if (stat === "aggro") {
    // Monsters have no aggro or magicPower field, so the change is dropped for them.
    if (isCharacter(actor) || isSummon(actor)) actor.aggro += amount;
    return;
  }
  if (stat === "magicPower") {
    if (isCharacter(actor) || isSummon(actor)) actor.magicPower += amount;
    return;
  }
  if (stat === "maxHp") {
    // Gaining max HP raises HP by the same amount (a fallen actor stays at 0); losing it only clamps.
    actor.maxHp += amount;
    actor.hp = amount > 0 ? (actor.hp > 0 ? actor.hp + amount : 0) : Math.min(actor.hp, actor.maxHp);
    return;
  }
  actor[stat] += amount;
}

function getCombatStatValue(actor: Actor, stat: CombatStat): number {
  if (stat === "aggro") return isCharacter(actor) || isSummon(actor) ? actor.aggro : 0;
  if (stat === "magicPower") return isCharacter(actor) || isSummon(actor) ? actor.magicPower : 0;
  return actor[stat];
}

/** `amount`, unless `minPercent` of the stat (read before this delta lands) has the larger magnitude. */
function computeCombatStatDelta(actor: Actor, effect: SkillEffect): number {
  const amount = effect.amount ?? 0;
  if (!effect.minPercent || !effect.combatStat) return amount;
  const floor = Math.round((getCombatStatValue(actor, effect.combatStat) * effect.minPercent) / 100);
  return Math.abs(floor) > Math.abs(amount) ? floor : amount;
}

export interface ResolveContext {
  log: LogEntry[];
  statusEffectName?: string;
  skillName?: string;
  isMagic?: boolean;
  /** Required for a `modifyStat` on satiety, which is party-wide. */
  gameState?: GameState;
  /** The caller's own crit roll. Undefined with `rollDamage` set: the base crit chance is rolled here. */
  isCrit?: boolean;
  executeBonus?: { hpPercentThreshold: number; bonusDamagePercent?: number; bonusDamageFlat?: number };
  bonusDamagePercent?: number;
  /** Replaces the source's live attack/magicPower as the stat `offenseMultiplierPercent` scales. */
  offensiveStatOverride?: number;
  /** The effect came from the source's own class skill; only these heals get the Acolyte passive boost. */
  castByOwnClassSkill?: boolean;
  /** For a `linksToCasterSummon` status: the summon whose departure expires it. */
  linkedSummonId?: Id;
  /** Called per over-time effect that actually moved the bearer's HP. */
  onDotEffect?: (kind: "damage" | "heal") => void;
  /** Uniform [0, 1) draw for a direct hit or heal (crit, then variance and its rounding). Absent for over-time ticks: no crit, no variance. */
  rollDamage?: () => number;
  /** A multi-hit follow-up after the target fell: rolled and logged as overkill, but nothing is dealt. */
  unapplied?: true;
  /** HP share (0-1) tested against `executeBonus` instead of current HP; an `unapplied` hit passes the share before the felling hit. */
  executeHpFraction?: number;
}

function offensiveStatFor(source: Actor, isMagic: boolean | undefined, effect: SkillEffect): number {
  if (effect.scalesWithAttackAndMagic && (isCharacter(source) || isSummon(source))) return source.attack + source.magicPower;
  if (isMagic && (isCharacter(source) || isSummon(source))) return source.magicPower;
  return source.attack;
}

/** Draws only when `rollDamage` is passed, so an over-time tick never crits. */
function critRolled(ctx: ResolveContext): boolean {
  if (ctx.isCrit !== undefined) return ctx.isCrit;
  const chance = BALANCE.combat.baseCritChancePercent / 100;
  return ctx.rollDamage !== undefined && chance > 0 && ctx.rollDamage() < chance;
}

function critMultiplierOf(effect: SkillEffect): number {
  return (effect.critMultiplierPercent ?? BALANCE.combat.defaultCritMultiplierPercent) / 100;
}

export function mitigatedOffense(off: number, def: number): number {
  return off - off * (def / (BALANCE.combat.defenseMitigationX + def)) - def / BALANCE.combat.defenseMitigationY;
}

function raceMultiplierFor(target: Actor, damageType: DamageType): number {
  if (!isMonster(target)) return 1;
  const profile = resolveRaceProfile(target.race, target.subRace, target.traitIds ?? []);
  const resist = profile.resistPercent[damageType];
  const statusWeak = target.activeStatusEffects.reduce((sum, s) => sum + (getStatusEffect(s.statusEffectId).weakPercent?.[damageType] ?? 0), 0);
  const weak = clamp(profile.weakPercent[damageType] + statusWeak, 0, 100);
  return (1 - resist / 100) * (1 + weak / 100);
}

export function resolveSkillEffect(effect: SkillEffect, source: Actor, target: Actor, ctx: ResolveContext): number {
  if (effect.requiresTargetStatusId && !target.activeStatusEffects.some((s) => s.statusEffectId === effect.requiresTargetStatusId)) return 0;
  switch (effect.kind) {
    case "damage": {
      const isSelfTick = source === target;
      const effectiveDefense = target.defense * (1 - (effect.ignoreDefensePercent ?? 0) / 100);
      const isCrit = !isSelfTick && critRolled(ctx);
      const critMultiplier = isCrit ? critMultiplierOf(effect) : 1;
      const stacks = effect.scalesWithStatusStacks
        ? target.activeStatusEffects.find((s) => s.statusEffectId === effect.scalesWithStatusStacks!.statusEffectId)?.stacks ?? 0
        : 0;
      const stackOffenseBonusPercent = effect.scalesWithStatusStacks ? stacks * effect.scalesWithStatusStacks.percentPerStack : 0;
      const debuffOffenseBonusPercent = effect.scalesWithDebuffCount ? harmfulStatusCount(target) * effect.scalesWithDebuffCount.percentPerDebuff : 0;
      const offenseMultiplier = ((effect.offenseMultiplierPercent ?? 100) + stackOffenseBonusPercent + debuffOffenseBonusPercent) / 100;
      const isExecuteTarget =
        !isSelfTick && ctx.executeBonus !== undefined && (ctx.executeHpFraction ?? target.hp / target.maxHp) < ctx.executeBonus.hpPercentThreshold / 100;
      const executeMultiplier = isExecuteTarget && ctx.executeBonus?.bonusDamagePercent ? 1 + ctx.executeBonus.bonusDamagePercent / 100 : 1;
      const executeFlat = isExecuteTarget ? ctx.executeBonus?.bonusDamageFlat ?? 0 : 0;
      const bonusMultiplier = !isSelfTick && ctx.bonusDamagePercent ? 1 + ctx.bonusDamagePercent / 100 : 1;
      const raceMultiplier = raceMultiplierFor(target, effect.damageType ?? "physical");
      const variancePercent = !isSelfTick && ctx.rollDamage ? BALANCE.combat.damageVariancePercent : 0;
      const varianceMultiplier = variancePercent > 0 ? 1 + ((ctx.rollDamage!() * 2 - 1) * variancePercent) / 100 : 1;
      // A varied hit rounds up with the odds of its fraction, so a small hit still moves and the average stays exact.
      const roundDamage = (value: number) => (variancePercent > 0 ? Math.floor(value + ctx.rollDamage!()) : Math.round(value));
      const rawDamage = isSelfTick
        ? Math.round((effect.amount ?? 0) * raceMultiplier)
        : roundDamage(
            ((effect.amount ?? 0) +
              executeFlat +
              mitigatedOffense((ctx.offensiveStatOverride ?? offensiveStatFor(source, ctx.isMagic, effect)) * offenseMultiplier, effectiveDefense)) *
              damageMultiplierFor(source) *
              critMultiplier *
              executeMultiplier *
              bonusMultiplier *
              raceMultiplier *
              varianceMultiplier
          );
      const isStatusTick = isSelfTick && ctx.statusEffectName !== undefined;
      const finalDamage = shellAdjustedDamage(target, raceMultiplier === 0 ? 0 : Math.max(1, rawDamage), isStatusTick);
      const critMark = isCrit ? { crit: true as const } : {};
      if (ctx.unapplied && !isSelfTick) {
        const overkillKey = ctx.skillName ? (isCrit ? "resolver.overkillWithSkillCrit" : "resolver.overkillWithSkill") : isCrit ? "resolver.overkillCrit" : "resolver.overkill";
        const text = t(overkillKey, { target: nameOf(target), amount: finalDamage, source: nameOf(source), skill: ctx.skillName ?? "" });
        ctx.log.push({ text, kind: "attack", hit: { targetId: target.id, amount: finalDamage, overkill: finalDamage, ...critMark } });
        return 0;
      }
      const hpBefore = target.hp;
      target.hp = Math.max(0, target.hp - finalDamage);
      if (!isSelfTick) noteShellHit(target, ctx);
      const sourceLabel = isSelfTick && ctx.statusEffectName ? ctx.statusEffectName : nameOf(source);
      const damageText =
        !isSelfTick && ctx.skillName
          ? t(isCrit ? "resolver.damageWithSkillCrit" : "resolver.damageWithSkill", { target: nameOf(target), amount: finalDamage, source: sourceLabel, skill: ctx.skillName })
          : t(isCrit ? "resolver.damageCrit" : "resolver.damage", { target: nameOf(target), amount: finalDamage, source: sourceLabel });
      const hpLost = hpBefore - target.hp;
      if (!isSelfTick) noteDamageTaken(target, source.id, hpLost);
      const overkill = finalDamage - hpLost;
      const hit = !isSelfTick && hpLost > 0 ? { hit: { targetId: target.id, amount: finalDamage, ...(overkill > 0 ? { overkill } : {}), ...critMark } } : {};
      ctx.log.push({ text: damageText, kind: "attack", ...hit });
      if (target.hp <= 0) reviveIfGuarded(target, ctx);
      if (target.hp <= 0 && isCharacter(target)) target.isAlive = false;
      if (target.hp <= 0) ctx.log.push({ text: t("resolver.defeated", { target: nameOf(target) }), kind: "death" });
      else if (!isSelfTick && hpLost > 0) healOnHit(target, hpLost, ctx);
      if (!isSelfTick && finalDamage > 0) reflectDamage(target, source, finalDamage, ctx);
      if (!isSelfTick && effect.lifestealPercent && isActorAlive(source)) {
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
      const healPower =
        ctx.isMagic && (isCharacter(source) || isSummon(source)) ? source.magicPower * ((effect.offenseMultiplierPercent ?? 100) / 100) : 0;
      const passiveHealBoost = ctx.castByOwnClassSkill && isCharacter(source) ? 1 + (ownPassiveRank(source)?.healBoostPercent ?? 0) / 100 : 1;
      const baseHeal =
        Math.max(effect.amount ?? 0, (target.maxHp * (effect.maxHpPercent ?? 0)) / 100) +
        (source.maxHp * (effect.casterMaxHpPercent ?? 0)) / 100;
      const lowHpBoost = effect.lowHpHealBonus ? 1 + lowHpHealBonusPercent(target, effect.lowHpHealBonus) / 100 : 1;
      const crit = critRolled(ctx);
      const critMultiplier = crit ? critMultiplierOf(effect) : 1;
      target.hp = Math.min(target.maxHp, target.hp + Math.round((baseHeal + healPower) * passiveHealBoost * lowHpBoost * critMultiplier));
      const healed = target.hp - before;
      ctx.log.push({ text: t(crit ? "resolver.healCrit" : "resolver.heal", { target: nameOf(target), amount: healed }), kind: "heal", ...(crit ? { healCritOf: target.id } : {}) });
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
      // amount/minPercent on this effect override the status's own modifyCombatStat magnitude, so
      // one status id can carry a different magnitude per rank.
      const magnitudeOverride =
        effect.amount !== undefined || effect.minPercent !== undefined ? { amount: effect.amount, minPercent: effect.minPercent } : undefined;
      const linkedSummonId = effect.linksToCasterSummon ? ctx.linkedSummonId : undefined;
      const casterMagicPower = ctx.isMagic && (isCharacter(source) || isSummon(source)) ? source.magicPower : undefined;
      const landedOf = isPlayerSide(source) !== isPlayerSide(target) ? (isSummon(target) ? target.ownerId : target.id) : undefined;
      applyStatusEffectToActor(target, effect.statusEffectId, effect.durationTurns, ctx, magnitudeOverride, linkedSummonId, casterMagicPower, effect.onHitDurationTurns, landedOf, source.id);
      for (const id of effect.alsoApplyStatusEffectIds ?? [])
        applyStatusEffectToActor(target, id, effect.durationTurns, ctx, magnitudeOverride, linkedSummonId, casterMagicPower, effect.onHitDurationTurns, landedOf, source.id);
      return 0;
    }
    case "removeStatusEffect": {
      if (effect.removesHarmfulDots) {
        for (const active of [...target.activeStatusEffects]) {
          const def = getStatusEffect(active.statusEffectId);
          if (def.perTurnEffects.some((e) => e.kind === "damage")) expireStatusEffect(target, active, ctx);
        }
      } else if (effect.stacks !== undefined && effect.statusEffectId) removeStatusStacks(target, effect.statusEffectId, effect.stacks, ctx);
      else removeStatusEffectFromActor(target, effect.statusEffectId, ctx);
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
      const amount = effect.amount ?? 0;
      const delta = adjustFear(target, amount > 0 ? resistedFearGain(target, amount) : amount);
      if (delta !== 0) {
        const verb = delta < 0 ? t("resolver.verbDecrease") : t("resolver.verbIncrease");
        ctx.log.push({
          text: t("resolver.statChange", { target: nameOf(target), verb, amount: formatFear(Math.abs(delta)), stat: SURVIVAL_STAT_LABEL[effect.stat] }),
          kind: delta < 0 ? "buff" : "debuff",
        });
      }
      return 0;
    }
    case "modifyCombatStat": {
      if (!effect.combatStat) return 0;
      const delta = computeCombatStatDelta(target, effect);
      applyCombatStatDelta(target, effect.combatStat, delta);
      if (delta !== 0) {
        const verb = delta < 0 ? t("resolver.verbDecrease") : t("resolver.verbIncrease");
        ctx.log.push({
          text: t("resolver.statChange", { target: nameOf(target), verb, amount: Math.abs(delta), stat: COMBAT_STAT_LABEL[effect.combatStat] }),
          kind: delta < 0 ? "debuff" : "buff",
        });
      }
      return 0;
    }
    case "summon":
    case "summonMonster":
    case "commandSummons":
    case "throwDice": {
      // Intercepted by `applySkillEffects` (combat.ts), which has the CombatState to register or run it.
      return 0;
    }
  }
}

/** Statuses that turn part of a direct hit back on whoever landed it. Applied straight to HP, never through resolveSkillEffect, so a reflect can never be reflected again. */
function reflectDamage(bearer: Actor, attacker: Actor, damage: number, ctx: ResolveContext): void {
  const percent = bearer.activeStatusEffects.reduce((sum, s) => sum + (getStatusEffect(s.statusEffectId).reflectDamagePercent ?? 0), 0) + passiveReflectPercent(bearer);
  const amount = Math.round((damage * percent) / 100);
  if (amount <= 0 || attacker === bearer) return;
  const hpBefore = attacker.hp;
  attacker.hp = Math.max(0, attacker.hp - amount);
  noteDamageTaken(attacker, bearer.id, hpBefore - attacker.hp);
  ctx.log.push({ text: t("combat.statusReflectDamage", { attacker: nameOf(attacker), amount, bearer: nameOf(bearer) }), kind: "attack" });
  if (attacker.hp <= 0) reviveIfGuarded(attacker, ctx);
  if (attacker.hp <= 0 && isCharacter(attacker)) attacker.isAlive = false;
  if (attacker.hp <= 0) ctx.log.push({ text: t("resolver.defeated", { target: nameOf(attacker) }), kind: "death" });
}

/** A `reviveHpPercent` status on a fallen actor spends itself to put the actor back up at that share of its max HP. */
function reviveIfGuarded(actor: Actor, ctx: ResolveContext): void {
  if (isMonster(actor) && advanceBar(actor)) return;
  const guard = actor.activeStatusEffects.find((s) => getStatusEffect(s.statusEffectId).reviveHpPercent);
  if (!guard) return;
  const def = getStatusEffect(guard.statusEffectId);
  actor.hp = Math.max(1, Math.round((actor.maxHp * def.reviveHpPercent!) / 100));
  actor.activeStatusEffects = actor.activeStatusEffects.filter((s) => s !== guard);
  ctx.log.push({ text: t("resolver.revived", { target: nameOf(actor), status: statusDisplayName(def), hp: actor.hp }), kind: "heal" });
}

/** A `healOnHitPercent` status heals the bearer for a share of the HP a hit it survived just took. */
function healOnHit(actor: Actor, hpLost: number, ctx: ResolveContext): void {
  const percent = actor.activeStatusEffects.reduce((sum, s) => sum + (getStatusEffect(s.statusEffectId).healOnHitPercent ?? 0), 0);
  if (percent <= 0) return;
  const before = actor.hp;
  actor.hp = Math.min(actor.maxHp, actor.hp + Math.round((hpLost * percent) / 100));
  if (actor.hp > before) ctx.log.push({ text: t("resolver.heal", { target: nameOf(actor), amount: actor.hp - before }), kind: "heal" });
}

/** A reflect passive (the Paladin's) — a share of every direct hit taken goes back to the attacker, unlocked at level 5/20/35. */
function passiveReflectPercent(bearer: Actor): number {
  if (!isCharacter(bearer)) return 0;
  return ownPassiveRank(bearer)?.reflectPercent ?? 0;
}

/** Harmful statuses on `actor`, each counted once however many stacks it has. */
export function harmfulStatusCount(actor: Actor): number {
  return actor.activeStatusEffects.filter((s) => !isHelpfulStatusEffect(getStatusEffect(s.statusEffectId))).length;
}

/** `lowHpHealBonus`'s share for this recipient: 0 at full HP, rising evenly to `maxBonusPercent` at `fullBonusBelowHpPercent` of max HP and below. */
export function lowHpHealBonusPercent(target: Actor, bonus: { maxBonusPercent: number; fullBonusBelowHpPercent: number }): number {
  const hpPercent = (target.hp / target.maxHp) * 100;
  const span = 100 - bonus.fullBonusBelowHpPercent;
  const progress = span <= 0 ? 1 : clamp((100 - hpPercent) / span, 0, 1);
  return bonus.maxBonusPercent * progress;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nameOf(actor: Actor): string {
  return actor.name;
}

interface StatusMagnitudeOverride {
  amount?: number;
  minPercent?: number;
}

function modifyCombatStatEffects(def: StatusEffectDefinition, override: StatusMagnitudeOverride | undefined): SkillEffect[] {
  return def.perTurnEffects
    .filter((e) => e.kind === "modifyCombatStat" && e.combatStat)
    .map((e) => (override ? { ...e, amount: override.amount ?? e.amount, minPercent: override.minPercent ?? e.minPercent } : e));
}

/** Only a status that does nothing but damage the race fully resists; one with any role still lands. */
function isImmuneToStatus(actor: Actor, def: StatusEffectDefinition): boolean {
  return (
    statusRole(def) === null &&
    def.perTurnEffects.length > 0 &&
    def.perTurnEffects.every((e) => e.kind === "damage" && raceMultiplierFor(actor, e.damageType ?? "physical") === 0)
  );
}

function statusLandedTag(def: StatusEffectDefinition, landedOf: Id | undefined): Pick<LogEntry, "statusLandedOf" | "statusLanded"> {
  if (landedOf === undefined) return {};
  if (statusRole(def) === "debuff") return { statusLandedOf: landedOf, statusLanded: "debuff" };
  if (def.perTurnEffects.some((e) => e.kind === "damage")) return { statusLandedOf: landedOf, statusLanded: "dot" };
  return {};
}

/**
 * Whether an applied status remembers who applied it: a taunt needs it to force the target, an
 * intercept or a landed-hit or channel status to reach its source, a damage-over-time tick to credit the damage.
 */
function statusKeepsSource(def: StatusEffectDefinition): boolean {
  return (
    def.forcesTargetOnSource === true ||
    def.interceptsForSource === true ||
    def.onLandedHitSourceStatus !== undefined ||
    def.endsWithChannel === true ||
    def.perTurnEffects.some((e) => e.kind === "damage")
  );
}

/** Credits `attackerId` with HP it took off a monster, for the `damage` targeting factor. Nothing is kept for any other bearer, or for a monster's own damage to itself. */
export function noteDamageTaken(target: Actor, attackerId: Id | undefined, hpLost: number): void {
  if (!isMonster(target) || attackerId === undefined || attackerId === target.id || hpLost <= 0) return;
  target.damageTakenFrom = { ...target.damageTakenFrom, [attackerId]: (target.damageTakenFrom?.[attackerId] ?? 0) + hpLost };
}

export function applyStatusEffectToActor(
  actor: Actor,
  statusEffectId: string,
  durationTurns: number | undefined,
  ctx: ResolveContext,
  magnitudeOverride?: StatusMagnitudeOverride,
  linkedSummonId?: Id,
  casterMagicPower?: number,
  onHitDurationTurns?: number,
  landedOf?: Id,
  sourceId?: Id
): void {
  const def = getStatusEffect(statusEffectId);
  if (def.eliteBossMaxTurns !== undefined && durationTurns !== undefined && isMonster(actor) && actor.tier !== "normal") {
    durationTurns = Math.min(durationTurns, def.eliteBossMaxTurns);
  }
  if (isImmuneToStatus(actor, def)) {
    ctx.log.push({
      text: t("resolver.statusImmune", { actor: nameOf(actor), effect: statusDisplayName(def) }),
      kind: "info",
      ...(landedOf !== undefined ? { statusImmuneOf: landedOf } : {}),
    });
    return;
  }
  const sourceMagicPower = def.perTurnEffects.some((e) => e.kind === "heal" && e.offenseMultiplierPercent !== undefined) ? casterMagicPower : undefined;
  const statEffects = modifyCombatStatEffects(def, magnitudeOverride);
  const existingIndex = actor.activeStatusEffects.findIndex((s) => s.statusEffectId === statusEffectId);
  if (existingIndex !== -1) {
    // Replaced, not mutated: the new identity drops a refreshed special status out of
    // specialStatusSnapshot, so it doesn't tick on the turn that refreshed it.
    const existing = actor.activeStatusEffects[existingIndex]!;
    const stackedBefore = existing.stacks ?? 1;
    const stackedAfter = def.stackable ? Math.min(def.maxStacks ?? 1, stackedBefore + 1) : existing.stacks;
    const gainedANewStack = def.stackable && stackedAfter !== undefined && stackedAfter > stackedBefore;
    const appliedAmounts = { ...existing.appliedAmounts };
    if (gainedANewStack) {
      // Accumulated, not overwritten, so expireStatusEffect undoes the running total.
      for (const e of statEffects) {
        const delta = computeCombatStatDelta(actor, e);
        applyCombatStatDelta(actor, e.combatStat!, delta);
        appliedAmounts[e.combatStat!] = (appliedAmounts[e.combatStat!] ?? 0) + delta;
      }
    }
    actor.activeStatusEffects[existingIndex] = {
      statusEffectId,
      turnsRemaining: durationTurns ?? existing.turnsRemaining,
      stacks: stackedAfter,
      appliedAmounts,
      linkedSummonId: linkedSummonId ?? existing.linkedSummonId,
      sourceMagicPower: sourceMagicPower ?? existing.sourceMagicPower,
      onHitDurationTurns: onHitDurationTurns ?? existing.onHitDurationTurns,
      ...(statusKeepsSource(def) ? { sourceId: sourceId ?? existing.sourceId } : {}),
    };
    ctx.log.push({
      text: gainedANewStack
        ? t("resolver.statusStack", { actor: nameOf(actor), effect: statusDisplayName(def), stacks: stackedAfter })
        : t("resolver.statusRefresh", { actor: nameOf(actor), effect: statusDisplayName(def) }),
      kind: isHelpfulStatusEffect(def) ? "buff" : "debuff",
      ...statusLandedTag(def, landedOf),
    });
    if (def.onMaxStacks && gainedANewStack && stackedAfter === def.maxStacks) {
      expireStatusEffect(actor, actor.activeStatusEffects[existingIndex]!, ctx);
      applyStatusEffectToActor(actor, def.onMaxStacks.statusEffectId, def.onMaxStacks.durationTurns, ctx, undefined, undefined, undefined, undefined, landedOf, sourceId);
    }
    return;
  }
  // All deltas computed before any lands, so one entry's delta never shifts another's minPercent floor.
  const appliedAmounts: Partial<Record<CombatStat, number>> = {};
  for (const e of statEffects) appliedAmounts[e.combatStat!] = computeCombatStatDelta(actor, e);
  const entry: ActiveStatusEffect = {
    statusEffectId,
    turnsRemaining: durationTurns ?? 1,
    stacks: def.stackable ? 1 : undefined,
    appliedAmounts,
    linkedSummonId,
    sourceMagicPower,
    onHitDurationTurns,
    ...(statusKeepsSource(def) && sourceId !== undefined ? { sourceId } : {}),
  };
  actor.activeStatusEffects.push(entry);
  for (const e of statEffects) applyCombatStatDelta(actor, e.combatStat!, appliedAmounts[e.combatStat!]!);
  ctx.log.push({
    text: t("resolver.statusApply", { actor: nameOf(actor), effect: statusDisplayName(def) }),
    kind: isHelpfulStatusEffect(def) ? "buff" : "debuff",
    ...statusLandedTag(def, landedOf),
  });
}

function removeStatusEffectFromActor(actor: Actor, statusEffectId: string | undefined, ctx: ResolveContext): void {
  // No id means cleanse: the first harmful status, never whatever buff sits at index 0.
  const target = statusEffectId
    ? actor.activeStatusEffects.find((s) => s.statusEffectId === statusEffectId)
    : actor.activeStatusEffects.find((s) => !isHelpfulStatusEffect(getStatusEffect(s.statusEffectId)));
  if (!target) return;
  expireStatusEffect(actor, target, ctx);
}

/**
 * Takes `count` stacks of a stackable status off `actor`, undoing the matching share of the stat
 * deltas those stacks applied; taking off every stack expires the status.
 */
export function removeStatusStacks(actor: Actor, statusEffectId: Id, count: number, ctx: ResolveContext): void {
  const active = actor.activeStatusEffects.find((s) => s.statusEffectId === statusEffectId);
  if (!active || count <= 0) return;
  const stacks = active.stacks ?? 1;
  if (count >= stacks) {
    expireStatusEffect(actor, active, ctx);
    return;
  }
  const appliedAmounts = { ...active.appliedAmounts };
  for (const stat of Object.keys(appliedAmounts) as CombatStat[]) {
    const removed = Math.round((appliedAmounts[stat]! * count) / stacks);
    applyCombatStatDelta(actor, stat, -removed);
    appliedAmounts[stat] = appliedAmounts[stat]! - removed;
  }
  const index = actor.activeStatusEffects.indexOf(active);
  actor.activeStatusEffects[index] = { ...active, stacks: stacks - count, appliedAmounts };
  ctx.log.push({ text: t("resolver.statusStacksRemoved", { actor: nameOf(actor), effect: statusDisplayName(getStatusEffect(statusEffectId)), stacks: stacks - count }), kind: "info" });
}

export function expireStatusEffect(actor: Actor, active: ActiveStatusEffect, ctx: ResolveContext): void {
  const def = getStatusEffect(active.statusEffectId);
  for (const e of def.perTurnEffects) {
    if (e.kind === "modifyCombatStat" && e.combatStat) {
      // Undo the stored delta, not a recompute: the stat may have moved since it was applied.
      applyCombatStatDelta(actor, e.combatStat, -(active.appliedAmounts?.[e.combatStat] ?? e.amount ?? 0));
    }
  }
  actor.activeStatusEffects = actor.activeStatusEffects.filter((s) => s !== active);
  ctx.log.push({
    text: t("resolver.statusExpire", { actor: nameOf(actor), effect: statusDisplayName(def) }),
    kind: "info",
    ...(statusRole(def) === "buff" ? { buffLostOf: isSummon(actor) ? actor.ownerId : actor.id, ...(isSummon(actor) ? { buffLostOfSummon: true as const } : {}) } : {}),
  });
}

function vulnerabilityMultiplier(actor: Actor, statusEffectId: string): number {
  let multiplier = 1;
  for (const active of actor.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (def.vulnerableTo && statusSatisfiesRequirement(statusEffectId, def.vulnerableTo.statusEffectId)) multiplier *= def.vulnerableTo.multiplier;
  }
  return multiplier;
}

/** Tracked by object identity: a refresh replaces the entry, so it falls out like a first cast would. */
export function specialStatusSnapshot(actor: Actor): ReadonlySet<ActiveStatusEffect> {
  return new Set(actor.activeStatusEffects.filter((s) => statusCategory(getStatusEffect(s.statusEffectId)) === "special"));
}

function decrementAndMaybeExpire(actor: Actor, active: ActiveStatusEffect, ctx: ResolveContext): void {
  active.turnsRemaining -= 1;
  if (active.turnsRemaining <= 0) {
    expireStatusEffect(actor, active, ctx);
  }
}

function tickCategoryUnconditionally(actor: Actor, category: "dot" | "statMod", ctx: ResolveContext): void {
  for (const active of [...actor.activeStatusEffects]) {
    const def = getStatusEffect(active.statusEffectId);
    if (statusCategory(def) !== category) continue;
    if (category === "dot") {
      for (const e of def.perTurnEffects) {
        if (e.kind !== "damage" && e.kind !== "heal" && e.kind !== "restoreMp") continue;
        let amount = e.amount ?? 0;
        if (e.kind === "damage") {
          if (e.maxHpPercent) amount += (actor.maxHp * e.maxHpPercent) / 100;
          if (def.stackable) amount *= 1 + ((active.stacks ?? 1) - 1) * ((def.perStackBonusPercent ?? 0) / 100);
          if (isMonster(actor) && (actor.tier === "elite" || actor.tier === "boss")) amount *= BALANCE.combat.eliteBossDotMultiplier;
          amount *= vulnerabilityMultiplier(actor, active.statusEffectId);
        }
        // A heal keeps its maxHpPercent: the heal branch of resolveSkillEffect already takes the larger of the two.
        // Its offenseMultiplierPercent scales the caster's magicPower snapshotted on apply, not the bearer's.
        if (e.kind === "heal") amount += ((active.sourceMagicPower ?? 0) * (e.offenseMultiplierPercent ?? 0)) / 100;
        const effectToApply = e.kind === "heal" ? { ...e, amount, offenseMultiplierPercent: undefined } : { ...e, amount, maxHpPercent: undefined };
        const hpBefore = actor.hp;
        resolveSkillEffect(effectToApply, actor, actor, { log: ctx.log, statusEffectName: statusDisplayName(def) });
        if (actor.hp < hpBefore) noteDamageTaken(actor, active.sourceId, hpBefore - actor.hp);
        if (actor.hp < hpBefore) ctx.onDotEffect?.("damage");
        else if (actor.hp > hpBefore) ctx.onDotEffect?.("heal");
      }
      if (!isActorAlive(actor)) continue;
    }
    decrementAndMaybeExpire(actor, active, ctx);
  }
}

/** Runs at round start, so a DoT/HoT applied this round first ticks next round. */
export function tickDotEffects(actor: Actor, ctx: ResolveContext): void {
  tickCategoryUnconditionally(actor, "dot", ctx);
}

/** Runs at round end for every combatant, so a fresh stat modifier ticks in the round it was cast. */
export function tickStatModEffects(actor: Actor, ctx: ResolveContext): void {
  tickCategoryUnconditionally(actor, "statMod", ctx);
}

/**
 * Runs right after the actor's own turn, only for statuses in `eligible` (snapshotted before that
 * turn), so a status never ticks on the turn that applied or refreshed it. A self-cast status starts
 * next round; one inflicted on a slower target ticks after that target's turn this round.
 */
export function tickSpecialEffects(actor: Actor, eligible: ReadonlySet<ActiveStatusEffect>, ctx: ResolveContext): void {
  for (const active of [...actor.activeStatusEffects]) {
    const def = getStatusEffect(active.statusEffectId);
    if (statusCategory(def) !== "special") continue;
    if (!eligible.has(active)) continue;
    decrementAndMaybeExpire(actor, active, ctx);
  }
}
