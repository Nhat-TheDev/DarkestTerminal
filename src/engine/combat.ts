import type {
  Character,
  Monster,
  Summon,
  CombatState,
  Combatant,
  CombatantRef,
  QueuedAction,
  SkillTarget,
  SkillDefinition,
  SkillEffect,
  SummonStatFormula,
  SummonSourceStat,
  ActionSource,
  Id,
  LogEntry,
  LogEntryKind,
  CombatantSnapshot,
  PartyStateSnapshot,
} from "../types";
import { getSkill, getEffectiveSkill, effectiveSkillRank, getClass, passiveRankDef } from "../data/classes";
import { characterBaseStats, activeStatusCombatStatSum } from "./party";
import { getItem } from "../data/items";
import { getStatusEffect, statusSatisfiesRequirement, statusDisplayName } from "../data/statusEffects";
import { getSummonArchetype, getSummonSkill, getSummonCast } from "../data/summons";
import { spawnMonster } from "../data/monsters";
import { rollDodge, autoDamageEntries, totalCooldownReduction, alwaysHitChance, debuffResistPercent, combinePercents } from "./artifacts";
import { Rng } from "./rng";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";
import { applyRoundFear, applyHitFear, applyVictoryFearRelief, isPartyDying, applyDyingDamage } from "./survival";
import { combatHooks } from "./combatHooks";
import { runMonsterTurn } from "./monsterAI";
import { noteAffected, noteBasicAttack, noteDotEffect, noteFearChange, noteLifesteal, noteLostTurn, noteMiss, noteResisted, noteSkillTarget, runInSession, runTicksInSession, unitId } from "./logSession";
import {
  type Actor,
  isCharacter,
  isMonster,
  isSummon,
  isPlayerSide,
  isActorAlive,
  resolveSkillEffect,
  tickDotEffects,
  tickStatModEffects,
  tickSpecialEffects,
  specialStatusSnapshot,
  rollHits,
  rollLosesControl,
  getFearTier,
  expireStatusEffect,
  isHelpfulStatusEffect,
} from "./resolver";

export interface EngineContext {
  party: Character[];
  monsters: Monster[];
  summons: Summon[];
  rng: Rng;
  inventory: Record<Id, number>;
  /** Set for the length of one `resolveRound`, so fear gained mid-round scales with the floor. */
  floorDepth?: number;
}

function actionDefinition(source: ActionSource, actor?: Actor): SkillDefinition {
  if (source.kind === "skill") {
    const skill = getSkill(source.skillId);
    return actor && isCharacter(actor) ? getEffectiveSkill(skill, actor.level) : skill;
  }
  const item = getItem(source.itemId);
  return { id: item.id, name: item.name, description: item.description, mpCost: 0, target: item.target, effects: item.effects, slot: 0, unlockLevel: 0, fromItem: true };
}

export function getActorByRef(ref: CombatantRef, ctx: EngineContext): Actor {
  if (ref.kind === "character") {
    const c = ctx.party.find((p) => p.id === ref.id);
    if (!c) throw new Error(`Unknown character: ${ref.id}`);
    return c;
  }
  if (ref.kind === "summon") {
    const s = ctx.summons.find((su) => su.id === ref.id);
    if (!s) throw new Error(`Unknown summon: ${ref.id}`);
    return s;
  }
  const m = ctx.monsters.find((mo) => mo.id === ref.id);
  if (!m) throw new Error(`Unknown monster: ${ref.id}`);
  return m;
}

