import type {
  Character,
  Monster,
  MonsterArchetype,
  MonsterTier,
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
import { getSkill } from "../data/classes";
import { getArchetype, getMonsterSkill, EXECUTE_COOLDOWN_TURNS } from "../data/monsters";
import { getItem } from "../data/items";
import { getStatusEffect } from "../data/statusEffects";
import {
  rollDodge,
  rollPoisonOnHit,
  totalReflectDamagePercent,
  totalLifestealPercent,
  totalHealOnKill,
  autoDamageAmounts,
  totalCooldownReduction,
} from "./artifacts";
import { Rng } from "./rng";
import { t } from "../data/strings";
import { applyRoundFear, applyVictoryFearRelief } from "./survival";
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
  /** Same object reference as GameState.inventory (see Game constructor) — item count by id, shared by the whole party. */
  inventory: Record<Id, number>;
}

/** Wraps an ItemDefinition as a SkillDefinition so item actions can reuse the exact same target-resolution/effect pipeline as skills (docs/gameplay-decisions/07-items-artifacts.md §7.1: items reuse SkillEffect + the resolver, no dedicated pipeline). */
function actionDefinition(source: ActionSource): SkillDefinition {
  if (source.kind === "skill") return getSkill(source.skillId);
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

/**
 * Read-only affordability check (unlocked / MP / usesPerCombat / cooldown) —
 * shared by queueAction (which then spends the cost) and the UI, which needs
 * to know a skill is unusable *before* letting the player advance to target
 * picking, not just at queue time.
 */
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

/** Validates + deducts MP/usesPerCombat/cooldown and appends a QueuedAction (docs/technical-decisions.md §2: cost is spent at queue time). */
export function queueAction(
  combat: CombatState,
  actorRef: CombatantRef,
  skillId: string,
  chosenTargets: CombatantRef[],
  ctx: EngineContext
): QueueActionError | null {
  const actor = getActorByRef(actorRef, ctx);
  const skill = getSkill(skillId);
  const err = checkSkillUsable(actor, skill);
  if (err) return err;
  const character = actor as Character; // checkSkillUsable already confirmed isCharacter(actor)

  character.mp -= skill.mpCost;
  if (skill.usesPerCombat !== undefined) {
    const used = character.usesRemainingThisCombat[skillId] ?? skill.usesPerCombat;
    character.usesRemainingThisCombat[skillId] = used - 1;
  }
  if (skill.cooldownTurns !== undefined) {
    // docs/gameplay-decisions/07-items-artifacts.md §7.2 — cooldownReduction artifacts.
    character.cooldownsRemaining[skillId] = Math.max(0, skill.cooldownTurns - totalCooldownReduction(character));
  }

  combat.queuedActions.push({ actor: actorRef, source: { kind: "skill", skillId }, targets: chosenTargets });
  return null;
}

/** Read-only affordability check for using an item instead of a skill — mirrors checkSkillUsable (docs/gameplay-decisions/07-items-artifacts.md §7.1). */
export function checkItemUsable(actor: Actor, itemId: Id, inventory: Record<Id, number>): QueueActionError | null {
  if (!isCharacter(actor)) return { reason: t("errors.characterPhaseOnly") };
  if ((inventory[itemId] ?? 0) <= 0) return { reason: t("errors.noItem") };
  return null;
}

/** Validates + deducts 1 from inventory and appends a QueuedAction, mirroring queueAction for items. */
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

/** Buff skills (isBuff) get +20 speed for this round's sort only — landing before the round's attacks (docs/technical-decisions.md §4.7). Never mutates the actor's real speed. */
function turnOrderSortKey(c: Combatant, combat: CombatState): number {
  if (c.ref.kind !== "character") return c.speed;
  const queued = combat.queuedActions.find((qa) => refEquals(qa.actor, c.ref));
  if (queued && actionDefinition(queued.source).isBuff) return c.speed + 20;
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

/** Full-roster HP/alive state right now — used to tag log entries so the UI can replay the round's panels in step with the paced log reveal instead of jumping straight to the end (see LogEntry.snapshot). */
function snapshotCombatants(combat: CombatState, ctx: EngineContext): CombatantSnapshot[] {
  return combat.combatants.map((c) => {
    const actor = getActorByRef(c.ref, ctx);
    return { id: actor.id, hp: actor.hp, maxHp: actor.maxHp, isAlive: isActorAlive(actor) };
  });
}

/** Attaches `snapshot` to every log entry pushed since `fromIndex` — i.e. everything 1 block (a turn, a tick phase) just produced. */
function tagLogRange(combat: CombatState, fromIndex: number, snapshot: CombatantSnapshot[]): void {
  for (let i = fromIndex; i < combat.log.length; i++) {
    const entry = combat.log[i];
    if (entry) entry.snapshot = snapshot;
  }
}

/** docs/gameplay-decisions/07-items-artifacts.md §7.2 group 3 — autoDamage fires once per equipped copy at the start of every round, flat damage (no attack/defense), 1 uniformly-random living monster per tick, independent of queueAction/MP/turn order. */
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

/** Ends the command phase and executes the whole round's resolution phase synchronously. */
export function resolveRound(combat: CombatState, ctx: EngineContext, floorDepth = 1): void {
  combat.phase = "resolution";
  combat.turnQueue = buildTurnQueue(combat, ctx);
  combat.activeTurnIndex = 0;
  // Baseline for the UI: state as of the instant this round started, before any of its mutations.
  combat.roundStartSnapshot = snapshotCombatants(combat, ctx);

  let blockStart = combat.log.length;
  runArtifactAutoDamage(combat, ctx);
  tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));

  for (const ref of combat.turnQueue) {
    const actor = getActorByRef(ref, ctx);
    if (!isActorAlive(actor)) continue; // died earlier this round

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
    // docs/gameplay-decisions/03-survival-stats.md §3 — every round that doesn't end the fight costs fear.
    for (const c of ctx.party) applyRoundFear(c, floorDepth);
    tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));
  }

  blockStart = combat.log.length;
  finalizeRound(combat, ctx);
  tagLogRange(combat, blockStart, snapshotCombatants(combat, ctx));
}

