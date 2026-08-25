import type { Character, LogEntry } from "../types";
import { type Actor, isCharacter, resolveSkillEffect } from "./resolver";
import { rollPoisonOnHit, totalReflectDamagePercent, totalLifestealPercent, totalHealOnKill } from "./artifacts";
import { getStatusEffect } from "../data/statusEffects";
import { t } from "../data/strings";
import type { EngineContext } from "./combat";

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
  const amount = totalHealOnKill(bearer);
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

// Order matters and is now declared, not implied by call-site position.
export const combatHooks: SkillEffectHooks[] = [onHitStatusRiderHook, reflectDamageHook, lifestealHook, poisonOnHitHook, healOnKillHook];
