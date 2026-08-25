import type {
  Character,
  Monster,
  CombatState,
  Combatant,
  CombatantRef,
  QueuedAction,
  SkillTarget,
  SkillDefinition,
  SkillEffect,
  ActionSource,
  Id,
  LogEntry,
  LogEntryKind,
  CombatantSnapshot,
} from "../types";
import { getSkill, getEffectiveSkill } from "../data/classes";
import { getItem } from "../data/items";
import { getStatusEffect, statusSatisfiesRequirement } from "../data/statusEffects";
import { rollDodge, autoDamageAmounts, totalCooldownReduction } from "./artifacts";
import { Rng } from "./rng";
import { t } from "../data/strings";
import { applyRoundFear, applyVictoryFearRelief } from "./survival";
import { combatHooks } from "./combatHooks";
import { runMonsterTurn } from "./monsterAI";
import {
  type Actor,
  isCharacter,
  isActorAlive,
  resolveSkillEffect,
  tickStatusEffects,
  rollHits,
  rollLosesControl,
  getFearTier,
} from "./resolver";

export interface EngineContext {
  party: Character[];
  monsters: Monster[];
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

export function livingMonsterRefs(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  return combat.combatants
    .filter((c) => c.ref.kind === "monster")
    .map((c) => c.ref)
    .filter((ref) => isActorAlive(getActorByRef(ref, ctx)));
}

export function autoResolveTargets(target: SkillTarget, actor: CombatantRef, combat: CombatState, ctx: EngineContext): CombatantRef[] | null {
  switch (target) {
    case "self":
      return [actor];
    case "allAllies":
      return actor.kind === "character" ? livingCharacterRefs(combat, ctx) : livingMonsterRefs(combat, ctx);
    case "allEnemies":
      return actor.kind === "character" ? livingMonsterRefs(combat, ctx) : livingCharacterRefs(combat, ctx);
    case "allAlliesAndEnemies": {
      const allies = actor.kind === "character" ? livingCharacterRefs(combat, ctx) : livingMonsterRefs(combat, ctx);
      const enemies = actor.kind === "character" ? livingMonsterRefs(combat, ctx) : livingCharacterRefs(combat, ctx);
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
  const character = actor as Character;

  character.mp -= skill.mpCost;
  if (skill.usesPerCombat !== undefined) {
    const used = character.usesRemainingThisCombat[skillId] ?? skill.usesPerCombat;
    character.usesRemainingThisCombat[skillId] = used - 1;
  }
  if (skill.cooldownTurns !== undefined) {
    character.cooldownsRemaining[skillId] = Math.max(0, skill.cooldownTurns - totalCooldownReduction(character));
  }

  combat.queuedActions.push({ actor: actorRef, source: { kind: "skill", skillId }, targets: chosenTargets });
  return null;
}

export function checkItemUsable(actor: Actor, itemId: Id, inventory: Record<Id, number>): QueueActionError | null {
  if (!isCharacter(actor)) return { reason: t("errors.characterPhaseOnly") };
  if ((inventory[itemId] ?? 0) <= 0) return { reason: t("errors.noItem") };
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

function snapshotCombatants(combat: CombatState, ctx: EngineContext): CombatantSnapshot[] {
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
    };
  });
}

function tagLogRange(combat: CombatState, fromIndex: number, snapshot: CombatantSnapshot[]): void {
  for (let i = fromIndex; i < combat.log.length; i++) {
    const entry = combat.log[i];
    if (entry) entry.snapshot = snapshot;
  }
}

function runArtifactAutoDamage(combat: CombatState, ctx: EngineContext): void {
  for (const character of ctx.party) {
    if (!character.isAlive) continue;
    for (const amount of autoDamageAmounts(character)) {
      const alive = livingMonsterRefs(combat, ctx);
      if (alive.length === 0) return;
      const target = getActorByRef(ctx.rng.pick(alive), ctx) as Monster;
      target.hp = Math.max(0, target.hp - amount);
      combat.log.push({ text: t("combat.artifactAutoDamage", { character: character.name, amount, target: target.name }), kind: "attack" });
    }
  }
}

export function resolveRound(combat: CombatState, ctx: EngineContext, floorDepth = 1): void {
  combat.phase = "resolution";
  combat.turnQueue = buildTurnQueue(combat, ctx);
  combat.activeTurnIndex = 0;
  combat.roundStartSnapshot = snapshotCombatants(combat, ctx);

  let blockStart = combat.log.length;
  runArtifactAutoDamage(combat, ctx);
  tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));

  for (const ref of combat.turnQueue) {
    const actor = getActorByRef(ref, ctx);
    if (!isActorAlive(actor)) continue;

    blockStart = combat.log.length;
    if (ref.kind === "character") {
      runCharacterTurn(ref, combat, ctx);
    } else {
      runMonsterTurn(ref, combat, ctx);
    }
    tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));

    if (isCombatOver(combat, ctx)) break;
  }

  if (!isCombatOver(combat, ctx)) {
    blockStart = combat.log.length;
    for (const c of combat.combatants) {
      const actor = getActorByRef(c.ref, ctx);
      if (isActorAlive(actor)) tickStatusEffects(actor, { log: combat.log });
    }
    for (const c of ctx.party) {
      if (!c.isAlive) continue;
      for (const skillId of Object.keys(c.cooldownsRemaining)) {
        if (c.cooldownsRemaining[skillId]! > 0) c.cooldownsRemaining[skillId]! -= 1;
      }
    }
    for (const c of ctx.party) applyRoundFear(c, floorDepth);
    tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));
  }

  blockStart = combat.log.length;
  finalizeRound(combat, ctx);
  tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));
}