function hasStunningStatus(actor: Actor): boolean {
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

  const skill = actionDefinition(queued.source);
  const targets = resolveExecutionTargets(skill, queued, combat, ctx);
  if (targets === "fizzle") {
    combat.log.push({ text: t("combat.wastedAction", { actor: actor.name, skill: skill.name }), kind: "info" });
    return;
  }

  // Name the target for a single-recipient skill ("A dùng Heal lên B.") so who's
  // being buffed/debuffed/healed is clear before the effect lines even resolve —
  // but not for a self-target (targets[0] === actor) or an AoE skill (>1 target).
  const soloTarget = targets.length === 1 && targets[0] !== actor ? targets[0] : null;
  const announceKind: LogEntryKind = queued.source.kind === "item" ? "item" : "info";
  combat.log.push({
    text: soloTarget
      ? t("combat.useSkillOnTarget", { actor: actor.name, skill: skill.name, target: soloTarget.name })
      : t("combat.useSkillPlain", { actor: actor.name, skill: skill.name }),
    kind: announceKind,
  });
  applySkillEffects(skill, actor, targets, ctx, combat.log);
}

/** Normal-tier targeting (§2): erratic ignores aggro entirely, aggressive/defensive both weight by aggro (no monster archetype defines a self-heal skill, so "defensive under 40% HP" falls through to the same rule as aggressive). Reused by elite/boss for their strike skill and species skills aimed at 1 target. */
function pickMonsterTarget(actor: Monster, livingChars: Character[], rng: Rng): Character {
  if (actor.aiPattern === "erratic") return rng.pick(livingChars);
  return pickAggroWeighted(livingChars, rng);
}

type MonsterAction = "basicAttack" | "skill" | "strike" | "cleave" | "debuff";

