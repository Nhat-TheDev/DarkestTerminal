import type { CombatState, Monster } from "../types";
import { getStatusEffect } from "../data/statusEffects";
import { t } from "../data/strings";
import { isCharacter, type Actor } from "./resolver";
import { hasStunningStatus, type EngineContext } from "./combat";

/**
 * Who takes a monster's single-target hit aimed at `target`: the actor that applied an `interceptsForSource`
 * status to it, while that actor is alive and not stunned, or `target` itself. An actor already in
 * `alreadyTargeted` never takes a second hit from the same cast.
 */
export function interceptTarget(attacker: Monster, target: Actor, alreadyTargeted: readonly Actor[], combat: CombatState, ctx: EngineContext): Actor {
  if (!isCharacter(target)) return target;
  for (const active of target.activeStatusEffects) {
    if (!active.sourceId || !getStatusEffect(active.statusEffectId).interceptsForSource) continue;
    const guardian = ctx.party.find((c) => c.id === active.sourceId);
    if (!guardian || !guardian.isAlive || guardian.hp <= 0 || guardian.id === target.id) continue;
    if (hasStunningStatus(guardian) || alreadyTargeted.some((a) => a.id === guardian.id)) continue;
    combat.log.push({ text: t("combat.interpose", { guardian: guardian.name, ally: target.name }), kind: "info" });
    return guardian;
  }
  return target;
}