export function hasStunningStatus(actor: Actor): boolean {
  return actor.activeStatusEffects.some((a) => getStatusEffect(a.statusEffectId).stuns === true);
}

function runCharacterTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const actor = getActorByRef(ref, ctx) as Character;
  const queued = combat.queuedActions.find((qa) => refEquals(qa.actor, ref));
  if (!queued) return;

  if (hasStunningStatus(actor)) {
    combat.log.push({ text: t("combat.stunnedSkipTurn", { actor: actor.name }), kind: "info" });
    return;
  }

  if (rollLosesControl(actor.survival.fear, () => ctx.rng.next())) {
    combat.log.push({ text: t("combat.fearLoseControl", { actor: actor.name }), kind: "info" });
    return;
  }

  const skill = actionDefinition(queued.source, actor);
  const targets = resolveExecutionTargets(skill, queued, combat, ctx);
  if (targets === "fizzle") {
    combat.log.push({ text: t("combat.wastedAction", { actor: actor.name, skill: skill.name }), kind: "info" });
    return;
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

function effectsFor(skill: SkillDefinition, target: Actor): SkillEffect[] {
  if (skill.effectsByRelation) {
    return isCharacter(target) ? skill.effectsByRelation.ally : skill.effectsByRelation.enemy;
  }
  return skill.effects ?? [];
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
        { kind: "damage", amount: def.onHitAoeDamage.amount, ignoreDefensePercent: def.onHitAoeDamage.ignoreDefensePercent },
        source,
        enemy,
        { log, isMagic: def.onHitAoeDamage.isMagic }
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

export function applySkillEffects(skill: SkillDefinition, source: Actor, targets: Actor[], combat: CombatState, ctx: EngineContext, log: LogEntry[]): void {
  const hasBonus = hasConditionalBonusStatus(skill, source);
  let landedDamageHit = false;
  let bonusEffectLanded = false;
  for (const target of targets) {
    const isEnemyFacing = isCharacter(source) !== isCharacter(target);
    if (isEnemyFacing && !skill.isUltimate && !rollHits(source, () => ctx.rng.next())) {
      log.push({ text: t("combat.missedFear", { source: sourceName(source), target: target.name }), kind: "info" });
      continue;
    }
    if (isEnemyFacing && isCharacter(target) && effectsFor(skill, target).some((e) => e.kind === "damage") && rollDodge(target, ctx.rng)) {
      log.push({ text: t("combat.dodge", { target: target.name, actor: sourceName(source) }), kind: "info" });
      continue;
    }

    for (const effect of effectsFor(skill, target)) {
      if (!isActorAlive(target) && effect.kind !== "applyStatusEffect") continue;
      if (effect.chance !== undefined && !ctx.rng.chance(effect.chance)) continue;
      const finalEffect = applyConditionalBonus(skill, skill.isUltimate ? scaleEffectForUltimate(effect, source) : effect, hasBonus);

      const wasAliveBefore = isActorAlive(target);
      const appliedAmount = resolveSkillEffect(finalEffect, source, target, { log, isMagic: skill.isMagic });
      if (effect.kind === "damage") {
        for (const hook of combatHooks) hook.onHit?.(source, target, log);
        if (isCharacter(source)) {
          landedDamageHit = true;
          if (hasBonus) bonusEffectLanded = true;
        }
      }

      if (finalEffect.kind === "damage" && appliedAmount > 0) {
        for (const hook of combatHooks) hook.onDamageDealt?.(source, target, appliedAmount, ctx, log);
        if (wasAliveBefore && !isActorAlive(target)) {
          for (const hook of combatHooks) hook.onKill?.(source, target, log);
        }
      }
    }
  }
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
    applyVictoryFearRelief(ctx.party, hasEliteOrBoss);
    combat.log.push({ text: t("combat.roomCleared"), kind: "info" });
    return;
  }
  combat.roundNumber += 1;
  combat.queuedActions = [];
  combat.phase = "command";
}