function refEquals(a: CombatantRef, b: CombatantRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function startCombat(roomId: string, monsterIds: string[], ctx: EngineContext, isBossFight: boolean): CombatState {
  // A summon never outlives its combat.
  dismissSummonsAtCombatEnd(ctx);
  for (const c of ctx.party) {
    c.usesRemainingThisCombat = {};
    c.cooldownsRemaining = {};
  }
  const combatants: Combatant[] = [
    ...ctx.party.filter((c) => c.isAlive).map((c) => ({ ref: { kind: "character" as const, id: c.id }, speed: c.speed })),
    ...monsterIds.map((id) => {
      const m = ctx.monsters.find((mo) => mo.id === id)!;
      return { ref: { kind: "monster" as const, id: m.id }, speed: m.speed };
    }),
  ];
  return {
    roomId,
    combatants,
    roundNumber: 1,
    phase: "command",
    queuedActions: [],
    turnQueue: [],
    activeTurnIndex: 0,
    isBossFight,
    log: [{ text: t("combat.started", { roomId }), kind: "info" }],
  };
}

export function livingCharacterRefs(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  return combat.combatants
    .filter((c) => c.ref.kind === "character")
    .map((c) => c.ref)
    .filter((ref) => isActorAlive(getActorByRef(ref, ctx)));
}

export function livingSummonRefs(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  return combat.combatants
    .filter((c) => c.ref.kind === "summon")
    .map((c) => c.ref)
    .filter((ref) => isActorAlive(getActorByRef(ref, ctx)));
}

export function livingPlayerSideRefs(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  return [...livingCharacterRefs(combat, ctx), ...livingSummonRefs(combat, ctx)];
}

export function livingMonsterRefs(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  return combat.combatants
    .filter((c) => c.ref.kind === "monster")
    .map((c) => c.ref)
    .filter((ref) => isActorAlive(getActorByRef(ref, ctx)));
}

/** The pool monsters target from: minus anyone `untargetable`. Ally targeting uses `livingPlayerSideRefs`. */
export function livingPlayerSideEnemyFacingRefs(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  return livingPlayerSideRefs(combat, ctx).filter((ref) => !isUntargetable(getActorByRef(ref, ctx)));
}

/** Whether the actor currently carries a status that excludes it from the opposing side's target picking (a stealthed Ninja, an airborne Dragon). */
export function isUntargetable(actor: Actor): boolean {
  return actor.activeStatusEffects.some((s) => getStatusEffect(s.statusEffectId).untargetable);
}

/** `livingMonsterRefs` minus any monster currently `untargetable` — what the party can aim at. `isCombatOver` keeps using `livingMonsterRefs`: an airborne monster is still in the fight. */
export function livingTargetableMonsterRefs(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  return livingMonsterRefs(combat, ctx).filter((ref) => !isUntargetable(getActorByRef(ref, ctx)));
}

export function autoResolveTargets(target: SkillTarget, actor: CombatantRef, combat: CombatState, ctx: EngineContext): CombatantRef[] | null {
  const actorIsPlayerSide = actor.kind !== "monster";
  switch (target) {
    case "self":
      return [actor];
    case "allAllies":
      return actorIsPlayerSide ? livingPlayerSideRefs(combat, ctx) : livingMonsterRefs(combat, ctx);
    case "allEnemies":
      return actorIsPlayerSide ? livingTargetableMonsterRefs(combat, ctx) : livingPlayerSideEnemyFacingRefs(combat, ctx);
    case "allAlliesAndEnemies": {
      const allies = actorIsPlayerSide ? livingPlayerSideRefs(combat, ctx) : livingMonsterRefs(combat, ctx);
      const enemies = actorIsPlayerSide ? livingTargetableMonsterRefs(combat, ctx) : livingPlayerSideEnemyFacingRefs(combat, ctx);
      return [...allies, ...enemies];
    }
    default:
      return null;
  }
}

export interface QueueActionError {
  reason: string;
}

export function checkSkillUsable(actor: Actor, skill: SkillDefinition): QueueActionError | null {
  if (!isCharacter(actor)) return { reason: t("errors.characterPhaseOnly") };
  if (!actor.unlockedSkillIds.includes(skill.id)) return { reason: t("errors.skillLocked") };
  if (actor.mp < skill.mpCost) return { reason: t("errors.notEnoughMp") };
  if (skill.usesPerCombat !== undefined) {
    const used = actor.usesRemainingThisCombat[skill.id] ?? skill.usesPerCombat;
    if (used <= 0) return { reason: t("errors.skillUsesExhausted") };
  }
  const cooldownLeft = actor.cooldownsRemaining[skill.id] ?? 0;
  if (cooldownLeft > 0) return { reason: t("errors.skillOnCooldown", { turns: cooldownLeft }) };
  return null;
}

export function queueAction(
  combat: CombatState,
  actorRef: CombatantRef,
  skillId: string,
  chosenTargets: CombatantRef[],
  ctx: EngineContext
): QueueActionError | null {
  const actor = getActorByRef(actorRef, ctx);
  const skill = isCharacter(actor) ? getEffectiveSkill(getSkill(skillId), actor.level) : getSkill(skillId);
  const err = checkSkillUsable(actor, skill);
  if (err) return err;

  // MP, uses and cooldown are committed when the skill executes (runCharacterTurn), so they don't
  // look spent before the character's turn comes up during the round's reveal.
  combat.queuedActions.push({ actor: actorRef, source: { kind: "skill", skillId }, targets: chosenTargets });
  return null;
}

export function checkItemUsable(actor: Actor, itemId: Id, inventory: Record<Id, number>): QueueActionError | null {
  if (!isCharacter(actor)) return { reason: t("errors.characterPhaseOnly") };
  if ((inventory[itemId] ?? 0) <= 0) return { reason: t("errors.noItem") };
  if (getItem(itemId).combatUsable === false) return { reason: t("errors.itemNotUsableInCombat") };
  return null;
}

export function queueItemAction(
  combat: CombatState,
  actorRef: CombatantRef,
  itemId: Id,
  chosenTargets: CombatantRef[],
  ctx: EngineContext
): QueueActionError | null {
  const actor = getActorByRef(actorRef, ctx);
  const err = checkItemUsable(actor, itemId, ctx.inventory);
  if (err) return err;

  ctx.inventory[itemId] = (ctx.inventory[itemId] ?? 0) - 1;
  combat.queuedActions.push({ actor: actorRef, source: { kind: "item", itemId }, targets: chosenTargets });
  return null;
}

export function allLivingCharactersHaveQueuedActions(combat: CombatState, ctx: EngineContext): boolean {
  const living = livingCharacterRefs(combat, ctx);
  return living.every((ref) => combat.queuedActions.some((qa) => refEquals(qa.actor, ref)));
}

function isSummonSkill(def: SkillDefinition): boolean {
  return (def.effects ?? []).some((e) => e.kind === "summon");
}

function turnOrderSortKey(c: Combatant, combat: CombatState): number {
  if (c.ref.kind !== "character") return c.speed;
  const queued = combat.queuedActions.find((qa) => refEquals(qa.actor, c.ref));
  if (!queued) return c.speed;
  const def = actionDefinition(queued.source);
  if (def.isBuff && !isSummonSkill(def)) return c.speed + BALANCE.combat.buffTurnOrderSpeedBonus;
  return c.speed;
}

function buildTurnQueue(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  const living = combat.combatants.filter((c) => isActorAlive(getActorByRef(c.ref, ctx)));
  for (const c of living) c.speed = getActorByRef(c.ref, ctx).speed;
  const sorted = [...living].sort((a, b) => {
    const bKey = turnOrderSortKey(b, combat);
    const aKey = turnOrderSortKey(a, combat);
    if (bKey !== aKey) return bKey - aKey;
    if (a.ref.kind !== b.ref.kind) return a.ref.kind === "character" ? -1 : 1;
    return 0;
  });
  return sorted.map((c) => c.ref);
}

export function snapshotCombatants(combat: CombatState, ctx: EngineContext): CombatantSnapshot[] {
  const departed: CombatantSnapshot[] = (combat.departedSummons ?? []).map((d) => ({ id: d.id, hp: d.hp, maxHp: d.maxHp, isAlive: false, activeStatusEffects: [] }));
  const present = combat.combatants.map((c): CombatantSnapshot => {
    const actor = getActorByRef(c.ref, ctx);
    const isCharacter = c.ref.kind === "character";
    return {
      id: actor.id,
      hp: actor.hp,
      maxHp: actor.maxHp,
      isAlive: isActorAlive(actor),
      level: isCharacter ? (actor as Character).level : undefined,
      mp: isCharacter ? (actor as Character).mp : undefined,
      maxMp: isCharacter ? (actor as Character).maxMp : undefined,
      fear: isCharacter ? (actor as Character).survival.fear : undefined,
      activeStatusEffects: actor.activeStatusEffects.map((s) => ({ ...s })),
    };
  });
  return [...present, ...departed];
}

/** Skips entries a session already tagged with its own snapshot. */
export function tagLogRange(combat: CombatState, fromIndex: number, snapshot: CombatantSnapshot[]): void {
  for (let i = fromIndex; i < combat.log.length; i++) {
    const entry = combat.log[i];
    if (entry && !entry.snapshot) entry.snapshot = snapshot;
  }
}

function sessionSnapshot(combat: CombatState, ctx: EngineContext): () => CombatantSnapshot[] {
  return () => snapshotCombatants(combat, ctx);
}

/** Party-wide fear has no actor or line of its own, so a hidden entry carries the session. */
function runFearSession(combat: CombatState, ctx: EngineContext, changeFear: () => Character[]): void {
  runInSession(
    combat,
    null,
    () => {
      const changed = changeFear();
      for (const c of changed) {
        noteAffected(combat, c);
        noteFearChange(combat, c);
      }
      if (changed.length > 0) combat.log.push({ text: "", kind: "info", hidden: true });
    },
    { cause: "fear", snapshot: sessionSnapshot(combat, ctx) }
  );
}

export function tagPartySnapshotRange(combat: CombatState, fromIndex: number, partySnapshot: PartyStateSnapshot): void {
  for (let i = fromIndex; i < combat.log.length; i++) {
    const entry = combat.log[i];
    if (entry) entry.partySnapshot = partySnapshot;
  }
}

function runArtifactAutoDamage(combat: CombatState, ctx: EngineContext): void {
  runInSession(
    combat,
    null,
    () => {
      for (const character of ctx.party) {
        if (!character.isAlive) continue;
        for (const { effect, sourceName } of autoDamageEntries(character)) {
          const alive = livingTargetableMonsterRefs(combat, ctx);
          if (alive.length === 0) return;
          const target = getActorByRef(ctx.rng.pick(alive), ctx) as Monster;
          noteAffected(combat, character);
          noteBasicAttack(combat, character, target);
          if (effect.offenseMultiplierPercent !== undefined) {
            const base = characterBaseStats(character);
            resolveSkillEffect(
              { kind: "damage", amount: effect.amount, offenseMultiplierPercent: effect.offenseMultiplierPercent },
              character,
              target,
              {
                log: combat.log,
                isMagic: effect.isMagic,
                skillName: sourceName,
                offensiveStatOverride: effect.isMagic ? base.magicPower : base.attack,
                isCrit: false,
                rollDamage: () => ctx.rng.next(),
              }
            );
            continue;
          }
          target.hp = Math.max(0, target.hp - effect.amount);
          combat.log.push({ text: t("combat.artifactAutoDamage", { character: character.name, amount: effect.amount, target: target.name }), kind: "attack" });
        }
      }
    },
    { cause: "artifact", snapshot: sessionSnapshot(combat, ctx) }
  );
}

/** Fires before the monster's turn. True when that turn must be skipped (interrupted or killed); the status is consumed either way. */
function tryTriggerOverwatch(monsterRef: CombatantRef, combat: CombatState, ctx: EngineContext): boolean {
  const watcher = ctx.party.find((c) => c.isAlive && c.activeStatusEffects.some((s) => getStatusEffect(s.statusEffectId).triggersOverwatch));
  if (!watcher) return false;
  // A monster that cannot be targeted (airborne) is not shot at, and the primed shot waits for one that can be.
  if (isUntargetable(getActorByRef(monsterRef, ctx))) return false;
  const active = watcher.activeStatusEffects.find((s) => getStatusEffect(s.statusEffectId).triggersOverwatch)!;
  const def = getStatusEffect(active.statusEffectId);

  return runInSession(
    combat,
    watcher.id,
    () => {
      const target = getActorByRef(monsterRef, ctx) as Monster;
      if (!isActorAlive(target)) {
        expireStatusEffect(watcher, active, { log: combat.log });
        return false;
      }
      // Before the accuracy roll: a missed shot still marks its target.
      noteBasicAttack(combat, watcher, target);
      if (!rollHits(watcher, () => ctx.rng.next())) {
        noteMiss(combat, target);
        expireStatusEffect(watcher, active, { log: combat.log });
        combat.log.push({ text: t("combat.overwatchMiss", { actor: watcher.name, target: target.name }), kind: "info" });
        return false;
      }
      const interrupts = def.interruptChance === undefined || ctx.rng.chance(def.interruptChance);
      const hitText = interrupts ? "combat.overwatchHit" : "combat.overwatchHitNoInterrupt";
      combat.log.push({ text: t(hitText, { actor: watcher.name, target: target.name }), kind: "attack" });
      resolveSkillEffect({ kind: "damage", amount: def.overwatchShot?.amount ?? 0, offenseMultiplierPercent: def.overwatchShot?.offenseMultiplierPercent }, watcher, target, {
        log: combat.log,
        rollDamage: () => ctx.rng.next(),
      });
      expireStatusEffect(watcher, active, { log: combat.log });
      // A killed monster has no turn left to lose.
      if (interrupts && isActorAlive(target)) noteLostTurn(combat, target);
      return interrupts || !isActorAlive(target);
    },
    { snapshot: sessionSnapshot(combat, ctx) }
  );
}

export function resolveRound(combat: CombatState, roundCtx: EngineContext, floorDepth = 1, satiety = 100): void {
  const ctx: EngineContext = { ...roundCtx, floorDepth };
  combat.phase = "resolution";
  combat.turnQueue = buildTurnQueue(combat, ctx);
  combat.activeTurnIndex = 0;
  combat.roundStartSnapshot = snapshotCombatants(combat, ctx);

  const combatActors = () => combat.combatants.map((c) => getActorByRef(c.ref, ctx));
  const snapshot = sessionSnapshot(combat, ctx);

  runTicksInSession(
    combat,
    combatActors(),
    (actor) => {
      if (isActorAlive(actor)) tickDotEffects(actor, { log: combat.log, onDotEffect: (kind) => noteDotEffect(combat, actor, kind) });
    },
    { cause: "dot", snapshot }
  );
  runInSession(combat, null, () => pruneDeadSummons(combat, ctx, combat.log), { snapshot });
  runArtifactAutoDamage(combat, ctx);

  const actedRefs: CombatantRef[] = [];
  for (const ref of combat.turnQueue) {
    const actor = getActorByRef(ref, ctx);
    if (!isActorAlive(actor)) continue;

    const eligibleSpecial = specialStatusSnapshot(actor);
    runInSession(
      combat,
      unitId(actor),
      () => {
        if (ref.kind === "character") {
          runCharacterTurn(ref, combat, ctx);
          actedRefs.push(ref);
        } else if (ref.kind === "summon") {
          runSummonTurn(ref, combat, ctx);
        } else if (!tryTriggerOverwatch(ref, combat, ctx)) {
          runMonsterTurn(ref, combat, ctx);
        }
        if (isActorAlive(actor)) tickSpecialEffects(actor, eligibleSpecial, { log: combat.log });
        pruneDeadSummons(combat, ctx, combat.log);
      },
      { snapshot, bySummon: ref.kind === "summon" }
    );

    if (isCombatOver(combat, ctx)) break;
  }

  if (isCombatOver(combat, ctx)) {
    // Refund what was pre-committed for characters who never got to act.
    for (const queued of combat.queuedActions) {
      if (queued.actor.kind !== "character") continue;
      if (actedRefs.some((ref) => refEquals(ref, queued.actor))) continue;
      const actor = getActorByRef(queued.actor, ctx) as Character;
      if (!isActorAlive(actor)) continue;
      refundQueuedAction(queued, ctx);
    }
  }

  if (!isCombatOver(combat, ctx)) {
    runTicksInSession(
      combat,
      combatActors(),
      (actor) => {
        if (isActorAlive(actor)) tickStatModEffects(actor, { log: combat.log });
      },
      { snapshot }
    );
    for (const c of ctx.party) {
      if (!c.isAlive) continue;
      for (const skillId of Object.keys(c.cooldownsRemaining)) {
        if (c.cooldownsRemaining[skillId]! > 0) c.cooldownsRemaining[skillId]! -= 1;
      }
    }
    runFearSession(combat, ctx, () => ctx.party.filter((c) => applyRoundFear(c, floorDepth) !== 0));
    if (isPartyDying(satiety)) {
      runInSession(combat, null, () => applyDyingDamage(ctx.party, combat.log), {
        affectedIds: ctx.party.filter((c) => c.isAlive).map((c) => c.id),
        cause: "dying",
        snapshot,
      });
    }
  }

  // Every entry above belongs to a session that tagged its own state; finalizeRound's lines belong to none.
  const blockStart = combat.log.length;
  finalizeRound(combat, ctx);
  tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));
}