/**
 * Weighted pick of this turn's action from `archetype.actionWeights[tier]` (data/monsters.json) —
 * candidates with weight <= 0, or whose prerequisite kit is missing (`skill` needs a non-empty
 * `skillIds`, `strike`/`cleave` need `eliteSkillIds`, `debuff` needs `bossSkillIds`), are excluded
 * before the roll. No config for this tier, or nothing left after filtering, both fall back to
 * `basicAttack` — every monster can always at least attack.
 */
function pickMonsterAction(archetype: MonsterArchetype, tier: MonsterTier, rng: Rng): MonsterAction {
  const weights = archetype.actionWeights?.[tier];
  if (!weights) return "basicAttack";
  const candidates: [MonsterAction, number][] = [];
  for (const [key, weight] of Object.entries(weights) as [MonsterAction, number | undefined][]) {
    if (!weight || weight <= 0) continue;
    if (key === "skill" && archetype.skillIds.length === 0) continue;
    if ((key === "strike" || key === "cleave") && !archetype.eliteSkillIds) continue;
    if (key === "debuff" && !archetype.bossSkillIds) continue;
    candidates.push([key, weight]);
  }
  if (candidates.length === 0) return "basicAttack";
  return rng.weightedPick(candidates, ([, weight]) => weight)[0];
}

/** Target(s) for a species skill (`archetype.skillIds`) — same 2 shapes every monster skill in data/monster-skills.json uses. */
function resolveMonsterSkillTargets(skill: SkillDefinition, actor: Monster, livingChars: Character[], rng: Rng): Character[] {
  if (skill.target === "allEnemies") return livingChars;
  return [pickMonsterTarget(actor, livingChars, rng)];
}

