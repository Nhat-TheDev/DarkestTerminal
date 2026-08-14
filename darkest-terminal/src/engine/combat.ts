import type {
  Character,
  Monster,
  CombatState,
  Combatant,
  CombatantRef,
  QueuedAction,
  SkillTarget,
  SkillDefinition,
} from "../types";
import { getSkill } from "../data/classes";
import { Rng } from "./rng";
import {
  type Actor,
  isCharacter,
  isActorAlive,
  resolveSkillEffect,
  tickStatusEffects,
  rollHits,
  rollLosesControl,
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
  for (const c of ctx.party) c.usesRemainingThisCombat = {};
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

/** Resolves the target list for group-target skills at queue time. self/singleAlly/singleEnemy need an explicit pick from the UI. */
export function autoResolveTargets(target: SkillTarget, actor: CombatantRef, combat: CombatState, ctx: EngineContext): CombatantRef[] | null {
  switch (target) {
    case "self":
      return [actor];
    case "allAllies":
      return actor.kind === "character" ? livingCharacterRefs(combat, ctx) : livingMonsterRefs(combat, ctx);
    case "allEnemies":
      return actor.kind === "character" ? livingMonsterRefs(combat, ctx) : livingCharacterRefs(combat, ctx);
    default:
      return null; // singleAlly / singleEnemy — caller must supply a pick
  }
}

export interface QueueActionError {
  reason: string;
}

/** Validates + deducts MP/usesPerCombat and appends a QueuedAction (docs/technical-decisions.md §2: cost is spent at queue time). */
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

  actor.mp -= skill.mpCost;
  if (skill.usesPerCombat !== undefined) {
    const used = actor.usesRemainingThisCombat[skillId] ?? skill.usesPerCombat;
    actor.usesRemainingThisCombat[skillId] = used - 1;
  }

  combat.queuedActions.push({ actor: actorRef, source: { kind: "skill", skillId }, targets: chosenTargets });
  return null;
}

export function allLivingCharactersHaveQueuedActions(combat: CombatState, ctx: EngineContext): boolean {
  const living = livingCharacterRefs(combat, ctx);
  return living.every((ref) => combat.queuedActions.some((qa) => refEquals(qa.actor, ref)));
}

function buildTurnQueue(combat: CombatState, ctx: EngineContext): CombatantRef[] {
  const living = combat.combatants.filter((c) => isActorAlive(getActorByRef(c.ref, ctx)));
  // Re-snapshot speed at the moment the resolution phase begins (technical-decisions.md §2).
  for (const c of living) c.speed = getActorByRef(c.ref, ctx).speed;
  const sorted = [...living].sort((a, b) => {
    if (b.speed !== a.speed) return b.speed - a.speed;
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
  }

  finalizeRound(combat, ctx);
}

function runCharacterTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const actor = getActorByRef(ref, ctx) as Character;
  const queued = combat.queuedActions.find((qa) => refEquals(qa.actor, ref));
  if (!queued) return;

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

  const isEnemyTargeting = skill.target === "singleEnemy" || skill.target === "allEnemies";
  if (isEnemyTargeting && !rollHits(actor, () => ctx.rng.next())) {
    combat.log.push(`${actor.name} dùng ${skill.name} nhưng trượt vì quá sợ hãi.`);
    return;
  }

  combat.log.push(`${actor.name} dùng ${skill.name}.`);
  applySkillEffects(skill, actor, targets, ctx, combat.log);
}

function runMonsterTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const actor = getActorByRef(ref, ctx) as Monster;
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
  // self / allAllies / allEnemies: drop anyone who died since queueing, keep the rest.
  const alive = queued.targets.filter((t) => isActorAlive(getActorByRef(t, ctx)));
  if (alive.length === 0) return "fizzle";
  return alive.map((t) => getActorByRef(t, ctx));
}

function applySkillEffects(skill: SkillDefinition, source: Actor, targets: Actor[], ctx: EngineContext, log: string[]): void {
  for (const effect of skill.effects) {
    for (const target of targets) {
      if (!isActorAlive(target) && effect.kind !== "applyStatusEffect") continue;
      resolveSkillEffect(effect, source, target, { log });
    }
  }
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
