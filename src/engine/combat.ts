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
} from "../types";
import { getSkill } from "../data/classes";
import { getStatusEffect } from "../data/statusEffects";
import { Rng } from "./rng";
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
    log: [`Trận chiến bắt đầu tại phòng ${roomId}.`],
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

/** Resolves the target list for group-target skills at queue time. self/singleAlly/singleEnemy/singleAllyOrEnemy need an explicit pick from the UI. */
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
      return null; // singleAlly / singleEnemy / singleAllyOrEnemy — caller must supply a pick
  }
}

export interface QueueActionError {
  reason: string;
}

/** Validates + deducts MP/usesPerCombat/cooldown and appends a QueuedAction (docs/technical-decisions.md §2: cost is spent at queue time). */
export function queueAction(
  combat: CombatState,
  actorRef: CombatantRef,
  skillId: string,
  chosenTargets: CombatantRef[],
  ctx: EngineContext
): QueueActionError | null {
  const actor = getActorByRef(actorRef, ctx);
  if (!isCharacter(actor)) return { reason: "Chỉ nhân vật mới được ra lệnh ở pha này." };
  const skill = getSkill(skillId);
  if (!actor.unlockedSkillIds.includes(skillId)) return { reason: "Kỹ năng chưa được mở khóa." };
  if (actor.mp < skill.mpCost) return { reason: "Không đủ MP." };
  if (skill.usesPerCombat !== undefined) {
    const used = actor.usesRemainingThisCombat[skillId] ?? skill.usesPerCombat;
    if (used <= 0) return { reason: "Đã hết lượt dùng skill này trong trận." };
  }
  if ((actor.cooldownsRemaining[skillId] ?? 0) > 0) return { reason: "Kỹ năng đang hồi chiêu." };

  actor.mp -= skill.mpCost;
  if (skill.usesPerCombat !== undefined) {
    const used = actor.usesRemainingThisCombat[skillId] ?? skill.usesPerCombat;
    actor.usesRemainingThisCombat[skillId] = used - 1;
  }
  if (skill.cooldownTurns !== undefined) {
    actor.cooldownsRemaining[skillId] = skill.cooldownTurns;
  }

  combat.queuedActions.push({ actor: actorRef, source: { kind: "skill", skillId }, targets: chosenTargets });
  return null;
}

export function allLivingCharactersHaveQueuedActions(combat: CombatState, ctx: EngineContext): boolean {
  const living = livingCharacterRefs(combat, ctx);
  return living.every((ref) => combat.queuedActions.some((qa) => refEquals(qa.actor, ref)));
}

/** Buff skills (isBuff) get +20 speed for this round's sort only — landing before the round's attacks (docs/technical-decisions.md §4.7). Never mutates the actor's real speed. */
function turnOrderSortKey(c: Combatant, combat: CombatState): number {
  if (c.ref.kind !== "character") return c.speed;
  const queued = combat.queuedActions.find((qa) => refEquals(qa.actor, c.ref));
  if (queued && getSkill(queued.source.skillId).isBuff) return c.speed + 20;
  return c.speed;
}

function buildTurnQueue(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  const living = combat.combatants.filter((c) => isActorAlive(getActorByRef(c.ref, ctx)));
  // Re-snapshot speed at the moment the resolution phase begins (technical-decisions.md §2).
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

/** Ends the command phase and executes the whole round's resolution phase synchronously. */
export function resolveRound(combat: CombatState, ctx: EngineContext): void {
  combat.phase = "resolution";
  combat.turnQueue = buildTurnQueue(combat, ctx);
  combat.activeTurnIndex = 0;

  for (const ref of combat.turnQueue) {
    const actor = getActorByRef(ref, ctx);
    if (!isActorAlive(actor)) continue; // died earlier this round

    if (ref.kind === "character") {
      runCharacterTurn(ref, combat, ctx);
    } else {
      runMonsterTurn(ref, combat, ctx);
    }

    if (isCombatOver(combat, ctx)) break;
  }

  if (!isCombatOver(combat, ctx)) {
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
  }

  finalizeRound(combat, ctx);
}

function hasStunningStatus(actor: Actor): boolean {
  return actor.activeStatusEffects.some((a) => getStatusEffect(a.statusEffectId).stuns === true);
}

function runCharacterTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const actor = getActorByRef(ref, ctx) as Character;
  const queued = combat.queuedActions.find((qa) => refEquals(qa.actor, ref));
  if (!queued) return;

  if (hasStunningStatus(actor)) {
    combat.log.push(`${actor.name} đang choáng, bỏ lượt.`);
    return;
  }

  if (rollLosesControl(actor.survival.fear, () => ctx.rng.next())) {
    combat.log.push(`${actor.name} mất kiểm soát vì sợ hãi, bỏ lượt.`);
    return;
  }

  const skill = getSkill(queued.source.skillId);
  const targets = resolveExecutionTargets(skill, queued, combat, ctx);
  if (targets === "fizzle") {
    combat.log.push(`${actor.name} dùng ${skill.name} nhưng mục tiêu không còn — hành động lãng phí.`);
    return;
  }

  combat.log.push(`${actor.name} dùng ${skill.name}.`);
  applySkillEffects(skill, actor, targets, ctx, combat.log);
}

function runMonsterTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const actor = getActorByRef(ref, ctx) as Monster;
  if (hasStunningStatus(actor)) {
    combat.log.push(`${actor.name} đang choáng, bỏ lượt.`);
    return;
  }

  const livingChars = livingCharacterRefs(combat, ctx).map((r) => getActorByRef(r, ctx) as Character);
  if (livingChars.length === 0) return;

  let target: Character;
  if (actor.aiPattern === "defensive" && actor.hp / actor.maxHp < 0.4) {
    // No monster archetype currently defines a self-heal skill (out of scope) — falls through to attacking.
    target = pickAggroWeighted(livingChars, ctx.rng);
  } else if (actor.aiPattern === "erratic") {
    target = ctx.rng.pick(livingChars);
  } else {
    target = pickAggroWeighted(livingChars, ctx.rng);
  }

  combat.log.push(`${actor.name} tấn công ${target.name}.`);
  resolveSkillEffect({ kind: "damage", amount: 0 }, actor, target, { log: combat.log });
}

function pickAggroWeighted(characters: Character[], rng: Rng): Character {
  return rng.weightedPick(characters, (c) => Math.max(1, c.aggro));
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
    return "fizzle"; // no redirect for allies (technical-decisions.md §2)
  }
  if (skill.target === "singleAllyOrEnemy") {
    const original = queued.targets[0];
    if (original && isActorAlive(getActorByRef(original, ctx))) return [getActorByRef(original, ctx)];
    if (!original) return "fizzle";
    if (original.kind === "monster") {
      // original pick was an enemy — redirect like singleEnemy.
      const alive = livingMonsterRefs(combat, ctx);
      if (alive.length === 0) return "fizzle";
      return [getActorByRef(ctx.rng.pick(alive), ctx)];
    }
    return "fizzle"; // original pick was an ally — no redirect, like singleAlly
  }
  // self / allAllies / allEnemies / allAlliesAndEnemies: drop anyone who died since queueing, keep the rest.
  const alive = queued.targets.filter((t) => isActorAlive(getActorByRef(t, ctx)));
  if (alive.length === 0) return "fizzle";
  return alive.map((t) => getActorByRef(t, ctx));
}

/** Picks the effect list for 1 target: relation-aware for dual-relation skills (Thanh Tẩy/Thần Giáng), the plain list otherwise. */
function effectsFor(skill: SkillDefinition, target: Actor): SkillEffect[] {
  if (skill.effectsByRelation) {
    return isCharacter(target) ? skill.effectsByRelation.ally : skill.effectsByRelation.enemy;
  }
  return skill.effects ?? [];
}

/** docs/gameplay-decisions.md §4.1 — ultimates always hit, but damage/heal amounts scale down by the caster's fear tier instead. */
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

/** docs/technical-decisions.md §4.2 — a buff like Tẩm Độc's "dao-doc" makes the bearer's landed damage hits also apply another status to whoever got hit. */
function applyOnHitRider(source: Character, target: Actor, log: string[]): void {
  for (const active of source.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (def.onHitStatusEffectId) {
      resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: def.onHitStatusEffectId }, source, target, { log });
    }
  }
}

function applySkillEffects(skill: SkillDefinition, source: Actor, targets: Actor[], ctx: EngineContext, log: string[]): void {
  for (const target of targets) {
    // Accuracy: ultimates always hit (§4.1); everything else rolls once PER TARGET (so 1 dodging enemy
    // in an AoE doesn't affect whether the others get hit) — only applies when source/target are on opposite sides.
    const isEnemyFacing = isCharacter(source) !== isCharacter(target);
    if (isEnemyFacing && !skill.isUltimate && !rollHits(source, () => ctx.rng.next())) {
      log.push(`${sourceName(source)} ra đòn trượt vào ${target.name} vì quá sợ hãi.`);
      continue;
    }

    for (const effect of effectsFor(skill, target)) {
      if (!isActorAlive(target) && effect.kind !== "applyStatusEffect") continue;
      if (effect.chance !== undefined && !ctx.rng.chance(effect.chance)) continue;
      const finalEffect = skill.isUltimate ? scaleEffectForUltimate(effect, source) : effect;
      resolveSkillEffect(finalEffect, source, target, { log });
      if (effect.kind === "damage" && isCharacter(source)) applyOnHitRider(source, target, log);
    }
  }
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
    combat.log.push("Cả đội đã gục ngã...");
    return;
  }
  if (livingMonsterRefs(combat, ctx).length === 0) {
    combat.phase = "over";
    combat.outcome = "victory";
    combat.log.push("Toàn bộ quái vật trong phòng đã bị đánh bại!");
    return;
  }
  combat.roundNumber += 1;
  combat.queuedActions = [];
  combat.phase = "command";
}
