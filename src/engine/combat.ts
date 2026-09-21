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
  ActionSource,
  Id,
  LogEntry,
  LogEntryKind,
  CombatantSnapshot,
  PartyStateSnapshot,
} from "../types";
import { getSkill, getEffectiveSkill, effectiveSkillRank } from "../data/classes";
import { characterBaseStats } from "./party";
import { getItem } from "../data/items";
import { getStatusEffect, statusSatisfiesRequirement, statusDisplayName } from "../data/statusEffects";
import { getSummonArchetype, getSummonSkill, getSummonCast } from "../data/summons";
import { rollDodge, autoDamageEntries, totalCooldownReduction, alwaysHitChance, debuffResistPercent } from "./artifacts";
import { Rng } from "./rng";
import { t } from "../data/strings";
import { applyRoundFear, applyVictoryFearRelief, isPartyDying, applyDyingDamage } from "./survival";
import { combatHooks } from "./combatHooks";
import { runMonsterTurn } from "./monsterAI";
import {
  type Actor,
  isCharacter,
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
}

function actionDefinition(source: ActionSource, actor?: Actor): SkillDefinition {
  if (source.kind === "skill") {
    const skill = getSkill(source.skillId);
    return actor && isCharacter(actor) ? getEffectiveSkill(skill, actor.level) : skill;
  }
  const item = getItem(source.itemId);
  return { id: item.id, name: item.name, description: item.description, mpCost: 0, target: item.target, effects: item.effects, slot: 0, unlockLevel: 0 };
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

/** Every living combatant on the player's side — real characters plus any active summons (Ninja's clone, Summoner's minions). */
export function livingPlayerSideRefs(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  return [...livingCharacterRefs(combat, ctx), ...livingSummonRefs(combat, ctx)];
}

export function livingMonsterRefs(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  return combat.combatants
    .filter((c) => c.ref.kind === "monster")
    .map((c) => c.ref)
    .filter((ref) => isActorAlive(getActorByRef(ref, ctx)));
}

/**
 * `livingPlayerSideRefs`, minus anyone currently `untargetable` (a stealthed Ninja) — the pool a
 * MONSTER's target-picking draws from. Allies still see (and can target) a stealthed teammate
 * normally; only enemy-facing targeting excludes them, so use `livingPlayerSideRefs` for the
 * player's own ally-targeting.
 */
export function livingPlayerSideEnemyFacingRefs(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  return livingPlayerSideRefs(combat, ctx).filter((ref) => {
    const a = getActorByRef(ref, ctx);
    return !a.activeStatusEffects.some((s) => getStatusEffect(s.statusEffectId).untargetable);
  });
}

export function autoResolveTargets(target: SkillTarget, actor: CombatantRef, combat: CombatState, ctx: EngineContext): CombatantRef[] | null {
  const actorIsPlayerSide = actor.kind !== "monster";
  switch (target) {
    case "self":
      return [actor];
    case "allAllies":
      return actorIsPlayerSide ? livingPlayerSideRefs(combat, ctx) : livingMonsterRefs(combat, ctx);
    case "allEnemies":
      return actorIsPlayerSide ? livingMonsterRefs(combat, ctx) : livingPlayerSideEnemyFacingRefs(combat, ctx);
    case "allAlliesAndEnemies": {
      const allies = actorIsPlayerSide ? livingPlayerSideRefs(combat, ctx) : livingMonsterRefs(combat, ctx);
      const enemies = actorIsPlayerSide ? livingMonsterRefs(combat, ctx) : livingPlayerSideEnemyFacingRefs(combat, ctx);
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

  // mp/usesPerCombat/cooldown are committed when the skill actually executes in turn order
  // (runCharacterTurn), not here — otherwise a character's resources would look spent before
  // their turn has even come up during the round's reveal.
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

function turnOrderSortKey(c: Combatant, combat: CombatState): number {
  if (c.ref.kind !== "character") return c.speed;
  const queued = combat.queuedActions.find((qa) => refEquals(qa.actor, c.ref));
  if (queued && actionDefinition(queued.source).isBuff) return c.speed + 20;
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
  return combat.combatants.map((c) => {
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
      activeStatusEffects: actor.activeStatusEffects.map((s) => ({ ...s })),
    };
  });
}

export function tagLogRange(combat: CombatState, fromIndex: number, snapshot: CombatantSnapshot[]): void {
  for (let i = fromIndex; i < combat.log.length; i++) {
    const entry = combat.log[i];
    if (entry) entry.snapshot = snapshot;
  }
}

/** Same idea as tagLogRange, for the party-wide (coins/EXP/satiety) snapshot instead of the per-combatant one. */
export function tagPartySnapshotRange(combat: CombatState, fromIndex: number, partySnapshot: PartyStateSnapshot): void {
  for (let i = fromIndex; i < combat.log.length; i++) {
    const entry = combat.log[i];
    if (entry) entry.partySnapshot = partySnapshot;
  }
}

function runArtifactAutoDamage(combat: CombatState, ctx: EngineContext): void {
  for (const character of ctx.party) {
    if (!character.isAlive) continue;
    for (const { effect, sourceName } of autoDamageEntries(character)) {
      const alive = livingMonsterRefs(combat, ctx);
      if (alive.length === 0) return;
      const target = getActorByRef(ctx.rng.pick(alive), ctx) as Monster;
      if (effect.offenseMultiplierPercent !== undefined) {
        const base = characterBaseStats(character);
        resolveSkillEffect(
          { kind: "damage", amount: effect.amount, offenseMultiplierPercent: effect.offenseMultiplierPercent },
          character,
          target,
          { log: combat.log, isMagic: effect.isMagic, skillName: sourceName, offensiveStatOverride: effect.isMagic ? base.magicPower : base.attack }
        );
        continue;
      }
      target.hp = Math.max(0, target.hp - effect.amount);
      combat.log.push({ text: t("combat.artifactAutoDamage", { character: character.name, amount: effect.amount, target: target.name }), kind: "attack" });
    }
  }
}

/**
 * Overwatch (Archer): the first living character carrying a `triggersOverwatch` status reactively
 * attacks `monsterRef` right before that monster's own turn would resolve. Consumed either way (hit
 * or miss); a hit returns true so the caller skips `runMonsterTurn` for this ref entirely — the
 * monster's turn for this round is discarded, not just delayed.
 */
function tryTriggerOverwatch(monsterRef: CombatantRef, combat: CombatState, ctx: EngineContext): boolean {
  const watcher = ctx.party.find((c) => c.isAlive && c.activeStatusEffects.some((s) => getStatusEffect(s.statusEffectId).triggersOverwatch));
  if (!watcher) return false;
  const active = watcher.activeStatusEffects.find((s) => getStatusEffect(s.statusEffectId).triggersOverwatch)!;

  const target = getActorByRef(monsterRef, ctx) as Monster;
  if (!isActorAlive(target)) {
    expireStatusEffect(watcher, active, { log: combat.log });
    return false;
  }
  if (!rollHits(watcher, () => ctx.rng.next())) {
    expireStatusEffect(watcher, active, { log: combat.log });
    combat.log.push({ text: t("combat.overwatchMiss", { actor: watcher.name, target: target.name }), kind: "info" });
    return false;
  }
  // Expired only after the shot resolves, not before — `overwatched`'s rank-scaled attack bonus
  // (§1.12.2/data/status-effects.json) is the interrupt's only source of rank progression, so it
  // needs to still be active while this damage is computed.
  combat.log.push({ text: t("combat.overwatchHit", { actor: watcher.name, target: target.name }), kind: "attack" });
  resolveSkillEffect({ kind: "damage", amount: 0 }, watcher, target, { log: combat.log });
  expireStatusEffect(watcher, active, { log: combat.log });
  return true;
}

export function resolveRound(combat: CombatState, ctx: EngineContext, floorDepth = 1, satiety = 100): void {
  combat.phase = "resolution";
  combat.turnQueue = buildTurnQueue(combat, ctx);
  combat.activeTurnIndex = 0;
  combat.roundStartSnapshot = snapshotCombatants(combat, ctx);

  let blockStart = combat.log.length;
  for (const c of combat.combatants) {
    const actor = getActorByRef(c.ref, ctx);
    if (isActorAlive(actor)) tickDotEffects(actor, { log: combat.log });
  }
  pruneDeadSummons(combat, ctx, combat.log);
  tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));

  blockStart = combat.log.length;
  runArtifactAutoDamage(combat, ctx);
  tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));

  const actedRefs: CombatantRef[] = [];
  for (const ref of combat.turnQueue) {
    const actor = getActorByRef(ref, ctx);
    if (!isActorAlive(actor)) continue;

    const eligibleSpecial = specialStatusSnapshot(actor);
    blockStart = combat.log.length;
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
    tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));

    if (isCombatOver(combat, ctx)) break;
  }

  if (isCombatOver(combat, ctx)) {
    // Combat ended before some queued characters got to act — refund what was pre-committed for them.
    for (const queued of combat.queuedActions) {
      if (queued.actor.kind !== "character") continue;
      if (actedRefs.some((ref) => refEquals(ref, queued.actor))) continue;
      const actor = getActorByRef(queued.actor, ctx) as Character;
      if (!isActorAlive(actor)) continue;
      refundQueuedAction(queued, ctx);
    }
  }

  if (!isCombatOver(combat, ctx)) {
    blockStart = combat.log.length;
    for (const c of combat.combatants) {
      const actor = getActorByRef(c.ref, ctx);
      if (isActorAlive(actor)) tickStatModEffects(actor, { log: combat.log });
    }
    for (const c of ctx.party) {
      if (!c.isAlive) continue;
      for (const skillId of Object.keys(c.cooldownsRemaining)) {
        if (c.cooldownsRemaining[skillId]! > 0) c.cooldownsRemaining[skillId]! -= 1;
      }
    }
    for (const c of ctx.party) applyRoundFear(c, floorDepth);
    if (isPartyDying(satiety)) applyDyingDamage(ctx.party, combat.log);
    tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));
  }

  blockStart = combat.log.length;
  finalizeRound(combat, ctx);
  tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));
}

