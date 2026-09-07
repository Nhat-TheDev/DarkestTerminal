import type { CombatStat, StatusEffectDefinition } from "../types";
import statusEffectsJson from "../../data/status-effects.json";
import { t } from "./strings";

export const STATUS_EFFECTS = statusEffectsJson as unknown as StatusEffectDefinition[];

export function getStatusEffect(id: string): StatusEffectDefinition {
  const def = STATUS_EFFECTS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown status effect: ${id}`);
  return def;
}

const RANK_NUMERAL: Record<2 | 3, string> = { 2: "II", 3: "III" };

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
};

// `items.ts` owns the exported `signed`, but importing it here would close a cycle
// (items -> statusEffects -> items), so this module keeps its own one-liner.
const signed = (amount: number): string => `${amount >= 0 ? "+" : ""}${amount}`;

/**
 * What a status actually does, composed from its own mechanical fields. This is the only
 * description a status has — the hand-written `description` string that used to sit beside them
 * was deleted precisely because it drifted (`weakened` read "lowers the target's defense" while
 * the data said -6). Covers every mechanical field a status can carry, so no definition should
 * reach the `item.effectNoPerTurn` fallback; `test/items.test.ts` asserts exactly that, which is
 * what makes adding a new mechanical field without a branch here a test failure rather than a
 * silent "no per-turn effect" on screen.
 */
export function formatStatusEffectMechanics(def: StatusEffectDefinition): string {
  const parts: string[] = [];
  for (const e of def.perTurnEffects) {
    if (e.kind === "damage") parts.push(t("item.effectPerTurnDamage", { amount: e.amount ?? 0 }));
    else if (e.kind === "heal") parts.push(t("item.effectPerTurnHeal", { amount: e.amount ?? 0 }));
    else if (e.kind === "modifyCombatStat" && e.combatStat)
      parts.push(t("item.effectPerTurnStat", { amount: signed(e.amount ?? 0), stat: COMBAT_STAT_LABEL[e.combatStat] }));
  }
  if (def.onHitStatusEffectId) parts.push(t("item.effectOnHitRider", { status: getStatusEffect(def.onHitStatusEffectId).name }));
  if (def.onHitAoeDamage) parts.push(t("item.effectOnHitAoe", { amount: def.onHitAoeDamage.amount }));
  if (def.accuracyPenaltyPercent) parts.push(t("item.effectAccuracyPenalty", { percent: def.accuracyPenaltyPercent }));
  if (def.vulnerableTo) parts.push(t("item.effectVulnerable", { status: getStatusEffect(def.vulnerableTo.statusEffectId).name }));
  if (def.stuns) parts.push(t("item.effectStuns"));
  return parts.length > 0 ? parts.join(", ") : t("item.effectNoPerTurn");
}
