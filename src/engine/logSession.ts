import type { CombatState, CombatantSnapshot, Id, LogSession, SkillEffect } from "../types";
import { getStatusEffect } from "../data/statusEffects";
import { isPlayerSide, isSummon, statDirection, statusRole, type Actor } from "./resolver";

/** The battlefield unit an actor is drawn as: a summon has no sprite of its own, so it stands for its owner. */
export function unitId(actor: Actor): Id {
  return isSummon(actor) ? actor.ownerId : actor.id;
}

function addUnique(list: Id[], id: Id): void {
  if (!list.includes(id)) list.push(id);
}

/** Records that `actor`, if it is a summon, took part in the running session. */
function noteSummon(session: LogSession, actor: Actor): void {
  if (isSummon(actor)) addUnique(session.summonIds, actor.ownerId);
}

/** What a non-damage effect means for a unit on the caster's own side, or `null` when it is a cost/drawback rather than help. */
function sameSideRole(effect: SkillEffect): "healed" | "buffed" | null {
  switch (effect.kind) {
    case "heal":
    case "restoreMp":
      return "healed";
    case "removeStatusEffect":
      return "buffed";
    case "applyStatusEffect": {
      const role = effect.statusEffectId ? statusRole(getStatusEffect(effect.statusEffectId)) : null;
      return role === "heal" ? "healed" : role === "buff" ? "buffed" : null;
    }
    case "modifyCombatStat":
      return statDirection(effect) > 0 ? "buffed" : null;
    case "modifyStat":
      // Fear is the one survival stat where a higher number is worse.
      return (effect.amount ?? 0) * (effect.stat === "fear" ? -1 : 1) > 0 ? "buffed" : null;
    default:
      return null;
  }
}

/** An effect that lowers a stat on its target: a status that does, or a direct stat cut. */
function isStatDebuff(effect: SkillEffect): boolean {
  if (effect.kind === "applyStatusEffect") return effect.statusEffectId !== undefined && statusRole(getStatusEffect(effect.statusEffectId)) === "debuff";
  return effect.kind === "modifyCombatStat" && statDirection(effect) < 0;
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
  noteSummon(session, source);
  noteSummon(session, target);
  if (isPlayerSide(source) !== isPlayerSide(target)) {
    if (skillDealsDamage && effects.length > 0) addUnique(session.attackedIds, id);
    else if (effects.some(isStatDebuff)) addUnique(session.debuffedIds, id);
    // Touched without a debuff role (poison, a vulnerability mark): lit, but no icon.
    else if (effects.some((e) => e.kind !== "summon")) addUnique(session.affectedIds, id);
    return;
  }
  let helped = false;
  for (const effect of effects) {
    const role = sameSideRole(effect);
    if (role === "healed") addUnique(session.healedIds, id);
    else if (role === "buffed") addUnique(session.buffedIds, id);
    if (role !== null) helped = true;
  }
  // Touched without being helped (an item that lowers an ally's aggro, a cost the skill charges): lit, but no icon.
  if (!helped && effects.some((e) => e.kind !== "summon")) addUnique(session.affectedIds, id);
}

/** A plain attack (a monster's or summon's basic attack, a charge, an on-hit AoE) has no skill to read effects from. */
export function noteBasicAttack(combat: CombatState, source: Actor, target: Actor): void {
  noteSkillTarget(combat, source, target, [{ kind: "damage" }], true);
}

/** Lights `actor` in the running session without giving it a role (DoT tick, dying damage, an artifact's bearer). */
export function noteAffected(combat: CombatState, actor: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(session.affectedIds, unitId(actor));
  noteSummon(session, actor);
}

/** The attack aimed at `target` missed or was dodged: the battlefield says "miss" instead of a number. */
export function noteMiss(combat: CombatState, target: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(session.missedIds, unitId(target));
  noteSummon(session, target);
}

/** `target` threw off everything the action tried to put on it: still lit as the one aimed at, with a miss in place of a debuff icon. */
export function noteResisted(combat: CombatState, target: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  const id = unitId(target);
  // A summon is drawn as its owner: a debuff that landed on the summon must keep the owner's icon.
  if (!session.summonIds.includes(id)) session.debuffedIds = session.debuffedIds.filter((d) => d !== id);
  addUnique(session.affectedIds, id);
  noteMiss(combat, target);
}

