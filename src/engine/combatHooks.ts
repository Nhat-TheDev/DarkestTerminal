import type { Character, LogEntry } from "../types";
import { type Actor, isCharacter, resolveSkillEffect } from "./resolver";
import { rollPoisonOnHit, totalReflectDamagePercent, totalLifestealPercent, totalHealOnKill } from "./artifacts";
import { getStatusEffect, statusSatisfiesRequirement } from "../data/statusEffects";
import { t } from "../data/strings";
import type { EngineContext } from "./combat";
import { characterBaseStats } from "./party";
import { getClass, passiveRankDef } from "../data/classes";

export interface SkillEffectHooks {
  /** Fires once per damage effect that resolves against a target. */
  onHit?(source: Actor, target: Actor, log: LogEntry[]): void;
  /** Fires after a "damage" effect resolves with appliedAmount > 0. */
  onDamageDealt?(source: Actor, target: Actor, damage: number, ctx: EngineContext, log: LogEntry[]): void;
  /** Fires when a damage effect's target was alive before and dead after. */
  onKill?(source: Actor, target: Actor, log: LogEntry[]): void;
}

export function applyOnHitRider(source: Character, target: Actor, log: LogEntry[]): void {
  for (const active of source.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (def.onHitStatusEffectId) {
      resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: def.onHitStatusEffectId }, source, target, { log });
    }
  }
}

export function applyArtifactReflectDamage(bearer: Character, attacker: Actor, damageDealt: number, log: LogEntry[]): void {
  const percent = totalReflectDamagePercent(bearer);
  const reflected = Math.round(damageDealt * (percent / 100));
  if (reflected <= 0) return;
  attacker.hp = Math.max(0, attacker.hp - reflected);
  log.push({ text: t("combat.reflectDamage", { attacker: attacker.name, amount: reflected, bearer: bearer.name }), kind: "attack" });
}

export function applyArtifactLifesteal(bearer: Character, damageDealt: number, log: LogEntry[]): void {
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
    if (isCharacter(source) && rollPoisonOnHit(source, ctx.rng)) {
      resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poisoned" }, source, target, { log });
    }
  },
};

const healOnKillHook: SkillEffectHooks = {
  onKill(source, _target, log) {
    if (isCharacter(source)) applyArtifactHealOnKill(source, log);
  },
};

/** Rogue's passive (§11 of the design spec) — bonus damage (type + required target status both
 *  driven by `passiveSkill.bonusDamageType`/`requiresTargetStatusId` in `data/classes.json`, not
 *  hardcoded here) on a hit that lands against a target already carrying that status — or a
 *  `rankOf` variant of it (`statusSatisfiesRequirement`, the same family-match Viking's own
 *  `conditionalBonus` skills use for "storm-empowered", e.g. Frenzied Slash — see
 *  `data/status-effects.json`'s "poisoned-ii"/"-iii" `rankOf: "poisoned"`). The flat term is fixed,
 *  not attack-scaled (confirmed). */
const roguePoisonBonusHook: SkillEffectHooks = {
  onDamageDealt(source, target, damage, _ctx, log) {
    if (!isCharacter(source) || source.classId !== "rogue") return;
    const passive = getClass("rogue").passiveSkill;
    if (!passive.requiresTargetStatusId) return;
    const targetHasRequiredStatus = target.activeStatusEffects.some((s) => statusSatisfiesRequirement(s.statusEffectId, passive.requiresTargetStatusId!));
    if (!targetHasRequiredStatus) return;
    const rankDef = passiveRankDef(passive, source.level);
    const percent = rankDef?.bonusPercent ?? 0;
    const flat = rankDef?.bonusFlat ?? 0;
    if (percent === 0 && flat === 0) return;
    const bonusAmount = Math.round(damage * (percent / 100)) + flat;
    // ignoreDefensePercent: 100 + offenseMultiplierPercent: 0 together zero out
    // mitigatedOffense(...) entirely (see resolver.ts), leaving finalDamage as exactly
    // bonusAmount (times race resist/weak and the source's fear-tier penalty, nothing else) — a
    // true flat bonus, not bonusAmount re-added to a full attack-vs-defense roll.
    resolveSkillEffect(
      { kind: "damage", amount: bonusAmount, damageType: passive.bonusDamageType, ignoreDefensePercent: 100, offenseMultiplierPercent: 0 },
      source,
      target,
      { log }
    );
  },
};

/** Mage's passive (§11 of the design spec) — every hit the Mage lands stacks a defense-shredding
 *  status on the target (up to 3 stacks), magnitude scaling with the passive's unlocked rank. Each
 *  rank names its own status id ("mage-shred"/"-ii"/"-iii", see `data/classes.json`) rather than 1
 *  status id whose magnitude gets overridden at runtime — the same rank-to-status mapping Poison
 *  Bomb (Rogue) uses for "poisoned"/"-ii"/"-iii". */
const mageShredHook: SkillEffectHooks = {
  onDamageDealt(source, target, _damage, _ctx, log) {
    if (!isCharacter(source) || source.classId !== "mage") return;
    const rankDef = passiveRankDef(getClass("mage").passiveSkill, source.level);
    if (!rankDef?.onHitStatusEffectId) return;
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: rankDef.onHitStatusEffectId }, source, target, { log });
  },
};

/** Plague Doctor's passive (§11 of the design spec) — every hit rolls twice (independently) for a
 *  random debuff from `debuffPool`, unlocked at level 5/20/35. */
const plagueDoctorDebuffProcHook: SkillEffectHooks = {
  onDamageDealt(source, target, _damage, ctx, log) {
    if (!isCharacter(source) || source.classId !== "plague-doctor") return;
    const passive = getClass("plague-doctor").passiveSkill;
    const chance = (passiveRankDef(passive, source.level)?.procChancePercent ?? 0) / 100;
    if (chance === 0) return;
    for (let roll = 0; roll < 2; roll++) {
      if (!ctx.rng.chance(chance)) continue;
      const statusId = ctx.rng.pick(passive.debuffPool ?? []);
      resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: statusId, durationTurns: 2 }, source, target, { log });
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
  roguePoisonBonusHook,
  mageShredHook,
  plagueDoctorDebuffProcHook,
];