export function hasStunningStatus(actor: Actor): boolean {
  return actor.activeStatusEffects.some((a) => getStatusEffect(a.statusEffectId).stuns === true);
}

/** Only items are pre-committed; skills commit nothing until they execute. */
function refundQueuedAction(queued: QueuedAction, ctx: EngineContext): void {
  if (queued.source.kind !== "item") return;
  ctx.inventory[queued.source.itemId] = (ctx.inventory[queued.source.itemId] ?? 0) + 1;
}

function runCharacterTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const actor = getActorByRef(ref, ctx) as Character;
  const queued = combat.queuedActions.find((qa) => refEquals(qa.actor, ref));
  if (!queued) return;

  if (hasStunningStatus(actor)) {
    refundQueuedAction(queued, ctx);
    combat.log.push({ text: t("combat.stunnedSkipTurn", { actor: actor.name }), kind: "info" });
    noteLostTurn(combat, actor);
    return;
  }

  if (rollLosesControl(actor.survival.fear, () => ctx.rng.next())) {
    refundQueuedAction(queued, ctx);
    combat.log.push({ text: t("combat.fearLoseControl", { actor: actor.name }), kind: "info" });
    noteLostTurn(combat, actor);
    return;
  }

  const skill = actionDefinition(queued.source, actor);
  const targets = resolveExecutionTargets(skill, queued, combat, ctx);
  if (targets === "fizzle") {
    refundQueuedAction(queued, ctx);
    combat.log.push({ text: t("combat.wastedAction", { actor: actor.name, skill: skill.name }), kind: "info" });
    return;
  }

  // Committed only now that the skill is confirmed to execute.
  if (queued.source.kind === "skill") {
    actor.mp -= skill.mpCost;
    if (skill.usesPerCombat !== undefined) {
      const used = actor.usesRemainingThisCombat[queued.source.skillId] ?? skill.usesPerCombat;
      actor.usesRemainingThisCombat[queued.source.skillId] = used - 1;
    }
    if (skill.cooldownTurns !== undefined) {
      actor.cooldownsRemaining[queued.source.skillId] = Math.max(0, skill.cooldownTurns - totalCooldownReduction(actor));
    }
  }

  const soloTarget = targets.length === 1 && targets[0] !== actor ? targets[0] : null;
  const announceKind: LogEntryKind = queued.source.kind === "item" ? "item" : "info";
  combat.log.push({
    text: soloTarget
      ? t("combat.useSkillOnTarget", { actor: actor.name, skill: skill.name, target: soloTarget.name })
      : t("combat.useSkillPlain", { actor: actor.name, skill: skill.name }),
    kind: announceKind,
  });
  if (queued.source.kind === "item" && getItem(queued.source.itemId).effects.length === 0) combat.log.push({ text: t("game.itemNoEffect"), kind: "item" });
  const spawnedSummon = applySkillEffects(skill, actor, targets, combat, ctx, combat.log);
  // A summon spawned mid-round isn't in this round's turnQueue, so it acts once right after the cast,
  // in its own session, then takes normal turns from next round.
  if (spawnedSummon && !getSummonArchetype(spawnedSummon.archetypeId).passive && !isCombatOver(combat, ctx)) {
    runInSession(
      combat,
      spawnedSummon.ownerId,
      () => {
        runSummonTurn({ kind: "summon", id: spawnedSummon.id }, combat, ctx);
        pruneDeadSummons(combat, ctx, combat.log);
      },
      { snapshot: sessionSnapshot(combat, ctx), bySummon: true }
    );
  }
}

