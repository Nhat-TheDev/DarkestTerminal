import type { CombatState, Monster } from "../types";
import { ownPassiveRank } from "../data/classes";
import { getStatusEffect } from "../data/statusEffects";
import { t } from "../data/strings";
import { isCharacter, type Actor } from "./resolver";
import { hasStunningStatus, type EngineContext } from "./combat";

/**
 * Who takes a monster's single-target hit aimed at `target`: the actor that applied an `interceptsForSource`
 * status to it, while that actor is alive and not stunned, or `target` itself. An actor already in
 * `alreadyTargeted` never takes a second hit from the same cast. Failing that, a Watchful Knight may take a hit
 * aimed at the lowest-HP-percent party character, once per round.
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
  return watchfulGuardian(target, alreadyTargeted, combat, ctx) ?? target;
}

function watchfulGuardian(target: Actor & { hp: number; maxHp: number }, alreadyTargeted: readonly Actor[], combat: CombatState, ctx: EngineContext): Actor | null {
  const living = ctx.party.filter((c) => c.isAlive && c.hp > 0);
  const weakest = living.reduce<(typeof living)[number] | null>((low, c) => (!low || c.hp / c.maxHp < low.hp / low.maxHp ? c : low), null);
  if (weakest?.id !== target.id) return null;
  for (const watcher of living) {
    if (watcher.id === target.id) continue;
    const chance = ownPassiveRank(watcher)?.interceptWeakestChancePercent;
    if (!chance) continue;
    if (hasStunningStatus(watcher) || alreadyTargeted.some((a) => a.id === watcher.id)) continue;
    if (combat.watchfulRound?.[watcher.id] === combat.roundNumber) continue;
    if (!ctx.rng.chance(chance / 100)) continue;
    (combat.watchfulRound ??= {})[watcher.id] = combat.roundNumber;
    combat.log.push({ text: t("combat.interpose", { guardian: watcher.name, ally: target.name }), kind: "info" });
    return watcher;
  }
  return null;
}