export function hasStunningStatus(actor: Actor): boolean {
  return actor.activeStatusEffects.some((a) => getStatusEffect(a.statusEffectId).stuns === true);
}

/** Refunds the inventory item queueItemAction pre-committed for an action that ends up never executing — stunned, feared, or its target(s) died before its turn came up. Skills commit nothing until they actually execute (see runCharacterTurn), so there's nothing to refund for them. */
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
    return;
  }

  if (rollLosesControl(actor.survival.fear, () => ctx.rng.next())) {
    refundQueuedAction(queued, ctx);
    combat.log.push({ text: t("combat.fearLoseControl", { actor: actor.name }), kind: "info" });
    return;
  }

  const skill = actionDefinition(queued.source, actor);
  const targets = resolveExecutionTargets(skill, queued, combat, ctx);
  if (targets === "fizzle") {
    refundQueuedAction(queued, ctx);
    combat.log.push({ text: t("combat.wastedAction", { actor: actor.name, skill: skill.name }), kind: "info" });
    return;
  }

  // Committed only now that the skill is confirmed to execute — mpCost is always 0 for the item
  // pseudo-skill (see actionDefinition), so this is a safe no-op for item actions.
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
  applySkillEffects(skill, actor, targets, combat, ctx, combat.log);
}

type ExecutionTargets = Actor[] | "fizzle";