type ExecutionTargets = Actor[] | "fizzle";

function resolveExecutionTargets(skill: SkillDefinition, queued: QueuedAction, combat: CombatState, ctx: EngineContext): ExecutionTargets {
  if (skill.target === "singleEnemy") {
    const original = queued.targets[0];
    if (original && isActorAlive(getActorByRef(original, ctx)) && !isUntargetable(getActorByRef(original, ctx))) return [getActorByRef(original, ctx)];
    const alive = livingTargetableMonsterRefs(combat, ctx);
    if (alive.length === 0) return "fizzle";
    return [getActorByRef(ctx.rng.pick(alive), ctx)];
  }
  if (skill.target === "singleAlly") {
    const original = queued.targets[0];
    if (original && isActorAlive(getActorByRef(original, ctx))) return [getActorByRef(original, ctx)];
    return "fizzle";
  }
  if (skill.target === "singleAllyOrEnemy") {
    const original = queued.targets[0];
    if (original && isActorAlive(getActorByRef(original, ctx)) && !(original.kind === "monster" && isUntargetable(getActorByRef(original, ctx)))) {
      return [getActorByRef(original, ctx)];
    }
    if (!original) return "fizzle";
    if (original.kind === "monster") {
      const alive = livingTargetableMonsterRefs(combat, ctx);
      if (alive.length === 0) return "fizzle";
      return [getActorByRef(ctx.rng.pick(alive), ctx)];
    }
    return "fizzle";
  }
  // Only a monster can be untargetable to the party; a stealthed ally is still a valid ally target.
  const alive = queued.targets.filter((t) => {
    const actor = getActorByRef(t, ctx);
    return isActorAlive(actor) && !(t.kind === "monster" && isUntargetable(actor));
  });
  if (alive.length === 0) return "fizzle";
  return alive.map((t) => getActorByRef(t, ctx));
}

function ultimateEffectivenessMultiplier(fear: number): number {
  return BALANCE.combat.ultimateMultiplierByFearTier[getFearTier(fear) - 1]!;
}

function scaleEffectForUltimate(effect: SkillEffect, source: Actor): SkillEffect {
  if (!isCharacter(source)) return effect;
  if (effect.kind !== "damage" && effect.kind !== "heal") return effect;
  const mult = ultimateEffectivenessMultiplier(source.survival.fear);
  if (mult === 1) return effect;
  return {
    ...effect,
    amount: effect.amount !== undefined ? Math.round(effect.amount * mult) : effect.amount,
    offenseMultiplierPercent: effect.offenseMultiplierPercent !== undefined ? Math.round(effect.offenseMultiplierPercent * mult) : effect.offenseMultiplierPercent,
  };
}

function applyOnHitAoeDamage(source: Character, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  for (const active of source.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (!def.onHitAoeDamage) continue;
    for (const ref of livingTargetableMonsterRefs(combat, ctx)) {
      const enemy = getActorByRef(ref, ctx);
      noteBasicAttack(combat, source, enemy);
      resolveSkillEffect(
        {
          kind: "damage",
          amount: def.onHitAoeDamage.amount,
          ignoreDefensePercent: def.onHitAoeDamage.ignoreDefensePercent,
          offenseMultiplierPercent: def.onHitAoeDamage.offenseMultiplierPercent,
          damageType: def.onHitAoeDamage.damageType,
        },
        source,
        enemy,
        { log, isMagic: def.onHitAoeDamage.isMagic, skillName: statusDisplayName(def).replace(/-/g, " "), rollDamage: () => ctx.rng.next() }
      );
    }
  }
}

function hasConditionalBonusStatus(skill: SkillDefinition, source: Actor): boolean {
  return (
    skill.conditionalBonus !== undefined &&
    isCharacter(source) &&
    source.activeStatusEffects.some((a) => statusSatisfiesRequirement(a.statusEffectId, skill.conditionalBonus!.requiresStatusId))
  );
}

function applyConditionalBonus(skill: SkillDefinition, effect: SkillEffect, hasBonus: boolean): SkillEffect {
  if (!hasBonus || effect.kind !== "damage") return effect;
  return { ...effect, ignoreDefensePercent: (effect.ignoreDefensePercent ?? 0) + skill.conditionalBonus!.ignoreDefensePercentBonus };
}

function consumeConditionalBonusStatus(skill: SkillDefinition, source: Actor, bonusLanded: boolean): void {
  if (!bonusLanded || !skill.conditionalBonus?.consumesStatus || !isCharacter(source)) return;
  const requiredId = skill.conditionalBonus.requiresStatusId;
  source.activeStatusEffects = source.activeStatusEffects.filter((a) => !statusSatisfiesRequirement(a.statusEffectId, requiredId));
}

/** Enemy-facing only. A success skips the roll it guards; a failure falls through to that roll. */
function rollsAlwaysHit(source: Actor, isEnemyFacing: boolean, ctx: EngineContext): boolean {
  if (!isEnemyFacing || !isCharacter(source)) return false;
  // `Rng.chance` draws even at p = 0; skipping it keeps seeded streams unchanged without alwaysHit.
  const chance = alwaysHitChance(source);
  return chance > 0 && ctx.rng.chance(chance / 100);
}

/** The only kind of application `debuffResist` reduces. */
function harmfulStatusOnCharacter(effect: SkillEffect, target: Actor, isEnemyFacing: boolean) {
  if (!isEnemyFacing || !isCharacter(target) || effect.kind !== "applyStatusEffect") return null;
  const ids = [effect.statusEffectId, ...(effect.alsoApplyStatusEffectIds ?? [])].filter((id): id is Id => id !== undefined);
  return ids.map((id) => getStatusEffect(id)).find((def) => !isHelpfulStatusEffect(def)) ?? null;
}

export function acolyteDebuffResistPercent(target: Character): number {
  if (target.classId !== "acolyte") return 0;
  return passiveRankDef(getClass("acolyte").passiveSkill, target.level)?.debuffResistPercent ?? 0;
}

