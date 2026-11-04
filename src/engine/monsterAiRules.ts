import type { Id, Monster, MonsterAiPredicate, MonsterAiRule } from "../types";
import { statusSatisfiesRequirement } from "../data/statusEffects";
import type { Actor } from "./resolver";

/** What a monster's AI rules can see on its turn. `allies` never includes the acting monster itself. */
export interface AiView {
  self: Monster;
  enemies: Actor[];
  allies: Monster[];
}

function hasStatus(actor: Actor, id: Id): boolean {
  return actor.activeStatusEffects.some((s) => statusSatisfiesRequirement(s.statusEffectId, id));
}

function hpPercent(actor: Actor): number {
  return (actor.hp / actor.maxHp) * 100;
}

/** Every field present must hold. `target*` fields test `candidate` when one is given, otherwise any living enemy. */
export function predicateHolds(p: MonsterAiPredicate, view: AiView, candidate?: Actor): boolean {
  const pool = candidate ? [candidate] : view.enemies;
  if (p.selfHpBelowPercent !== undefined && !(hpPercent(view.self) < p.selfHpBelowPercent)) return false;
  if (p.selfHasStatusId !== undefined && !hasStatus(view.self, p.selfHasStatusId)) return false;
  if (p.selfLacksStatusId !== undefined && hasStatus(view.self, p.selfLacksStatusId)) return false;
  if (p.targetHasStatusId !== undefined && !pool.some((a) => hasStatus(a, p.targetHasStatusId!))) return false;
  if (p.targetLacksStatusId !== undefined && !pool.some((a) => !hasStatus(a, p.targetLacksStatusId!))) return false;
  if (p.targetHpBelowPercent !== undefined && !pool.some((a) => hpPercent(a) < p.targetHpBelowPercent!)) return false;
  if (p.targetsBelowHpPercent !== undefined && view.enemies.filter((a) => hpPercent(a) < p.targetsBelowHpPercent!).length < (p.atLeast ?? 1)) return false;
  if (p.alliesFewerThan !== undefined && !(view.allies.length < p.alliesFewerThan)) return false;
  return true;
}

export function scoreWeight(weight: number, rules: MonsterAiRule[] | undefined, view: AiView, candidate?: Actor): number {
  return (rules ?? []).reduce((w, rule) => (predicateHolds(rule.if, view, candidate) ? w * rule.weightMultiplier : w), weight);
}
