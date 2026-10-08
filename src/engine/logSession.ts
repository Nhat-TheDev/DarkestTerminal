import type { CombatState, Id, LogSession, SkillEffect } from "../types";
import { getStatusEffect } from "../data/statusEffects";
import { isHelpfulStatusEffect, isPlayerSide, isSummon, type Actor } from "./resolver";

/** The battlefield unit an actor is drawn as: a summon has no sprite of its own, so it stands for its owner. */
export function unitId(actor: Actor): Id {
  return isSummon(actor) ? actor.ownerId : actor.id;
}

function addUnique(list: Id[], id: Id): void {
  if (!list.includes(id)) list.push(id);
}

/** What a non-damage effect means for a unit on the caster's own side, or `null` when it is a cost/drawback rather than help. */
function sameSideRole(effect: SkillEffect): "healed" | "buffed" | null {
  switch (effect.kind) {
    case "heal":
    case "restoreMp":
      return "healed";
    case "removeStatusEffect":
      return "buffed";
    case "applyStatusEffect":
      return effect.statusEffectId && isHelpfulStatusEffect(getStatusEffect(effect.statusEffectId)) ? "buffed" : null;
    case "modifyCombatStat":
      return (effect.amount ?? 0) > 0 ? "buffed" : null;
    case "modifyStat":
      // Fear is the one survival stat where a higher number is worse.
      return (effect.amount ?? 0) * (effect.stat === "fear" ? -1 : 1) > 0 ? "buffed" : null;
    default:
      return null;
  }
}

/**
 * Records which role `target` plays in the running session, from the effects that apply to it.
 * `skillDealsDamage` is a property of the whole skill, not of this target: a skill that hits one
 * enemy and debuffs all of them is an attack on all of them. Called before accuracy rolls, so a
 * missed or dodged target is still shown as targeted.
 */
export function noteSkillTarget(combat: CombatState, source: Actor, target: Actor, effects: SkillEffect[], skillDealsDamage: boolean): void {
  const session = combat.activeSession;
  if (!session) return;
  const id = unitId(target);
  if (isPlayerSide(source) !== isPlayerSide(target)) {
    if (skillDealsDamage && effects.length > 0) addUnique(session.attackedIds, id);
    else if (effects.some((e) => e.kind !== "summon")) addUnique(session.debuffedIds, id);
    return;
  }
  for (const effect of effects) {
    const role = sameSideRole(effect);
    if (role === "healed") addUnique(session.healedIds, id);
    else if (role === "buffed") addUnique(session.buffedIds, id);
  }
}

/** A plain attack (a monster's or summon's basic attack, a charge, an on-hit AoE) has no skill to read effects from. */
export function noteBasicAttack(combat: CombatState, source: Actor, target: Actor): void {
  noteSkillTarget(combat, source, target, [{ kind: "damage" }], true);
}

/** Lights `actor` in the running session without giving it an icon (DoT tick, dying damage, artifact auto-damage). */
export function noteAffected(combat: CombatState, actor: Actor): void {
  if (combat.activeSession) addUnique(combat.activeSession.affectedIds, unitId(actor));
}

/**
 * Runs `body` and tags every log entry it adds with one shared `LogSession`. Entries already tagged
 * by a nested session keep theirs. A body that logs nothing leaves no session behind. The session's
 * id is the index of the first entry it actually tags, so nested sessions can never collide.
 */
export function runInSession<T>(combat: CombatState, actorId: Id | null, body: () => T, affectedIds: Id[] = []): T {
  const outer = combat.activeSession;
  const start = combat.log.length;
  const session: LogSession = { id: -1, actorId, attackedIds: [], debuffedIds: [], buffedIds: [], healedIds: [], affectedIds: [...affectedIds] };
  combat.activeSession = session;
  let result: T;
  try {
    result = body();
  } finally {
    combat.activeSession = outer;
  }
  session.debuffedIds = session.debuffedIds.filter((id) => !session.attackedIds.includes(id));
  for (let i = start; i < combat.log.length; i++) {
    const entry = combat.log[i];
    if (!entry || entry.session) continue;
    if (session.id < 0) session.id = i;
    entry.session = session;
  }
  return result;
}

/**
 * One actor-less session for a whole block of per-unit ticks (DoT, stat-mod expiry): units whose
 * tick logged nothing stay grey, and the block costs one hold on screen rather than one per unit.
 */
export function runTicksInSession(combat: CombatState, actors: Actor[], tick: (actor: Actor) => void): void {
  runInSession(combat, null, () => {
    for (const actor of actors) {
      const before = combat.log.length;
      tick(actor);
      if (combat.log.length > before) noteAffected(combat, actor);
    }
  });
}