/** Applies or removes the rank's threshold status from the live HP ratio; returns whether it is active. */
function syncVikingBloodFury(source: Actor, log: LogEntry[]): boolean {
  if (!isCharacter(source) || source.classId !== "viking") return false;
  const passive = getClass("viking").passiveSkill;
  const rankDef = passiveRankDef(passive, source.level);
  const belowThreshold = rankDef !== null && source.hp / source.maxHp < (rankDef.hpThresholdPercent ?? 0) / 100;
  const ownStatusIds = passive.ranks.flatMap((r) => (r.thresholdStatusEffectId ? [r.thresholdStatusEffectId] : []));
  const active = source.activeStatusEffects.find((s) => ownStatusIds.includes(s.statusEffectId));
  // Only on a transition: re-applying while active would log a spurious refresh every turn.
  if (belowThreshold && !active && rankDef?.thresholdStatusEffectId) {
    resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: rankDef.thresholdStatusEffectId, durationTurns: 99 }, source, source, { log });
  } else if (!belowThreshold && active) {
    resolveSkillEffect({ kind: "removeStatusEffect", statusEffectId: active.statusEffectId }, source, source, { log });
  }
  return belowThreshold;
}

/** Uses `spawnAdditionalSummon` because the normal summon path replaces a same-archetype summon. */
function ninjaSecondCloneProc(source: Character, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  if (source.classId !== "ninja") return;
  const passive = getClass("ninja").passiveSkill;
  const chance = (passiveRankDef(passive, source.level)?.secondCloneChancePercent ?? 0) / 100;
  if (chance === 0) return;
  if (!passive.cloneSummonCastId) return;
  const cast = getSummonCast(passive.cloneSummonCastId);
  const existingClones = ownedSummons(source.id, ctx).filter((s) => s.archetypeId === cast.archetypeId);
  if (existingClones.length >= (passive.maxClones ?? 0) || existingClones.length === 0) return;
  // At most 1 passive clone at a time, beside the 1 the skill casts.
  if (existingClones.some((s) => s.fromPassive)) return;
  if (!ctx.rng.chance(chance)) return;
  spawnAdditionalSummon({ kind: "summon", summonCastId: cast.id }, source, combat, ctx, log, {
    name: passive.secondCloneName,
    fromPassive: true,
    logKey: "combat.passiveCloneSpawned",
  });
}

function findBreakBonusStatus(source: Actor) {
  return source.activeStatusEffects.find((s) => getStatusEffect(s.statusEffectId).breakBonus);
}

interface OneHitOptions {
  linkedSummonId?: Id;
  unapplied?: boolean;
  executeHpFraction?: number;
}

function resolveOneDamageEffect(
  effect: SkillEffect,
  skill: SkillDefinition,
  source: Actor,
  target: Actor,
  ctx: EngineContext,
  log: LogEntry[],
  stealthBreak: { guaranteedCrit: boolean; damageBonusPercent: number },
  options: OneHitOptions = {}
): number {
  // An item's effects never crit; the Archer's passive lifts damage only, not a heal.
  const archerRank = effect.kind === "damage" && isCharacter(source) && source.classId === "archer" ? passiveRankDef(getClass("archer").passiveSkill, source.level) : null;
  const archerBonus = {
    critChancePercent: archerRank?.critChancePercent ?? 0,
    critMultiplierPercent: archerRank?.critMultiplierPercent ?? BALANCE.combat.defaultCritMultiplierPercent,
  };
  const baseCritChance = (effect.kind === "damage" || effect.kind === "heal") && !skill.fromItem ? BALANCE.combat.baseCritChancePercent / 100 : 0;
  const totalCritChance = skill.fromItem ? 0 : (effect.critChance ?? 0) + archerBonus.critChancePercent / 100 + baseCritChance;
  const isCrit = stealthBreak.guaranteedCrit || (totalCritChance > 0 && ctx.rng.chance(totalCritChance));
  const effectiveCritMultiplierPercent = Math.max(effect.critMultiplierPercent ?? BALANCE.combat.defaultCritMultiplierPercent, archerBonus.critMultiplierPercent);
  const castByOwnClassSkill = isCharacter(source) && getClass(source.classId).skills.some((s) => s.id === skill.id);
  return resolveSkillEffect(
    { ...effect, critMultiplierPercent: effectiveCritMultiplierPercent },
    source,
    target,
    {
      log,
      isMagic: skill.isMagic,
      skillName: skill.name,
      isCrit,
      executeBonus: skill.executeBonus,
      bonusDamagePercent: stealthBreak.damageBonusPercent || undefined,
      castByOwnClassSkill,
      linkedSummonId: options.linkedSummonId,
      rollDamage: () => ctx.rng.next(),
      ...(options.unapplied ? { unapplied: true as const, executeHpFraction: options.executeHpFraction } : {}),
    }
  );
}

// Dead summons stay in `ctx.summons` (and in saves), so ids count past every existing one, dead
// included: a reused id would make getActorByRef resolve to the stale dead entry.
function nextSummonId(ownerId: Id, archetypeId: Id, ctx: EngineContext): Id {
  const prefix = `${ownerId}-${archetypeId}-`;
  let highest = 0;
  for (const s of ctx.summons) {
    if (!s.id.startsWith(prefix)) continue;
    const n = Number(s.id.slice(prefix.length));
    if (Number.isInteger(n) && n > highest) highest = n;
  }
  return `${prefix}${highest + 1}`;
}

function maxActiveMinionsFor(owner: Character): number {
  if (owner.classId !== "summoner") return 1;
  return passiveRankDef(getClass("summoner").passiveSkill, owner.level)?.maxActiveMinions ?? 1;
}

function ownedSummons(ownerId: Id, ctx: EngineContext): Summon[] {
  return ctx.summons.filter((s) => s.ownerId === ownerId && s.hp > 0);
}

/** Called wherever a summon leaves combat: death, out of actions, eviction or replacement. */
function expireLinkedAllyBuffs(summon: Summon, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  for (const character of ctx.party) {
    for (const active of [...character.activeStatusEffects]) {
      if (active.linkedSummonId !== summon.id) continue;
      expireStatusEffect(character, active, { log });
      noteAffected(combat, character);
    }
  }
}

function recordDeparture(summon: Summon, combat: CombatState): void {
  (combat.departedSummons ??= []).push({ id: summon.id, hp: summon.hp, maxHp: summon.maxHp });
}

function dismissSummon(summon: Summon, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  log.push({ text: t("combat.summonDismissed", { summon: summon.name }), kind: "info" });
  recordDeparture(summon, combat);
  summon.hp = 0;
  combat.combatants = combat.combatants.filter((c) => !(c.ref.kind === "summon" && c.ref.id === summon.id));
  expireLinkedAllyBuffs(summon, combat, ctx, log);
}

function empowermentBonusFor(owner: Character): { maxHpPercent: number; attackPercent: number } {
  if (owner.classId !== "summoner") return { maxHpPercent: 0, attackPercent: 0 };
  const rankDef = passiveRankDef(getClass("summoner").passiveSkill, owner.level);
  return { maxHpPercent: rankDef?.minionMaxHpPercent ?? 0, attackPercent: rankDef?.minionAttackPercent ?? 0 };
}

function resolveRankValue(value: number | [number, number, number], rank: number): number {
  return Array.isArray(value) ? value[Math.min(2, Math.max(0, rank - 1))]! : value;
}

function resolveStatPercent(formula: SummonStatFormula, rank: number): number {
  return resolveRankValue(formula.percent, rank);
}

/** Without the owner's status deltas, so a short buff or debuff isn't frozen into a longer-lived minion. */
function ownerSourceStat(owner: Character, stat: SummonSourceStat): number {
  return owner[stat] - activeStatusCombatStatSum(owner, stat);
}

function computeSummonStat(formula: SummonStatFormula, owner: Character, rank: number, bonusPercent: number): number {
  return formula.base + (resolveStatPercent(formula, rank) / 100) * ownerSourceStat(owner, formula.sourceStat) * (1 + bonusPercent / 100);
}

interface SummonSpawnOptions {
  name?: string;
  fromPassive?: boolean;
  logKey?: string;
}