function resolveExecutionTargets(skill: SkillDefinition, queued: QueuedAction, combat: CombatState, ctx: EngineContext): ExecutionTargets {
  if (skill.target === "singleEnemy") {
    const original = queued.targets[0];
    if (original && isActorAlive(getActorByRef(original, ctx))) return [getActorByRef(original, ctx)];
    const alive = livingMonsterRefs(combat, ctx);
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
    if (original && isActorAlive(getActorByRef(original, ctx))) return [getActorByRef(original, ctx)];
    if (!original) return "fizzle";
    if (original.kind === "monster") {
      const alive = livingMonsterRefs(combat, ctx);
      if (alive.length === 0) return "fizzle";
      return [getActorByRef(ctx.rng.pick(alive), ctx)];
    }
    return "fizzle";
  }
  const alive = queued.targets.filter((t) => isActorAlive(getActorByRef(t, ctx)));
  if (alive.length === 0) return "fizzle";
  return alive.map((t) => getActorByRef(t, ctx));
}

function ultimateEffectivenessMultiplier(fear: number): number {
  switch (getFearTier(fear)) {
    case 1:
      return 1;
    case 2:
      return 0.9;
    case 3:
      return 0.75;
    default:
      return 0.6;
  }
}

function scaleEffectForUltimate(effect: SkillEffect, source: Actor): SkillEffect {
  if (!isCharacter(source)) return effect;
  if (effect.kind !== "damage" && effect.kind !== "heal") return effect;
  if (effect.amount === undefined) return effect;
  const mult = ultimateEffectivenessMultiplier(source.survival.fear);
  if (mult === 1) return effect;
  return { ...effect, amount: Math.round(effect.amount * mult) };
}