function runMonsterTurn(ref: CombatantRef, combat: CombatState, ctx: EngineContext): void {
  const actor = getActorByRef(ref, ctx) as Monster;
  if (hasStunningStatus(actor)) {
    combat.log.push({ text: t("combat.stunnedSkipTurn", { actor: actor.name }), kind: "info" });
    return;
  }

  const livingChars = livingCharacterRefs(combat, ctx).map((r) => getActorByRef(r, ctx) as Character);
  if (livingChars.length === 0) return;

  const archetype = getArchetype(actor.archetypeId);

  // §6.12: boss telegraphs Đòn Kết Liễu 1 turn ahead of releasing it — locks in a target when
  // charging starts (logged as a warning), then unleashes a flat, very high hit on the next turn.
  // Not HP%-based anymore: it can nearly one-shot a low-maxHp class or hit the tank for ~60% of
  // theirs, so taunting the marked target between the charge and release turns is a real counter.
  // Execute stays on its own charge/cooldown/release cycle — it's NOT part of pickMonsterAction's
  // weighted pool (§6.12 forced periodic mechanic, not a per-turn roll).
  if (actor.tier === "boss" && archetype.bossSkillIds) {
    if (actor.isChargingExecute) {
      const target = livingChars.find((c) => c.id === actor.executeTargetId) ?? pickAggroWeighted(livingChars, ctx.rng);
      combat.log.push({ text: t("combat.bossExecuteRelease", { actor: actor.name, target: target.name }), kind: "attack" });
      applySkillEffects(getMonsterSkill(archetype.bossSkillIds.execute), actor, [target], ctx, combat.log);
      actor.isChargingExecute = false;
      actor.executeTargetId = undefined;
      actor.executeCooldownTurns = EXECUTE_COOLDOWN_TURNS;
      return;
    }
    if ((actor.executeCooldownTurns ?? 0) <= 0) {
      const target = pickAggroWeighted(livingChars, ctx.rng);
      actor.isChargingExecute = true;
      actor.executeTargetId = target.id;
      combat.log.push({ text: t("combat.bossExecuteCharge", { actor: actor.name, target: target.name }), kind: "info" });
      return; // the charge itself is the whole turn — no attack this round, but a clear warning
    }
    actor.executeCooldownTurns = (actor.executeCooldownTurns ?? 0) - 1;
  }

  switch (pickMonsterAction(archetype, actor.tier, ctx.rng)) {
    case "debuff": {
      // pickMonsterAction only returns "debuff" when archetype.bossSkillIds is set.
      const target = pickAggroWeighted(livingChars, ctx.rng);
      const skill = getMonsterSkill(archetype.bossSkillIds!.debuff);
      combat.log.push({ text: t("combat.useSkillPlain", { actor: actor.name, skill: skill.name }), kind: "info" });
      applySkillEffects(skill, actor, [target], ctx, combat.log);
      return;
    }
    case "cleave": {
      // pickMonsterAction only returns "cleave" when archetype.eliteSkillIds is set.
      const skill = getMonsterSkill(archetype.eliteSkillIds!.cleave);
      combat.log.push({ text: t("combat.eliteCleave", { actor: actor.name, skill: skill.name }), kind: "attack" });
      applySkillEffects(skill, actor, livingChars, ctx, combat.log);
      return;
    }
    case "strike": {
      // pickMonsterAction only returns "strike" when archetype.eliteSkillIds is set.
      const target = pickMonsterTarget(actor, livingChars, ctx.rng);
      const skill = getMonsterSkill(archetype.eliteSkillIds!.strike);
      combat.log.push({ text: t("combat.eliteStrike", { actor: actor.name, skill: skill.name, target: target.name }), kind: "attack" });
      applySkillEffects(skill, actor, [target], ctx, combat.log);
      return;
    }
    case "skill": {
      // pickMonsterAction only returns "skill" when archetype.skillIds is non-empty.
      const skill = getMonsterSkill(ctx.rng.pick(archetype.skillIds));
      const targets = resolveMonsterSkillTargets(skill, actor, livingChars, ctx.rng);
      combat.log.push({ text: t("combat.useSkillPlain", { actor: actor.name, skill: skill.name }), kind: "info" });
      applySkillEffects(skill, actor, targets, ctx, combat.log);
      return;
    }
    case "basicAttack": {
      const target = pickMonsterTarget(actor, livingChars, ctx.rng);
      // dodgeChance/reflectDamage (§7.2) apply here too — this basic attack bypasses applySkillEffects
      // entirely (no skill involved), so it needs its own copy of both hooks.
      if (rollDodge(target, ctx.rng)) {
        combat.log.push({ text: t("combat.dodge", { target: target.name, actor: actor.name }), kind: "info" });
        return;
      }
      combat.log.push({ text: t("combat.basicAttack", { actor: actor.name, target: target.name }), kind: "attack" });
      const damageDealt = resolveSkillEffect({ kind: "damage", amount: 0 }, actor, target, { log: combat.log });
      if (damageDealt > 0) applyArtifactReflectDamage(target, actor, damageDealt, combat.log);
      return;
    }
  }
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

/** docs/technical-decisions.md §4.2 — a buff like Poison Coat's "poison-coat" makes the bearer's landed damage hits also apply another status to whoever got hit. */
function applyOnHitRider(source: Character, target: Actor, log: LogEntry[]): void {
  for (const active of source.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (def.onHitStatusEffectId) {
      resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: def.onHitStatusEffectId }, source, target, { log });
    }
  }
}

/** docs/gameplay-decisions/07-items-artifacts.md §7.2 — reflectDamage: bearer just took `damageDealt` from `attacker`, reflect a % of it back (bypasses defense, like a status DoT tick). */
function applyArtifactReflectDamage(bearer: Character, attacker: Actor, damageDealt: number, log: LogEntry[]): void {
  const percent = totalReflectDamagePercent(bearer);
  const reflected = Math.round(damageDealt * (percent / 100));
  if (reflected <= 0) return;
  attacker.hp = Math.max(0, attacker.hp - reflected);
  log.push({ text: t("combat.reflectDamage", { attacker: attacker.name, amount: reflected, bearer: bearer.name }), kind: "attack" });
}