/** No eviction or cap check; callers handle those. */
function addSummon(effect: SkillEffect, owner: Character, combat: CombatState, ctx: EngineContext, log: LogEntry[], opts: SummonSpawnOptions = {}): Summon | undefined {
  if (!effect.summonCastId) return undefined;
  const cast = getSummonCast(effect.summonCastId);
  const archetype = getSummonArchetype(cast.archetypeId);
  // A cast is shared by all ranks of its skill, so the rank comes from the caster's level.
  const rank = effectiveSkillRank(getSkill(cast.skillId), owner.level) || 1;
  const { stat } = cast;
  const { maxHpPercent, attackPercent } = empowermentBonusFor(owner);
  const maxHp = Math.max(1, Math.round(computeSummonStat(stat.maxHp, owner, rank, maxHpPercent)));
  const { onDeath } = cast;
  const deathBurst = onDeath
    ? {
        amount: resolveRankValue(onDeath.amount, rank),
        offenseMultiplierPercent: resolveRankValue(onDeath.offenseMultiplierPercent, rank),
        offensiveStatOverride: ownerSourceStat(owner, onDeath.sourceStat),
        statusEffectId: onDeath.statusEffectId,
        statusEffectChance: resolveRankValue(onDeath.statusEffectChance, rank),
        durationTurns: onDeath.durationTurns,
      }
    : undefined;
  const summon: Summon = {
    id: nextSummonId(owner.id, archetype.id, ctx),
    ownerId: owner.id,
    archetypeId: archetype.id,
    name: opts.name ?? archetype.name,
    hp: maxHp,
    maxHp,
    attack: Math.round(computeSummonStat(stat.attack, owner, rank, attackPercent)),
    defense: Math.round(computeSummonStat(stat.defense, owner, rank, 0)),
    magicPower: Math.round(computeSummonStat(stat.magicPower, owner, rank, 0)),
    aggro: cast.aggro,
    speed: archetype.speed,
    activeStatusEffects: [],
    actionsTaken: 0,
    maxActions: cast.maxActions,
    deathBurst,
    ...(opts.fromPassive ? { fromPassive: true } : {}),
  };
  ctx.summons.push(summon);
  combat.combatants.push({ ref: { kind: "summon", id: summon.id }, speed: summon.speed });
  log.push({ text: t(opts.logKey ?? "combat.summonSpawned", { owner: owner.name, summon: summon.name }), kind: "info" });
  return summon;
}

function spawnSummon(effect: SkillEffect, owner: Character, combat: CombatState, ctx: EngineContext, log: LogEntry[]): Summon | undefined {
  if (!effect.summonCastId) return undefined;
  const cast = getSummonCast(effect.summonCastId);
  const archetype = getSummonArchetype(cast.archetypeId);
  // A passive's clone sits outside both rules: a recast never replaces it and it never fills the cap.
  const owned = ownedSummons(owner.id, ctx).filter((s) => !s.fromPassive);
  const sameType = owned.find((s) => s.archetypeId === archetype.id);
  if (sameType) {
    dismissSummon(sameType, combat, ctx, log);
  } else if (owned.length >= maxActiveMinionsFor(owner)) {
    const oldest = owned[0];
    if (oldest) dismissSummon(oldest, combat, ctx, log);
  }
  return addSummon(effect, owner, combat, ctx, log);
}

/** Bypasses spawnSummon's same-archetype replacement; the caller does its own cap check. */
export function spawnAdditionalSummon(effect: SkillEffect, owner: Character, combat: CombatState, ctx: EngineContext, log: LogEntry[], opts: SummonSpawnOptions = {}): Summon | undefined {
  return addSummon(effect, owner, combat, ctx, log, opts);
}

function pickSummonAction(archetype: ReturnType<typeof getSummonArchetype>, rng: Rng): Id | null {
  const weights = archetype.actionWeights;
  if (!weights) return null;
  const candidates: [Id | null, number][] = [];
  for (const [key, weight] of Object.entries(weights)) {
    if (!weight || weight <= 0) continue;
    candidates.push([key === "basicAttack" ? null : key, weight]);
  }
  if (candidates.length === 0) return null;
  return rng.weightedPick(candidates, ([, weight]) => weight)[0];
}

/** Fires once, right before the summon leaves, off the owner's stat frozen at spawn. */
function triggerSummonDeathBurst(summon: Summon, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  const burst = summon.deathBurst;
  if (!burst) return;
  const targets = livingTargetableMonsterRefs(combat, ctx).map((r) => getActorByRef(r, ctx) as Monster);
  if (targets.length === 0) return;
  // The owner's action, not part of whichever turn killed the summon.
  runInSession(
    combat,
    summon.ownerId,
    () => {
      log.push({ text: t("combat.summonDeathBurst", { summon: summon.name }), kind: "attack" });
      for (const target of targets) {
        noteBasicAttack(combat, summon, target);
        resolveSkillEffect(
          { kind: "damage", amount: burst.amount, offenseMultiplierPercent: burst.offenseMultiplierPercent },
          summon,
          target,
          { log, offensiveStatOverride: burst.offensiveStatOverride, rollDamage: () => ctx.rng.next() }
        );
        if (burst.statusEffectId && ctx.rng.chance(burst.statusEffectChance)) {
          resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: burst.statusEffectId, durationTurns: burst.durationTurns }, summon, target, { log });
        }
      }
    },
    { snapshot: sessionSnapshot(combat, ctx), bySummon: true }
  );
}

/** Idempotent: a finished summon leaves `combat.combatants`, so later sweeps skip it. A dismiss never bursts. */
function expireSummonIfDone(summon: Summon, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  if (summon.actionsTaken < summon.maxActions && summon.hp > 0) return;
  noteAffected(combat, summon);
  // A deathBurst's own line announces the departure.
  if (!summon.deathBurst) log.push({ text: t("combat.summonExpired", { summon: summon.name }), kind: "info" });
  triggerSummonDeathBurst(summon, combat, ctx, log);
  combat.combatants = combat.combatants.filter((c) => !(c.ref.kind === "summon" && c.ref.id === summon.id));
  // Without hp 0, ownedSummons keeps counting an action-expired summon toward the minion cap.
  recordDeparture(summon, combat);
  summon.hp = 0;
  expireLinkedAllyBuffs(summon, combat, ctx, log);
}

/** Zeroes every summon still alive, or it would linger in `ctx.summons` and count in `ownedSummons`. No deathBurst. */
export function dismissSummonsAtCombatEnd(ctx: EngineContext): void {
  for (const summon of ctx.summons) {
    if (summon.hp > 0) summon.hp = 0;
  }
}

function pruneDeadSummons(combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  for (const c of combat.combatants) {
    if (c.ref.kind !== "summon") continue;
    const summon = ctx.summons.find((s) => s.id === c.ref.id);
    if (summon) expireSummonIfDone(summon, combat, ctx, log);
  }
  dismissOrphanedMonsterSummons(combat, ctx, log);
}

/**
 * Spawns up to `effect.count` of the named normal archetype next to the summoner, scaled to the
 * current floor depth, stopping at the cap on adds it already has alive. The add takes its first
 * turn next round (this round's turn queue was built before it existed). Its id is derived from
 * the summoner's: `spawnMonster`'s counter restarts after a save is loaded, so a counter id could
 * collide with a monster the floor already holds.
 */
function spawnMonsterSummons(effect: SkillEffect, summoner: Monster, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  const alive = livingMonsterRefs(combat, ctx).filter((r) => (getActorByRef(r, ctx) as Monster).summonerId === summoner.id);
  const count = Math.min(effect.count ?? 1, BALANCE.combat.maxSummonedMonsters - alive.length);
  for (let i = 0; i < count; i++) {
    const add = spawnMonster(effect.monsterArchetypeId!, ctx.floorDepth ?? 1);
    add.id = `${add.archetypeId}-${summoner.id}-${ctx.monsters.filter((m) => m.summonerId === summoner.id).length + 1}`;
    add.summonerId = summoner.id;
    add.expReward = 0;
    ctx.monsters.push(add);
    combat.combatants.push({ ref: { kind: "monster", id: add.id }, speed: add.speed });
    log.push({ text: t("combat.monsterSummoned", { actor: summoner.name, summon: add.name }), kind: "info" });
  }
}