/** A damage-over-time or heal-over-time tick moved `actor`'s HP: the battlefield shows each kind it received, not just the net change. */
export function noteDotEffect(combat: CombatState, actor: Actor, kind: "damage" | "heal"): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(kind === "damage" ? session.tickDamageIds : session.healedIds, unitId(actor));
  noteSummon(session, actor);
}

/** `actor`'s turn is cancelled — stunned, too afraid to act, or interrupted — so the battlefield marks it as such. */
export function noteLostTurn(combat: CombatState, actor: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(session.lostTurnIds, unitId(actor));
  noteSummon(session, actor);
}

/** `character`'s fear rose or fell in the running session. */
export function noteFearChange(combat: CombatState, character: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(session.fearChangedIds, character.id);
}

/** `actor` drained HP from the damage it just dealt. */
export function noteLifesteal(combat: CombatState, actor: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(session.lifestealIds, unitId(actor));
  noteSummon(session, actor);
}

export interface SessionOptions {
  /** Units lit from the start (an actor-less block that already knows who it touches). */
  affectedIds?: Id[];
  cause?: LogSession["cause"];
  /** The session is one summon's own action, so it counts as a summon session. */
  bySummon?: boolean;
  /** Combatant state to attach to the session's entries, taken when each run of them ends. */
  snapshot?: () => CombatantSnapshot[];
}

/** A session's entries not yet tagged: they start at `from` and end where the session is interrupted or finishes. */
interface Run {
  session: LogSession;
  from: number;
  snapshot?: () => CombatantSnapshot[];
}

const openRuns = new WeakMap<LogSession, Run>();

/** Tags the run's untagged entries with its session, and with the combatant state as of now. */
function closeRun(combat: CombatState, run: Run): void {
  let snapshot: CombatantSnapshot[] | undefined;
  for (let i = run.from; i < combat.log.length; i++) {
    const entry = combat.log[i];
    if (!entry || entry.session) continue;
    if (run.session.id < 0) run.session.id = i;
    entry.session = run.session;
    if (entry.buffLostOf) {
      addUnique(run.session.buffLostIds, entry.buffLostOf);
      if (entry.buffLostOfSummon) addUnique(run.session.summonIds, entry.buffLostOf);
    }
    if (run.snapshot) entry.snapshot = snapshot ??= run.snapshot();
  }
  run.from = combat.log.length;
}

/**
 * Runs `body` and tags every log entry it adds with one shared `LogSession`. Entries already tagged
 * by a nested session keep theirs. A body that logs nothing leaves no session behind. The session's
 * id is the index of the first entry it actually tags, so nested sessions can never collide.
 *
 * Each contiguous run of the session's entries carries the state as of the end of that run: a nested
 * session first closes the outer's run so far, so neither shows HP changes that belong to the other.
 */
export function runInSession<T>(combat: CombatState, actorId: Id | null, body: () => T, options: SessionOptions = {}): T {
  const outer = combat.activeSession;
  const outerRun = outer ? openRuns.get(outer) : undefined;
  if (outerRun) closeRun(combat, outerRun);
  const session: LogSession = {
    id: -1,
    actorId,
    attackedIds: [],
    debuffedIds: [],
    buffedIds: [],
    healedIds: [],
    missedIds: [],
    lifestealIds: [],
    tickDamageIds: [],
    buffLostIds: [],
    lostTurnIds: [],
    summonIds: options.bySummon && actorId !== null ? [actorId] : [],
    affectedIds: [...(options.affectedIds ?? [])],
    fearChangedIds: [],
    ...(options.cause ? { cause: options.cause } : {}),
  };
  const run: Run = { session, from: combat.log.length, snapshot: options.snapshot };
  openRuns.set(session, run);
  combat.activeSession = session;
  let result: T;
  try {
    result = body();
  } finally {
    combat.activeSession = outer;
    openRuns.delete(session);
  }
  session.debuffedIds = session.debuffedIds.filter((id) => !session.attackedIds.includes(id));
  closeRun(combat, run);
  return result;
}

/**
 * One actor-less session for a whole block of per-unit ticks (DoT, stat-mod expiry): units whose
 * tick logged nothing stay grey, and the block costs one hold on screen rather than one per unit.
 */
export function runTicksInSession(combat: CombatState, actors: Actor[], tick: (actor: Actor) => void, options: Omit<SessionOptions, "affectedIds"> = {}): void {
  runInSession(
    combat,
    null,
    () => {
      for (const actor of actors) {
        const before = combat.log.length;
        tick(actor);
        if (combat.log.length > before) noteAffected(combat, actor);
      }
    },
    options
  );
}