function applyOnHitAoeDamage(source: Character, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  for (const active of source.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (!def.onHitAoeDamage) continue;
    for (const ref of livingMonsterRefs(combat, ctx)) {
      const enemy = getActorByRef(ref, ctx);
      resolveSkillEffect(
        {
          kind: "damage",
          amount: def.onHitAoeDamage.amount,
          ignoreDefensePercent: def.onHitAoeDamage.ignoreDefensePercent,
          offenseMultiplierPercent: def.onHitAoeDamage.offenseMultiplierPercent,
        },
        source,
        enemy,
        { log, isMagic: def.onHitAoeDamage.isMagic, skillName: statusDisplayName(def).replace(/-/g, " ") }
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

/** The bearer's `alwaysHit` chance (Artifacts and Ability combined), re-rolled fresh for the wearer's own enemy-targeting rolls only — a hit here skips whatever roll it's guarding entirely; a miss falls through to that roll exactly as if `alwaysHit` didn't exist. `11-abilities.md` §11.1.1. */
function rollsAlwaysHit(source: Actor, isEnemyFacing: boolean, ctx: EngineContext): boolean {
  if (!isEnemyFacing || !isCharacter(source)) return false;
  // `Rng.chance` advances the stream even at p = 0, so a party with no `alwaysHit` Ability would
  // otherwise pay a draw on every accuracy and every `effect.chance` roll — and shift the whole
  // seeded stream along with it.
  const chance = alwaysHitChance(source);
  return chance > 0 && ctx.rng.chance(chance / 100);
}

/** The first harmful status an enemy skill's `applyStatusEffect` is about to put on a Character — the only application the bearer's `debuffResist` (Artifacts and Ability combined) reduces. `11-abilities.md` §11.1.2. */
function harmfulStatusOnCharacter(effect: SkillEffect, target: Actor, isEnemyFacing: boolean) {
  if (!isEnemyFacing || !isCharacter(target) || effect.kind !== "applyStatusEffect") return null;
  const ids = [effect.statusEffectId, ...(effect.alsoApplyStatusEffectIds ?? [])].filter((id): id is Id => id !== undefined);
  return ids.map((id) => getStatusEffect(id)).find((def) => !isHelpfulStatusEffect(def)) ?? null;
}

/** The bearer's active status (if any) whose `breakBonus` applies to the attack that's about to break it — Ninja's `stealthed`. */
function findBreakBonusStatus(source: Actor) {
  return source.activeStatusEffects.find((s) => getStatusEffect(s.statusEffectId).breakBonus);
}

function resolveOneDamageEffect(
  effect: SkillEffect,
  skill: SkillDefinition,
  source: Actor,
  target: Actor,
  ctx: EngineContext,
  log: LogEntry[],
  stealthBreak: { guaranteedCrit: boolean; damageBonusPercent: number }
): number {
  const isCrit = stealthBreak.guaranteedCrit || (effect.critChance !== undefined && ctx.rng.chance(effect.critChance));
  return resolveSkillEffect(effect, source, target, {
    log,
    isMagic: skill.isMagic,
    skillName: skill.name,
    isCrit,
    executeBonus: skill.executeBonus,
    bonusDamagePercent: stealthBreak.damageBonusPercent || undefined,
  });
}

// Dismissing a summon only drops its `hp` to 0 and removes its ref from `combat.combatants` — the
// dead entry stays in `ctx.summons` (same pattern as a dead Character/Monster staying in its own
// array). A deterministic id would collide with a later summon of the same owner+archetype, and
// `getActorByRef`'s `.find()` would then resolve every lookup to the stale dead entry forever —
// so each summon gets a globally unique id instead, the same way `spawnMonster` uses a counter.
let summonCounter = 0;

/** How many minions of *different* archetypes `owner` may keep active at once — 1 by default, raised to 2/3 purely by the character level reaching Summoner's Mastery rank 2/3, independent of whether Mastery has actually been cast this combat (`01-class-skill.md` §1.11/1.12.4). */
function maxActiveMinionsFor(owner: Character): number {
  if (owner.classId !== "summoner") return 1;
  const rank = effectiveSkillRank(getSkill("summoner-mastery"), owner.level);
  if (rank >= 3) return 3;
  if (rank >= 2) return 2;
  return 1;
}

function ownedSummons(ownerId: Id, ctx: EngineContext): Summon[] {
  return ctx.summons.filter((s) => s.ownerId === ownerId && s.hp > 0);
}

function dismissSummon(summon: Summon, combat: CombatState, log: LogEntry[]): void {
  log.push({ text: t("combat.summonDismissed", { summon: summon.name }), kind: "info" });
  summon.hp = 0;
  combat.combatants = combat.combatants.filter((c) => !(c.ref.kind === "summon" && c.ref.id === summon.id));
}

/** Bonuses from `StatusEffectDefinition.empowersMinions` the owner currently carries (Summoner's Mastery) — applied on spawn so a minion summoned after casting Mastery comes in already boosted. */
function empowermentBonusFor(owner: Character): { maxHpPercent: number; attackPercent: number } {
  let maxHpPercent = 0;
  let attackPercent = 0;
  for (const active of owner.activeStatusEffects) {
    const bonus = getStatusEffect(active.statusEffectId).empowersMinions;
    if (!bonus) continue;
    maxHpPercent += bonus.maxHpPercent;
    attackPercent += bonus.attackPercent;
  }
  return { maxHpPercent, attackPercent };
}

/** Retroactively boosts every minion `owner` currently has active — called the moment an `empowersMinions` status lands on `owner` (Mastery cast on an already-summoned minion). */
function empowerActiveMinions(owner: Character, bonus: { maxHpPercent: number; attackPercent: number }, ctx: EngineContext): void {
  for (const s of ownedSummons(owner.id, ctx)) {
    s.maxHp = Math.round(s.maxHp * (1 + bonus.maxHpPercent / 100));
    s.hp = Math.round(s.hp * (1 + bonus.maxHpPercent / 100));
    s.attack = Math.round(s.attack * (1 + bonus.attackPercent / 100));
  }
}

/** `formula.base + (formula.percent / 100) * owner[formula.sourceStat]`, with `bonusPercent` (Mastery's empowerment) scaling the source-derived portion only — the flat `base` term isn't boosted. */
/** Resolves a scalar-or-`[r1, r2, r3]` value to a plain number for `rank` (1-3) — a scalar is used as-is; a tuple (a value that scales with the casting skill's rank) picks the matching element. Shared by `SummonStatFormula.percent` and `SummonCast.onDeath`'s per-rank fields. */
function resolveRankValue(value: number | [number, number, number], rank: number): number {
  return Array.isArray(value) ? value[Math.min(2, Math.max(0, rank - 1))]! : value;
}

/** Resolves `formula.percent` to a plain number for `rank` (1-3) — a scalar is used as-is; a `[r1, r2, r3]` tuple (a stat that scales with the casting skill's rank) picks the matching element. */
function resolveStatPercent(formula: SummonStatFormula, rank: number): number {
  return resolveRankValue(formula.percent, rank);
}

function computeSummonStat(formula: SummonStatFormula, owner: Character, rank: number, bonusPercent: number): number {
  return formula.base + (resolveStatPercent(formula, rank) / 100) * owner[formula.sourceStat] * (1 + bonusPercent / 100);
}

function spawnSummon(effect: SkillEffect, owner: Character, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  if (!effect.summonCastId) return;
  const cast = getSummonCast(effect.summonCastId);
  const archetype = getSummonArchetype(cast.archetypeId);
  const owned = ownedSummons(owner.id, ctx);
  const sameType = owned.find((s) => s.archetypeId === archetype.id);
  if (sameType) {
    dismissSummon(sameType, combat, log);
  } else if (owned.length >= maxActiveMinionsFor(owner)) {
    const oldest = owned[0];
    if (oldest) dismissSummon(oldest, combat, log);
  }
  // A cast profile is shared by all 3 ranks of the summoning skill (same id by convention), so the
  // stat formulas alone don't say which rank is currently active — re-derive it from the caster's level.
  const rank = effectiveSkillRank(getSkill(effect.summonCastId), owner.level) || 1;
  const { stat } = cast;
  const { maxHpPercent, attackPercent } = empowermentBonusFor(owner);
  const maxHp = Math.max(1, Math.round(computeSummonStat(stat.maxHp, owner, rank, maxHpPercent)));
  const { onDeath } = cast;
  const deathBurst = onDeath
    ? {
        amount: resolveRankValue(onDeath.amount, rank),
        offenseMultiplierPercent: resolveRankValue(onDeath.offenseMultiplierPercent, rank),
        offensiveStatOverride: owner[onDeath.sourceStat],
        statusEffectId: onDeath.statusEffectId,
        statusEffectChance: resolveRankValue(onDeath.statusEffectChance, rank),
        durationTurns: onDeath.durationTurns,
      }
    : undefined;
  summonCounter += 1;
  const summon: Summon = {
    id: `${owner.id}-${archetype.id}-${summonCounter}`,
    ownerId: owner.id,
    archetypeId: archetype.id,
    name: archetype.name,
    hp: maxHp,
    maxHp,
    attack: Math.round(computeSummonStat(stat.attack, owner, rank, attackPercent)),
    defense: Math.round(computeSummonStat(stat.defense, owner, rank, 0)),
    magicPower: Math.round(computeSummonStat(stat.magicPower, owner, rank, 0)),
    aggro: cast.aggro,
    speed: owner.speed,
    activeStatusEffects: [],
    actionsTaken: 0,
    maxActions: cast.maxActions,
    deathBurst,
  };
  ctx.summons.push(summon);
  combat.combatants.push({ ref: { kind: "summon", id: summon.id }, speed: summon.speed });
  log.push({ text: t("combat.summonSpawned", { owner: owner.name, summon: summon.name }), kind: "info" });
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

/** Fires a summon's `deathBurst` (Ninja's Shadow Clone) once, right before it leaves combat — an AoE hit to every living enemy plus a chance to apply its configured status, both computed off the owner's stat frozen at spawn time (`spawnSummon`), not whatever the summon or owner carries now. No-op for a summon with no `deathBurst` (every other archetype today). */
function triggerSummonDeathBurst(summon: Summon, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  const burst = summon.deathBurst;
  if (!burst) return;
  const targets = livingMonsterRefs(combat, ctx).map((r) => getActorByRef(r, ctx) as Monster);
  if (targets.length === 0) return;
  log.push({ text: t("combat.summonDeathBurst", { summon: summon.name }), kind: "attack" });
  for (const target of targets) {
    resolveSkillEffect(
      { kind: "damage", amount: burst.amount, offenseMultiplierPercent: burst.offenseMultiplierPercent },
      summon,
      target,
      { log, offensiveStatOverride: burst.offensiveStatOverride }
    );
    if (burst.statusEffectId && ctx.rng.chance(burst.statusEffectChance)) {
      resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: burst.statusEffectId, durationTurns: burst.durationTurns }, summon, target, { log });
    }
  }
}

/**
 * Removes a summon from combat once it's actually done — killed (hp 0, from a hit or a DoT tick) or
 * out of actions — firing its `deathBurst` first. Safe to call repeatedly/from multiple checkpoints
 * each round (`resolveRound`'s DoT-tick and per-turn sweeps, plus the direct call at the end of the
 * summon's own turn): once a summon is done, it's dropped from `combat.combatants`, so a later sweep
 * simply won't find it again and this becomes a no-op. Does *not* run for a manual dismiss/replace
 * (`dismissSummon` — recasting the same archetype, or eviction at the owner's minion cap) — the burst
 * is meant to be the cost of the summon actually falling in battle, not a free nuke on recast.
 */
function expireSummonIfDone(summon: Summon, combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  if (summon.actionsTaken < summon.maxActions && summon.hp > 0) return;
  log.push({ text: t("combat.summonExpired", { summon: summon.name }), kind: "info" });
  triggerSummonDeathBurst(summon, combat, ctx, log);
  combat.combatants = combat.combatants.filter((c) => !(c.ref.kind === "summon" && c.ref.id === summon.id));
  // Without this, ownedSummons()'s `hp > 0` filter keeps counting an action-expired summon toward
  // its owner's active-minion cap forever (it's already gone from combat.combatants, but a later
  // spawnSummon of a different archetype would still see it as "owned" and could evict a real minion).
  summon.hp = 0;
}

/** Sweeps every summon still in `combat.combatants` for one that just died (a hit, a DoT tick) or ran out of actions, and finalizes it (`expireSummonIfDone`). Called after every point in a round a summon could take lethal damage or use up its last action — see that function's own doc for why repeated calls are safe. */
function pruneDeadSummons(combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  for (const c of combat.combatants) {
    if (c.ref.kind !== "summon") continue;
    const summon = ctx.summons.find((s) => s.id === c.ref.id);
    if (summon) expireSummonIfDone(summon, combat, ctx, log);
  }
}

/** Living player-side actor (character or summon) with the lowest current HP% — Healer Spirit's default heal target. */
function pickLowestHpAlly(combat: CombatState, ctx: EngineContext): CombatantRef | null {
  const allies = livingPlayerSideRefs(combat, ctx);
  let best: CombatantRef | null = null;
  let bestRatio = Infinity;
  for (const ref of allies) {
    const a = getActorByRef(ref, ctx);
    const ratio = a.maxHp > 0 ? a.hp / a.maxHp : 0;
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = ref;
    }
  }
  return best;
}

function resolveSummonSkillTargets(skill: SkillDefinition, ref: CombatantRef, combat: CombatState, ctx: EngineContext): CombatantRef[] {
  const auto = autoResolveTargets(skill.target, ref, combat, ctx);
  if (auto) return auto;
  if (skill.target === "singleEnemy") {
    const enemies = livingMonsterRefs(combat, ctx);
    return enemies.length > 0 ? [ctx.rng.pick(enemies)] : [];
  }
  if (skill.target === "singleAlly") {
    const ally = pickLowestHpAlly(combat, ctx);
    return ally ? [ally] : [];
  }
  return [];
}

function runSummonTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const summon = getActorByRef(ref, ctx) as Summon;
  if (hasStunningStatus(summon)) {
    combat.log.push({ text: t("combat.stunnedSkipTurn", { actor: summon.name }), kind: "info" });
    return;
  }
  const archetype = getSummonArchetype(summon.archetypeId);
  const skillId = pickSummonAction(archetype, ctx.rng);
  if (skillId !== null) {
    const skill = getSummonSkill(skillId);
    const targets = resolveSummonSkillTargets(skill, ref, combat, ctx).map((r) => getActorByRef(r, ctx));
    if (targets.length === 0) return;
    combat.log.push({ text: t("combat.monsterSkillOnTarget", { actor: summon.name, skill: skill.name, target: targets[0]!.name }), kind: "attack" });
    applySkillEffects(skill, summon, targets, combat, ctx, combat.log);
  } else {
    const enemies = livingMonsterRefs(combat, ctx);
    if (enemies.length === 0) return;
    const target = getActorByRef(ctx.rng.pick(enemies), ctx) as Monster;
    if (!rollHits(summon, () => ctx.rng.next())) {
      combat.log.push({ text: t("combat.missedFear", { source: summon.name, target: target.name }), kind: "info" });
    } else {
      combat.log.push({ text: t("combat.basicAttack", { actor: summon.name, target: target.name }), kind: "attack" });
      resolveSkillEffect({ kind: "damage", amount: 0 }, summon, target, { log: combat.log });
    }
  }
  summon.actionsTaken += 1;
  expireSummonIfDone(summon, combat, ctx, combat.log);
}

export function applySkillEffects(skill: SkillDefinition, source: Actor, targets: Actor[], combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  const hasBonus = hasConditionalBonusStatus(skill, source);
  let landedDamageHit = false;
  let bonusEffectLanded = false;

  const breakStatus = findBreakBonusStatus(source);
  const breakDef = breakStatus ? getStatusEffect(breakStatus.statusEffectId) : undefined;
  const stealthBreak = {
    guaranteedCrit: skill.slot === 0 ? (breakDef?.breakBonus?.basicAttackGuaranteedCrit ?? false) : false,
    damageBonusPercent: skill.slot !== 0 ? (breakDef?.breakBonus?.skillDamageBonusPercent ?? 0) : 0,
  };
  let brokeStealthThisCast = false;

  // An effect with its own `target` resolves against a separate population from the skill's main
  // target(s) — e.g. Summoner's ultimate needs its `summon` effect to always land on the caster while
  // its `damage` effect still hits allEnemies. Resolved once here, per override effect, before the main
  // per-target loop below (which skips every such effect via the `isOverrideEffect` check). A `summon`
  // effect is always treated as an override — even with no explicit `target` — since it must always
  // land on the caster regardless of what the skill's own target happens to be.
  const isOverrideEffect = (e: SkillEffect) => e.kind === "summon" || (e.target !== undefined && e.target !== skill.target);
  const overrideEffects = (skill.effects ?? []).filter(isOverrideEffect);
  if (overrideEffects.length > 0) {
    const sourceRef: CombatantRef = isCharacter(source)
      ? { kind: "character", id: source.id }
      : isSummon(source)
        ? { kind: "summon", id: source.id }
        : { kind: "monster", id: source.id };
    for (const effect of overrideEffects) {
      const overrideTarget = effect.kind === "summon" ? (effect.target ?? "self") : effect.target!;
      const overrideTargets = (autoResolveTargets(overrideTarget, sourceRef, combat, ctx) ?? []).map((r) => getActorByRef(r, ctx));
      for (const resolved of overrideTargets) {
        if (effect.kind === "summon") {
          if (isCharacter(source)) spawnSummon(effect, source, combat, ctx, log);
          continue;
        }
        const overrideEnemyFacing = isPlayerSide(source) !== isPlayerSide(resolved);
        if (overrideEnemyFacing && !skill.isUltimate && !rollsAlwaysHit(source, overrideEnemyFacing, ctx) && !rollHits(source, () => ctx.rng.next())) continue;
        if (effect.chance !== undefined && !ctx.rng.chance(effect.chance)) continue;
        resolveOneDamageEffect(effect, skill, source, resolved, ctx, log, { guaranteedCrit: false, damageBonusPercent: 0 });
      }
    }
  }

  for (const target of targets) {
    const isEnemyFacing = isPlayerSide(source) !== isPlayerSide(target);
    if (isEnemyFacing && !skill.isUltimate && !rollsAlwaysHit(source, isEnemyFacing, ctx) && !rollHits(source, () => ctx.rng.next())) {
      log.push({ text: t("combat.missedFear", { source: sourceName(source), target: target.name }), kind: "info" });
      continue;
    }
    const activeEffects = (skill.effects ?? []).filter((e) => !isOverrideEffect(e));
    if (isEnemyFacing && isCharacter(target) && activeEffects.some((e) => e.kind === "damage") && rollDodge(target, ctx.rng)) {
      log.push({ text: t("combat.dodge", { target: target.name, actor: sourceName(source) }), kind: "info" });
      continue;
    }

    for (const effect of activeEffects) {
      if (effect.appliesToRelation) {
        const targetIsAlly = isPlayerSide(target);
        if ((effect.appliesToRelation === "ally") !== targetIsAlly) continue;
      }
      if (!isActorAlive(target) && effect.kind !== "applyStatusEffect") continue;
      const harmfulStatus = harmfulStatusOnCharacter(effect, target, isEnemyFacing);
      // `debuffResist` scales the effect's land chance down (an absent `chance` counts as 1). One draw serves both
      // the roll and the "threw it off" log, and none is spent at 0% so seeded streams stay put.
      const resistPercent = harmfulStatus && isCharacter(target) ? debuffResistPercent(target) : 0;
      if (resistPercent > 0) {
        const baseChance = effect.chance ?? 1;
        const roll = ctx.rng.next();
        if (roll >= baseChance * (1 - resistPercent / 100)) {
          if (roll < baseChance) log.push({ text: t("combat.debuffResisted", { target: target.name, status: statusDisplayName(harmfulStatus!) }), kind: "info" });
          continue;
        }
      } else if (effect.chance !== undefined && !rollsAlwaysHit(source, isEnemyFacing, ctx) && !ctx.rng.chance(effect.chance)) continue;
      const finalEffect = applyConditionalBonus(skill, skill.isUltimate ? scaleEffectForUltimate(effect, source) : effect, hasBonus);

      const hitCount = finalEffect.kind === "damage" && finalEffect.hitCountRange ? ctx.rng.int(finalEffect.hitCountRange.min, finalEffect.hitCountRange.max) : 1;
      const wasAliveBefore = isActorAlive(target);
      let appliedAmount = 0;
      for (let hit = 0; hit < hitCount; hit++) {
        if (!isActorAlive(target)) break;
        appliedAmount = resolveOneDamageEffect(finalEffect, skill, source, target, ctx, log, stealthBreak);
        if (finalEffect.kind === "damage") {
          brokeStealthThisCast = true;
          if (finalEffect.extraHitChance && ctx.rng.chance(finalEffect.extraHitChance) && isActorAlive(target)) {
            appliedAmount = resolveOneDamageEffect(finalEffect, skill, source, target, ctx, log, stealthBreak);
          }
        }
      }
      if (effect.kind === "damage") {
        for (const hook of combatHooks) hook.onHit?.(source, target, log);
        if (isCharacter(source)) {
          landedDamageHit = true;
          if (hasBonus) bonusEffectLanded = true;
        }
      }
      if (finalEffect.kind === "applyStatusEffect" && isCharacter(target)) {
        const bonus = finalEffect.statusEffectId ? getStatusEffect(finalEffect.statusEffectId).empowersMinions : undefined;
        if (bonus) empowerActiveMinions(target, bonus, ctx);
      }

      if (finalEffect.kind === "damage" && appliedAmount > 0) {
        for (const hook of combatHooks) hook.onDamageDealt?.(source, target, appliedAmount, ctx, log);
        if (wasAliveBefore && !isActorAlive(target)) {
          for (const hook of combatHooks) hook.onKill?.(source, target, log);
        }
      }
    }
  }
  if (breakStatus && brokeStealthThisCast) expireStatusEffect(source, breakStatus, { log });
  if (landedDamageHit && isCharacter(source)) applyOnHitAoeDamage(source, combat, ctx, log);
  consumeConditionalBonusStatus(skill, source, bonusEffectLanded);
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
    applyVictoryFearRelief(ctx.party, hasEliteOrBoss, combat.roundNumber);
    combat.log.push({ text: t("combat.roomCleared"), kind: "info" });
    return;
  }
  combat.roundNumber += 1;
  combat.queuedActions = [];
  combat.phase = "command";
}