/** A summoned monster does not outlive the monster that called it, so killing the summoner always ends the fight. */
export function dismissOrphanedMonsterSummons(combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  for (const ref of livingMonsterRefs(combat, ctx)) {
    const add = getActorByRef(ref, ctx) as Monster;
    if (add.summonerId === undefined) continue;
    const summoner = ctx.monsters.find((m) => m.id === add.summonerId);
    if (summoner && isActorAlive(summoner)) continue;
    add.hp = 0;
    log.push({ text: t("combat.summonedMonsterFalls", { summon: add.name, actor: summoner?.name ?? "" }), kind: "death" });
  }
}

function pickLowestHpCharacter(combat: CombatState, ctx: EngineContext): CombatantRef | null {
  const characters = livingCharacterRefs(combat, ctx);
  let best: CombatantRef | null = null;
  let bestRatio = Infinity;
  for (const ref of characters) {
    const a = getActorByRef(ref, ctx);
    const ratio = a.maxHp > 0 ? a.hp / a.maxHp : 0;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = ref;
    }
  }
  return best;
}

function isHealSkill(skill: SkillDefinition): boolean {
  return (skill.effects ?? []).some((e) => e.kind === "heal");
}

function resolveSummonSkillTargets(skill: SkillDefinition, ref: CombatantRef, combat: CombatState, ctx: EngineContext): CombatantRef[] {
  const auto = autoResolveTargets(skill.target, ref, combat, ctx);
  if (auto) {
    return isHealSkill(skill) ? auto.filter((r) => r.kind === "character") : auto;
  }
  if (skill.target === "singleEnemy") {
    const enemies = livingTargetableMonsterRefs(combat, ctx);
    return enemies.length > 0 ? [ctx.rng.pick(enemies)] : [];
  }
  if (skill.target === "singleAlly") {
    const ally = pickLowestHpCharacter(combat, ctx);
    return ally ? [ally] : [];
  }
  return [];
}

function runSummonTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const summon = getActorByRef(ref, ctx) as Summon;
  if (hasStunningStatus(summon)) {
    combat.log.push({ text: t("combat.stunnedSkipTurn", { actor: summon.name }), kind: "info" });
    noteLostTurn(combat, summon);
    return;
  }
  const archetype = getSummonArchetype(summon.archetypeId);
  if (archetype.passive) return;
  const skillId = pickSummonAction(archetype, ctx.rng);
  if (skillId !== null) {
    const skill = getSummonSkill(skillId);
    const targets = resolveSummonSkillTargets(skill, ref, combat, ctx).map((r) => getActorByRef(r, ctx));
    if (targets.length === 0) return;
    combat.log.push({ text: t("combat.monsterSkillOnTarget", { actor: summon.name, skill: skill.name, target: targets[0]!.name }), kind: "attack" });
    applySkillEffects(skill, summon, targets, combat, ctx, combat.log);
  } else {
    const enemies = livingTargetableMonsterRefs(combat, ctx);
    if (enemies.length === 0) return;
    const target = getActorByRef(ctx.rng.pick(enemies), ctx) as Monster;
    noteBasicAttack(combat, summon, target);
    if (!rollHits(summon, () => ctx.rng.next())) {
      noteMiss(combat, target);
      combat.log.push({ text: t("combat.missedFear", { source: summon.name, target: target.name }), kind: "info" });
    } else {
      combat.log.push({ text: t("combat.basicAttack", { actor: summon.name, target: target.name }), kind: "attack" });
      resolveSkillEffect({ kind: "damage", amount: 0 }, summon, target, { log: combat.log, rollDamage: () => ctx.rng.next() });
      const onHit = archetype.basicAttackOnHit;
      if (onHit && isActorAlive(target) && ctx.rng.chance(onHit.chance)) {
        resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: onHit.statusEffectId, durationTurns: onHit.durationTurns }, summon, target, { log: combat.log });
      }
    }
  }
  summon.actionsTaken += 1;
  expireSummonIfDone(summon, combat, ctx, combat.log);
}

export function applyMonsterHitFear(source: Actor, target: Actor, combat: CombatState, ctx: EngineContext): void {
  if (isCharacter(target) && isMonster(source) && applyHitFear(target, ctx.floorDepth ?? 1) !== 0) noteFearChange(combat, target);
}

