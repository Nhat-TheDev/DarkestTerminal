import type { CombatState, CombatantSnapshot, Id, LogSession, SkillEffect } from "../types";
import { getStatusEffect } from "../data/statusEffects";
import { isPlayerSide, isSummon, statDirection, statusRole, type Actor } from "./resolver";

/** A summon has no sprite of its own, so it is drawn as its owner. */
export function unitId(actor: Actor): Id {
  return isSummon(actor) ? actor.ownerId : actor.id;
}

function addUnique(list: Id[], id: Id): void {
  if (!list.includes(id)) list.push(id);
}

function noteSummon(session: LogSession, actor: Actor): void {
  if (isSummon(actor)) addUnique(session.summonIds, actor.ownerId);
}

/** `null` when the effect is a cost or drawback rather than help. */
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

function isStatDebuff(effect: SkillEffect): boolean {
  if (effect.kind === "applyStatusEffect") return effect.statusEffectId !== undefined && statusRole(getStatusEffect(effect.statusEffectId)) === "debuff";
  return effect.kind === "modifyCombatStat" && statDirection(effect) < 0;
}

/**
 * `skillDealsDamage` is per skill, not per target: a skill that hits one enemy and debuffs all of
 * them attacks all of them. Called before accuracy rolls, so a missed target still shows as targeted.
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

export function noteBasicAttack(combat: CombatState, source: Actor, target: Actor): void {
  noteSkillTarget(combat, source, target, [{ kind: "damage" }], true);
}

export function noteAffected(combat: CombatState, actor: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(session.affectedIds, unitId(actor));
  noteSummon(session, actor);
}

export function noteMiss(combat: CombatState, target: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(session.missedIds, unitId(target));
  noteSummon(session, target);
}

/** Still lit as targeted, with a miss in place of a debuff icon. */
export function noteResisted(combat: CombatState, target: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  const id = unitId(target);
  // A summon is drawn as its owner: a debuff that landed on the summon must keep the owner's icon.
  if (!session.summonIds.includes(id)) session.debuffedIds = session.debuffedIds.filter((d) => d !== id);
  addUnique(session.affectedIds, id);
  noteMiss(combat, target);
}

export function noteDotEffect(combat: CombatState, actor: Actor, kind: "damage" | "heal"): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(kind === "damage" ? session.tickDamageIds : session.healedIds, unitId(actor));
  noteSummon(session, actor);
}

export function noteLostTurn(combat: CombatState, actor: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(session.lostTurnIds, unitId(actor));
  noteSummon(session, actor);
}

export function noteFearChange(combat: CombatState, character: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(session.fearChangedIds, character.id);
}

export function noteLifesteal(combat: CombatState, actor: Actor): void {
  const session = combat.activeSession;
  if (!session) return;
  addUnique(session.lifestealIds, unitId(actor));
  noteSummon(session, actor);
}

export interface SessionOptions {
  affectedIds?: Id[];
  cause?: LogSession["cause"];
  bySummon?: boolean;
  /** Taken when each run of the session's entries ends. */
  snapshot?: () => CombatantSnapshot[];
}

/** Untagged entries from `from` up to where the session is interrupted or finishes. */
interface Run {
  session: LogSession;
  from: number;
  snapshot?: () => CombatantSnapshot[];
}

const openRuns = new WeakMap<LogSession, Run>();

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
    if (entry.statusLandedOf) addUnique(entry.statusLanded === "dot" ? run.session.dotLandedIds : run.session.debuffLandedIds, entry.statusLandedOf);
    if (entry.statusImmuneOf) addUnique(run.session.immuneIds, entry.statusImmuneOf);
    if (run.snapshot) entry.snapshot = snapshot ??= run.snapshot();
  }
  run.from = combat.log.length;
}

/**
 * Entries a nested session tagged keep theirs. The id is the first tagged entry's index, so nested
 * sessions never collide. A nested session first closes the outer's run, so neither snapshot shows
 * HP changes that belong to the other.
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
    debuffLandedIds: [],
    dotLandedIds: [],
    immuneIds: [],
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

/** One session for a block of ticks: costs one hold on screen, and units whose tick logged nothing stay grey. */
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
