import type { CombatStat, StatusEffectDefinition } from "../types";
import statusEffectsJson from "../../data/status-effects.json";
import { t } from "./strings";

export const STATUS_EFFECTS = statusEffectsJson as unknown as StatusEffectDefinition[];

export function getStatusEffect(id: string): StatusEffectDefinition {
  const def = STATUS_EFFECTS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown status effect: ${id}`);
  return def;
}

const RANK_NUMERAL: Record<NonNullable<StatusEffectDefinition["rankLevel"]>, string> = { 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI" };

/** Composes the player-facing name for a status, appending a rank numeral (e.g. "Storm-Empowered II") for ranked variants instead of baking it into `name`. */
export function statusDisplayName(def: StatusEffectDefinition): string {
  return def.rankLevel ? `${def.name} ${RANK_NUMERAL[def.rankLevel]}` : def.name;
}

/** Whether `activeId` satisfies a `conditionalBonus.requiresStatusId` of `requiredId` — either the exact status, or one of its ranked variants (`rankOf === requiredId`). */
export function statusSatisfiesRequirement(activeId: string, requiredId: string): boolean {
  if (activeId === requiredId) return true;
  return getStatusEffect(activeId).rankOf === requiredId;
}

export const COMBAT_STAT_LABEL: Record<CombatStat, string> = {
  attack: t("resolver.statLabelAttack"),
  defense: t("resolver.statLabelDefense"),
  aggro: t("resolver.statLabelAggro"),
  speed: t("resolver.statLabelSpeed"),
  magicPower: t("resolver.statLabelMagicPower"),
};

// `items.ts` owns the exported `signed`, but importing it here would close a cycle
// (items -> statusEffects -> items), so this module keeps its own one-liner.
const signed = (amount: number): string => `${amount >= 0 ? "+" : ""}${amount}`;

/**
 * A magnitude other than the status's own JSON one. `amount`/`minPercent` are what a casting skill
 * effect puts on every stat effect (the resolver uses them instead of the status's own); `applied`
 * is the delta an active status already resolved per stat (`ActiveStatusEffect.appliedAmounts`).
 */
export interface StatusMagnitude {
  amount?: number;
  minPercent?: number;
  applied?: Partial<Record<CombatStat, number>>;
}

/**
 * What a status actually does, one fragment per mechanic, composed from its own mechanical fields —
 * shown alongside (not instead of) a status's hand-written `description`. A stat modifier is applied
 * once and held until the status expires, so its lines carry no "/turn". With `magnitude`, the stat
 * amount comes from the casting skill or from what the active status already applied.
 */
export function statusMechanicsParts(def: StatusEffectDefinition, magnitude?: StatusMagnitude): string[] {
  const parts: string[] = [];
  for (const e of def.perTurnEffects) {
    const flat = e.amount ?? 0;
    if (e.kind === "damage") {
      // The engine adds maxHpPercent of the bearer's max HP on top of the flat tick (resolver.ts, DoT ticks).
      parts.push(e.maxHpPercent ? t("item.effectPerTurnDamagePercent", { amount: flat, percent: e.maxHpPercent }) : t("item.effectPerTurnDamage", { amount: flat }));
    } else if (e.kind === "heal") {
      // A heal's maxHpPercent is a floor under the flat amount.
      if (e.offenseMultiplierPercent !== undefined) parts.push(t("item.effectPerTurnHealScaling", { amount: flat, percent: e.offenseMultiplierPercent }));
      else if (!e.maxHpPercent) parts.push(t("item.effectPerTurnHeal", { amount: flat }));
      else if (flat === 0) parts.push(t("item.effectPerTurnHealPercent", { percent: e.maxHpPercent }));
      else parts.push(t("item.effectPerTurnHealFloor", { amount: flat, percent: e.maxHpPercent }));
    } else if (e.kind === "modifyCombatStat" && e.combatStat) {
      const stat = COMBAT_STAT_LABEL[e.combatStat];
      const applied = magnitude?.applied?.[e.combatStat];
      const amount = applied ?? magnitude?.amount ?? flat;
      const floor = applied !== undefined ? 0 : magnitude?.minPercent ?? e.minPercent ?? 0;
      if (floor === 0) parts.push(t("item.effectStat", { amount: signed(amount), stat }));
      else if (amount === 0) parts.push(t("item.effectStatPercent", { percent: signed(floor), stat }));
      else parts.push(t("item.effectStatFloor", { amount: signed(amount), stat, percent: Math.abs(floor) }));
    }
  }
  if (def.onHitStatusEffectId) parts.push(t("item.effectOnHitRider", { status: getStatusEffect(def.onHitStatusEffectId).name }));
  if (def.onHitAoeDamage) {
    const aoe = def.onHitAoeDamage;
    const splash = t(aoe.isMagic ? "item.effectOnHitAoeMagic" : "item.effectOnHitAoeAttack", { amount: aoe.amount, percent: aoe.offenseMultiplierPercent ?? 100 });
    parts.push(aoe.ignoreDefensePercent ? `${splash}, ${t("item.effectOnHitAoeIgnoreDefense", { percent: aoe.ignoreDefensePercent })}` : splash);
  }
  if (def.accuracyPenaltyPercent) parts.push(t("item.effectAccuracyPenalty", { percent: def.accuracyPenaltyPercent }));
  if (def.vulnerableTo) {
    parts.push(t("item.effectVulnerable", { percent: Math.round((def.vulnerableTo.multiplier - 1) * 100), status: getStatusEffect(def.vulnerableTo.statusEffectId).name }));
  }
  if (def.stuns) parts.push(t("item.effectStuns"));
  if (def.untargetable) parts.push(t("item.effectUntargetable"));
  if (def.breakBonus?.basicAttackGuaranteedCrit) parts.push(t("item.effectBreakBonusCrit"));
  if (def.breakBonus?.skillDamageBonusPercent) parts.push(t("item.effectBreakBonusSkillPercent", { percent: def.breakBonus.skillDamageBonusPercent }));
  if (def.triggersOverwatch) {
    const chance = def.interruptChance;
    parts.push(chance === undefined ? t("item.effectOverwatch") : t("item.effectOverwatchChance", { percent: Math.round(chance * 100) }));
  }
  if (def.overwatchShot) parts.push(t("item.effectOverwatchShot", { amount: def.overwatchShot.amount, percent: def.overwatchShot.offenseMultiplierPercent }));
  if (def.stackable && (def.maxStacks ?? 1) > 1) parts.push(t("item.effectStacks", { max: def.maxStacks! }));
  if (def.stackable && def.perStackBonusPercent) parts.push(t("item.effectStackBonus", { percent: def.perStackBonusPercent }));
  return parts;
}

/**
 * `statusMechanicsParts` joined for display. `test/items.test.ts` fails when a status carries a field
 * the parts above neither show nor are known to ignore, so a new mechanical field cannot slip by
 * and leave a silent "no per-turn effect" on screen.
 */
export function formatStatusEffectMechanics(def: StatusEffectDefinition, magnitude?: StatusMagnitude): string {
  const parts = statusMechanicsParts(def, magnitude);
  return parts.length > 0 ? parts.join(", ") : t("item.effectNoPerTurn");
}