export function applySkillEffects(skill: SkillDefinition, source: Actor, targets: Actor[], combat: CombatState, ctx: EngineContext, log: LogEntry[]): Summon | undefined {
  const hasBonus = hasConditionalBonusStatus(skill, source);
  let landedDamageHit = false;
  let bonusEffectLanded = false;

  const breakStatus = findBreakBonusStatus(source);
  const breakDef = breakStatus ? getStatusEffect(breakStatus.statusEffectId) : undefined;
  const vikingBuffActive = !skill.isBuff && syncVikingBloodFury(source, log);
  const stealthBreak = {
    guaranteedCrit: skill.slot === 0 && !skill.fromItem ? (breakDef?.breakBonus?.basicAttackGuaranteedCrit ?? false) : false,
    damageBonusPercent: skill.slot !== 0 ? (breakDef?.breakBonus?.skillDamageBonusPercent ?? 0) : 0,
  };
  let brokeStealthThisCast = false;

  // An effect with its own `target`, and every `summon` effect (it lands on the caster), resolves here
  // against its own population, before the per-target loop below, which skips it.
  const isOverrideEffect = (e: SkillEffect) => e.kind === "summon" || e.kind === "summonMonster" || (e.target !== undefined && e.target !== skill.target);
  const overrideEffects = (skill.effects ?? []).filter(isOverrideEffect);
  // Damage reaching the opposing side marks every opposing target as attacked, whatever its own effects.
  // `appliesToRelation` names a board side ("ally" = the player's side), not one relative to the caster.
  const skillDealsDamage = (skill.effects ?? []).some((e) => e.kind === "damage" && (!e.appliesToRelation || (e.appliesToRelation === "ally") !== isPlayerSide(source)));
  // Set by this cast's summon effect (resolved first, in array order) for a later `linksToCasterSummon` effect.
  let spawnedSummonId: Id | undefined;
  let spawnedSummon: Summon | undefined;
  if (overrideEffects.length > 0) {
    const sourceRef: CombatantRef = isCharacter(source)
      ? { kind: "character", id: source.id }
      : isSummon(source)
        ? { kind: "summon", id: source.id }
        : { kind: "monster", id: source.id };
    for (const effect of overrideEffects) {
      if (effect.kind === "summonMonster") {
        if (isMonster(source)) spawnMonsterSummons(effect, source, combat, ctx, log);
        continue;
      }
      const overrideTarget = effect.kind === "summon" ? (effect.target ?? "self") : effect.target!;
      const overrideTargets = (autoResolveTargets(overrideTarget, sourceRef, combat, ctx) ?? []).map((r) => getActorByRef(r, ctx));
      for (const resolved of overrideTargets) {
        if (effect.kind === "summon") {
          if (isCharacter(source)) {
            spawnedSummon = spawnSummon(effect, source, combat, ctx, log);
            spawnedSummonId = spawnedSummon?.id;
          }
          continue;
        }
        if (effect.excludesSummonTargets && isSummon(resolved)) continue;
        noteSkillTarget(combat, source, resolved, [effect], skillDealsDamage);
        const overrideEnemyFacing = isPlayerSide(source) !== isPlayerSide(resolved);
        if (overrideEnemyFacing && !skill.isUltimate && !rollsAlwaysHit(source, overrideEnemyFacing, ctx) && !rollHits(source, () => ctx.rng.next())) {
          noteMiss(combat, resolved);
          continue;
        }
        if (effect.chance !== undefined && !ctx.rng.chance(effect.chance)) continue;
        resolveOneDamageEffect(
          effect,
          skill,
          source,
          resolved,
          ctx,
          log,
          { guaranteedCrit: false, damageBonusPercent: 0 },
          { linkedSummonId: effect.linksToCasterSummon ? spawnedSummonId : undefined }
        );
      }
    }
  }

  for (const target of targets) {
    const isEnemyFacing = isPlayerSide(source) !== isPlayerSide(target);
    // Before the accuracy roll: a missed or dodged target is still the one the action was aimed at.
    noteSkillTarget(
      combat,
      source,
      target,
      (skill.effects ?? []).filter((e) => !isOverrideEffect(e) && (!e.appliesToRelation || (e.appliesToRelation === "ally") === isPlayerSide(target))),
      skillDealsDamage
    );
    if (isEnemyFacing && !skill.isUltimate && !rollsAlwaysHit(source, isEnemyFacing, ctx) && !rollHits(source, () => ctx.rng.next())) {
      noteMiss(combat, target);
      log.push({ text: t("combat.missedFear", { source: sourceName(source), target: target.name }), kind: "info" });
      continue;
    }
    const activeEffects = (skill.effects ?? []).filter((e) => !isOverrideEffect(e));
    if (isEnemyFacing && isCharacter(target) && activeEffects.some((e) => e.kind === "damage") && rollDodge(target, ctx.rng)) {
      noteMiss(combat, target);
      log.push({ text: t("combat.dodge", { target: target.name, actor: sourceName(source) }), kind: "info" });
      continue;
    }

    // A target that threw off a status and took nothing else from the action counts as missed.
    let resisted = false;
    let landed = false;
    for (const effect of activeEffects) {
      if (effect.appliesToRelation) {
        const targetIsAlly = isPlayerSide(target);
        if ((effect.appliesToRelation === "ally") !== targetIsAlly) continue;
      }
      if (!isActorAlive(target) && effect.kind !== "applyStatusEffect") continue;
      const harmfulStatus = harmfulStatusOnCharacter(effect, target, isEnemyFacing);
      // `debuffResist` scales the effect's land chance down (an absent `chance` counts as 1). One draw serves both
      // the roll and the "threw it off" log, and none is spent at 0% so seeded streams stay put.
      const resistPercent =
        harmfulStatus && isCharacter(target) ? combinePercents(debuffResistPercent(target), acolyteDebuffResistPercent(target)) : 0;
      if (resistPercent > 0) {
        const baseChance = effect.chance ?? 1;
        const roll = ctx.rng.next();
        if (roll >= baseChance * (1 - resistPercent / 100)) {
          if (roll < baseChance) {
            log.push({ text: t("combat.debuffResisted", { target: target.name, status: statusDisplayName(harmfulStatus!) }), kind: "info" });
            resisted = true;
          }
          continue;
        }
      } else if (effect.chance !== undefined && !rollsAlwaysHit(source, isEnemyFacing, ctx) && !ctx.rng.chance(effect.chance)) continue;
      landed = true;
      const finalEffect = applyConditionalBonus(skill, skill.isUltimate ? scaleEffectForUltimate(effect, source) : effect, hasBonus);

      const hitCount = finalEffect.kind === "damage" && finalEffect.hitCountRange ? ctx.rng.int(finalEffect.hitCountRange.min, finalEffect.hitCountRange.max) : 1;
      const wasAliveBefore = isActorAlive(target);
      const sourceHpBefore = source.hp;
      const fearBefore = isCharacter(target) ? target.survival.fear : 0;
      // Summed over every hit, so onDamageDealt hooks see the cast's full damage, not its last swing.
      let appliedAmount = 0;
      // Hits after the target falls are shown, not dealt, and test execute against the HP share before the felling hit.
      let hpFraction = target.hp / target.maxHp;
      const swing = (): number => {
        const fallen = !isActorAlive(target);
        if (!fallen) hpFraction = target.hp / target.maxHp;
        return resolveOneDamageEffect(finalEffect, skill, source, target, ctx, log, stealthBreak, { unapplied: fallen, executeHpFraction: hpFraction });
      };
      for (let hit = 0; hit < hitCount; hit++) {
        appliedAmount += swing();
        if (finalEffect.kind === "damage") {
          brokeStealthThisCast = true;
          if (finalEffect.extraHitChance && ctx.rng.chance(finalEffect.extraHitChance)) appliedAmount += swing();
        }
      }
      if (finalEffect.kind === "modifyStat" && isCharacter(target) && target.survival.fear !== fearBefore) noteFearChange(combat, target);
      if (effect.kind === "damage") {
        for (const hook of combatHooks) hook.onHit?.(source, target, log);
        if (isCharacter(source)) {
          landedDamageHit = true;
          if (hasBonus) bonusEffectLanded = true;
        }
      }
      if (finalEffect.kind === "damage" && appliedAmount > 0) {
        for (const hook of combatHooks) hook.onDamageDealt?.(source, target, appliedAmount, ctx, log);
        applyMonsterHitFear(source, target, combat, ctx);
        // HP the source regained across these hits is lifesteal; a heal-on-kill (below) is not.
        if (source !== target && source.hp > sourceHpBefore) noteLifesteal(combat, source);
        if (wasAliveBefore && !isActorAlive(target)) {
          for (const hook of combatHooks) hook.onKill?.(source, target, log);
        }
      }
    }
    if (resisted && !landed) noteResisted(combat, target);
  }
  if (breakStatus && brokeStealthThisCast) expireStatusEffect(source, breakStatus, { log });
  if (landedDamageHit && isCharacter(source)) applyOnHitAoeDamage(source, combat, ctx, log);
  if (landedDamageHit && isCharacter(source) && vikingBuffActive) {
    const selfDamage = Math.round(source.maxHp * ((getClass("viking").passiveSkill.selfDamagePerHitMaxHPPercent ?? 0) / 100));
    source.hp = Math.max(1, source.hp - selfDamage);
  }
  if (landedDamageHit && isCharacter(source)) ninjaSecondCloneProc(source, combat, ctx, log);
  consumeConditionalBonusStatus(skill, source, bonusEffectLanded);
  return spawnedSummon;
}

function sourceName(source: Actor): string {
  return source.name;
}

export function isCombatOver(combat: CombatState, ctx: EngineContext): boolean {
  return livingCharacterRefs(combat, ctx).length === 0 || livingMonsterRefs(combat, ctx).length === 0;
}

function finalizeRound(combat: CombatState, ctx: EngineContext): void {
  if (livingCharacterRefs(combat, ctx).length === 0) {
    combat.phase = "over";
    combat.outcome = "defeat";
    combat.log.push({ text: t("combat.partyWiped"), kind: "death" });
    return;
  }
  if (livingMonsterRefs(combat, ctx).length === 0) {
    combat.phase = "over";
    combat.outcome = "victory";
    const hasEliteOrBoss = combat.combatants.some((c) => c.ref.kind === "monster" && (getActorByRef(c.ref, ctx) as Monster).tier !== "normal");
    runFearSession(combat, ctx, () => applyVictoryFearRelief(ctx.party, hasEliteOrBoss, combat.roundNumber));
    combat.log.push({ text: t("combat.roomCleared"), kind: "info" });
    return;
  }
  combat.roundNumber += 1;
  combat.queuedActions = [];
  combat.phase = "command";
}
