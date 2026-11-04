import type { Character, LogEntry } from "../types";
import { type Actor, damageTakenMultiplier, isCharacter, isMonster, noteDamageTaken, resolveSkillEffect } from "./resolver";
import { rollPoisonOnHit, totalReflectDamagePercent, totalLifestealPercent, totalHealOnKill } from "./artifacts";
import { getStatusEffect, statusSatisfiesRequirement } from "../data/statusEffects";
import { t } from "../data/strings";
import type { EngineContext } from "./combat";
import { characterBaseStats } from "./party";
import { shellAdjustedDamage } from "./monsterShell";
import { advanceBar } from "./monsterBars";
import { getClass, passiveRankDef } from "../data/classes";

export interface SkillEffectHooks {
  /** Fires per damage effect that resolves against a target, even when it deals nothing. */
  onHit?(source: Actor, target: Actor, log: LogEntry[]): void;
  /** Fires only when the damage dealt is > 0. */
  onDamageDealt?(source: Actor, target: Actor, damage: number, ctx: EngineContext, log: LogEntry[]): void;
  onKill?(source: Actor, target: Actor, log: LogEntry[]): void;
}

export function applyOnHitRider(source: Character, target: Actor, log: LogEntry[]): void {
  for (const active of source.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (def.onHitStatusEffectId) {
      resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: def.onHitStatusEffectId, durationTurns: active.onHitDurationTurns }, source, target, { log });
    }
  }
}

export function applyArtifactReflectDamage(bearer: Character, attacker: Actor, damageDealt: number, log: LogEntry[]): void {
  const percent = totalReflectDamagePercent(bearer);
  // An intact shell caps what a reflect does to it, but a reflect is not a hit that wears it down.
  const reflected = shellAdjustedDamage(attacker, Math.round(damageDealt * (percent / 100) * damageTakenMultiplier(attacker)), false);
  if (reflected <= 0) return;
  const hpBefore = attacker.hp;
  attacker.hp = Math.max(0, attacker.hp - reflected);
  noteDamageTaken(attacker, bearer.id, hpBefore - attacker.hp);
  if (attacker.hp <= 0 && isMonster(attacker)) advanceBar(attacker);
  log.push({ text: t("combat.reflectDamage", { attacker: attacker.name, amount: reflected, bearer: bearer.name }), kind: "attack" });
}

export function applyArtifactLifesteal(bearer: Character, damageDealt: number, log: LogEntry[]): void {
  if (!bearer.isAlive) return;
  const healed = Math.round(damageDealt * (totalLifestealPercent(bearer) / 100));
  if (healed <= 0) return;
  const before = bearer.hp;
  bearer.hp = Math.min(bearer.maxHp, bearer.hp + healed);
  if (bearer.hp > before) log.push({ text: t("combat.lifesteal", { bearer: bearer.name, amount: bearer.hp - before }), kind: "heal" });
}

export function applyArtifactHealOnKill(bearer: Character, log: LogEntry[]): void {
  const amount = totalHealOnKill(bearer, characterBaseStats(bearer).maxHp);
  if (amount <= 0) return;
  const before = bearer.hp;
  bearer.hp = Math.min(bearer.maxHp, bearer.hp + amount);
  if (bearer.hp > before) log.push({ text: t("combat.healOnKill", { bearer: bearer.name, amount: bearer.hp - before }), kind: "heal" });
}

const onHitStatusRiderHook: SkillEffectHooks = {
  onHit(source, target, log) {
    if (isCharacter(source)) applyOnHitRider(source, target, log);
  },
};

const reflectDamageHook: SkillEffectHooks = {
  onDamageDealt(source, target, damage, _ctx, log) {
    if (isCharacter(target) && isCharacter(source) !== isCharacter(target)) {
      applyArtifactReflectDamage(target, source, damage, log);
    }
  },
};

const lifestealHook: SkillEffectHooks = {
  onDamageDealt(source, _target, damage, _ctx, log) {
    if (isCharacter(source)) applyArtifactLifesteal(source, damage, log);
  },
};

const poisonOnHitHook: SkillEffectHooks = {
  onDamageDealt(source, target, _damage, ctx, log) {
    const proc = isCharacter(source) ? rollPoisonOnHit(source, ctx.rng) : undefined;
    if (proc) resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: proc.statusEffectId, durationTurns: proc.durationTurns }, source, target, { log });
  },
};

const healOnKillHook: SkillEffectHooks = {
  onKill(source, _target, log) {
    if (isCharacter(source)) applyArtifactHealOnKill(source, log);
  },
};

// Class passives fire on the fields their class declares in data/classes.json, never on a class id.

const targetStatusBonusHook: SkillEffectHooks = {
  onDamageDealt(source, target, damage, ctx, log) {
    if (!isCharacter(source)) return;
    const passive = getClass(source.classId).passiveSkill;
    if (!passive.requiresTargetStatusId) return;
    const targetHasRequiredStatus = target.activeStatusEffects.some((s) => statusSatisfiesRequirement(s.statusEffectId, passive.requiresTargetStatusId!));
    if (!targetHasRequiredStatus) return;
    const rankDef = passiveRankDef(passive, source.level);
    const percent = rankDef?.bonusPercent ?? 0;
    const flat = rankDef?.bonusFlat ?? 0;
    if (percent === 0 && flat === 0) return;
    const bonusAmount = Math.round(damage * (percent / 100)) + flat;
    // These two fields zero out mitigatedOffense, so the bonus is bonusAmount scaled only by race,
    // fear, crit and variance, not a second attack-vs-defense roll.
    resolveSkillEffect(
      { kind: "damage", amount: bonusAmount, damageType: passive.bonusDamageType, ignoreDefensePercent: 100, offenseMultiplierPercent: 0 },
      source,
      target,
      { log, rollDamage: () => ctx.rng.next() }
    );
  },
};

const passiveOnHitStatusHook: SkillEffectHooks = {
  onDamageDealt(source, target, _damage, _ctx, log) {
    if (!isCharacter(source)) return;
    const rankDef = passiveRankDef(getClass(source.classId).passiveSkill, source.level);
    if (!rankDef?.onHitStatusEffectId) return;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: rankDef.onHitStatusEffectId, durationTurns: rankDef.durationTurns }, source, target, { log });
  },
};

const debuffProcHook: SkillEffectHooks = {
  onDamageDealt(source, target, _damage, ctx, log) {
    if (!isCharacter(source)) return;
    const passive = getClass(source.classId).passiveSkill;
    if (!passive.debuffPool?.length) return;
    const rankDef = passiveRankDef(passive, source.level);
    const chance = (rankDef?.procChancePercent ?? 0) / 100;
    if (chance === 0) return;
    for (let roll = 0; roll < (passive.procRolls ?? 1); roll++) {
      if (!ctx.rng.chance(chance)) continue;
      const statusId = ctx.rng.pick(passive.debuffPool);
      resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: statusId, durationTurns: rankDef?.durationTurns }, source, target, { log });
    }
  },
};

// Execution order matters.
export const combatHooks: SkillEffectHooks[] = [
  onHitStatusRiderHook,
  reflectDamageHook,
  lifestealHook,
  poisonOnHitHook,
  healOnKillHook,
  targetStatusBonusHook,
  passiveOnHitStatusHook,
  debuffProcHook,
];