/** lifesteal — bearer just dealt `damageDealt`, heal them a % of it. */
function applyArtifactLifesteal(bearer: Character, damageDealt: number, log: LogEntry[]): void {
  const healed = Math.round(damageDealt * (totalLifestealPercent(bearer) / 100));
  if (healed <= 0) return;
  const before = bearer.hp;
  bearer.hp = Math.min(bearer.maxHp, bearer.hp + healed);
  if (bearer.hp > before) log.push({ text: t("combat.lifesteal", { bearer: bearer.name, amount: bearer.hp - before }), kind: "heal" });
}

/** healOnKill — bearer just landed the killing blow. */
function applyArtifactHealOnKill(bearer: Character, log: LogEntry[]): void {
  const amount = totalHealOnKill(bearer);
  if (amount <= 0) return;
  const before = bearer.hp;
  bearer.hp = Math.min(bearer.maxHp, bearer.hp + amount);
  if (bearer.hp > before) log.push({ text: t("combat.healOnKill", { bearer: bearer.name, amount: bearer.hp - before }), kind: "heal" });
}

function applySkillEffects(skill: SkillDefinition, source: Actor, targets: Actor[], ctx: EngineContext, log: LogEntry[]): void {
  for (const target of targets) {
    // Accuracy: ultimates always hit (§4.1); everything else rolls once PER TARGET (so 1 dodging enemy
    // in an AoE doesn't affect whether the others get hit) — only applies when source/target are on opposite sides.
    const isEnemyFacing = isCharacter(source) !== isCharacter(target);
    if (isEnemyFacing && !skill.isUltimate && !rollHits(source, () => ctx.rng.next())) {
      log.push({ text: t("combat.missedFear", { source: sourceName(source), target: target.name }), kind: "info" });
      continue;
    }
    // dodgeChance (§7.2) — only for actual attacks (a `damage` effect) aimed at an equipped character,
    // rolled separately from the fear-accuracy check above (unrelated mechanics, see §7.2 "Vì sao").
    if (isEnemyFacing && isCharacter(target) && effectsFor(skill, target).some((e) => e.kind === "damage") && rollDodge(target, ctx.rng)) {
      log.push({ text: t("combat.dodge", { target: target.name, actor: sourceName(source) }), kind: "info" });
      continue;
    }

    for (const effect of effectsFor(skill, target)) {
      if (!isActorAlive(target) && effect.kind !== "applyStatusEffect") continue;
      if (effect.chance !== undefined && !ctx.rng.chance(effect.chance)) continue;
      const finalEffect = skill.isUltimate ? scaleEffectForUltimate(effect, source) : effect;

      const wasAliveBefore = isActorAlive(target);
      const appliedAmount = resolveSkillEffect(finalEffect, source, target, { log, isMagic: skill.isMagic });
      if (effect.kind === "damage" && isCharacter(source)) applyOnHitRider(source, target, log);

      if (finalEffect.kind === "damage" && appliedAmount > 0) {
        if (isCharacter(target) && isEnemyFacing) applyArtifactReflectDamage(target, source, appliedAmount, log);
        if (isCharacter(source)) {
          applyArtifactLifesteal(source, appliedAmount, log);
          if (rollPoisonOnHit(source, ctx.rng)) {
            resolveSkillEffect({ kind: "applyStatusEffect", statusEffectId: "poisoned" }, source, target, { log });
          }
          if (wasAliveBefore && !isActorAlive(target)) applyArtifactHealOnKill(source, log);
        }
      }
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
    combat.log.push({ text: t("combat.partyWiped"), kind: "death" });
    return;
  }
  if (livingMonsterRefs(combat, ctx).length === 0) {
    combat.phase = "over";
    combat.outcome = "victory";
    // §3 bigger relief — driven by the actual monster tier fought, not `combat.isBossFight`
    // (that flag really means "guard room", which elite fights also use most floors).
    const hasEliteOrBoss = combat.combatants.some((c) => c.ref.kind === "monster" && (getActorByRef(c.ref, ctx) as Monster).tier !== "normal");
    applyVictoryFearRelief(ctx.party, hasEliteOrBoss);
    combat.log.push({ text: t("combat.roomCleared"), kind: "info" });
    return;
  }
  combat.roundNumber += 1;
  combat.queuedActions = [];
  combat.phase = "command";
}
