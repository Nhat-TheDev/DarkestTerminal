import type { Character, Monster, Summon, SkillEffect, CombatStat, SurvivalStats, ActiveStatusEffect, LogEntry, StatusEffectDefinition, GameState, DamageType, Id } from "../types";
import { getStatusEffect, statusDisplayName } from "../data/statusEffects";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";
import { resolveRaceProfile } from "../data/monsterRaces";
import { getClass, getUnlockedPassiveRank } from "../data/classes";

const ACOLYTE_HEAL_BOOST_BY_RANK = { 0: 0, 1: 10, 2: 20, 3: 25 } as const;

export function isHelpfulStatusEffect(def: StatusEffectDefinition): boolean {
  if (def.stuns || def.vulnerableTo || def.accuracyPenaltyPercent) return false;
  if (def.perTurnEffects.some((e) => e.kind === "damage")) return false;
  if (def.perTurnEffects.some((e) => e.kind === "modifyCombatStat" && (e.amount ?? 0) < 0)) return false;
  return true;
}

export type StatusCategory = "dot" | "statMod" | "special";

/**
 * Which of the 3 turn-countdown schedules a status follows. Normally inferred from its own
 * perTurnEffects shape (a status is either a HP/MP-over-time effect, a stat modifier, or a
 * "special" effect with no per-turn tick of its own, e.g. stuns/on-hit riders) — `tickCategory`
 * overrides that inference for a status whose shape doesn't match its intended timing, e.g. a
 * pure stat-mod rider that must stay in lockstep with a "special" status it's always co-applied with.
 */
export function statusCategory(def: StatusEffectDefinition): StatusCategory {
  if (def.tickCategory) return def.tickCategory;
  if (def.perTurnEffects.some((e) => e.kind === "damage" || e.kind === "heal" || e.kind === "restoreMp")) return "dot";
  if (def.perTurnEffects.some((e) => e.kind === "modifyCombatStat")) return "statMod";
  return "special";
}

const SURVIVAL_STAT_LABEL: Record<keyof SurvivalStats, string> = {
  fear: t("resolver.statLabelFear"),
};

const COMBAT_STAT_LABEL: Record<CombatStat, string> = {
  attack: t("resolver.statLabelAttack"),
  defense: t("resolver.statLabelDefense"),
  aggro: t("resolver.statLabelAggro"),
  speed: t("resolver.statLabelSpeed"),
};

export type Actor = Character | Monster | Summon;

export function isCharacter(actor: Actor): actor is Character {
  return "classId" in actor;
}

export function isSummon(actor: Actor): actor is Summon {
  return "ownerId" in actor;
}

export function isMonster(actor: Actor): actor is Monster {
  return "archetypeId" in actor && !isSummon(actor);
}

/** True for anything fighting on the player's side — a real `Character` or a `Summon` (Ninja's clone, Summoner's minions). Use this instead of `isCharacter` for enemy-facing/ally-facing checks; `isCharacter` alone is for things genuinely exclusive to real characters (MP, fear, abilities, skill ranks). */
export function isPlayerSide(actor: Actor): boolean {
  return isCharacter(actor) || isSummon(actor);
}

export function isActorAlive(actor: Actor): boolean {
  return isCharacter(actor) ? actor.isAlive && actor.hp > 0 : actor.hp > 0;
}

export type FearTier = 1 | 2 | 3 | 4;

export function getFearTier(fear: number): FearTier {
  if (fear >= 100) return 4;
  if (fear >= 70) return 3;
  if (fear >= 40) return 2;
  return 1;
}

export function getFearAccuracyPenalty(tier: FearTier): number {
  if (tier === 1) return 0;
  if (tier === 2) return 0.1;
  return 0.2;
}

export function getFearDamagePenalty(tier: FearTier): number {
  return tier >= 3 ? 0.15 : 0;
}

export function rollLosesControl(fear: number, roll: () => number): boolean {
  return getFearTier(fear) === 4 && roll() < 0.25;
}

function statusAccuracyPenaltyPercent(source: Actor): number {
  let total = 0;
  for (const active of source.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (def.accuracyPenaltyPercent) total += def.accuracyPenaltyPercent;
  }
  return total;
}

export function rollHits(source: Actor, roll: () => number): boolean {
  const fearPenalty = isCharacter(source) ? getFearAccuracyPenalty(getFearTier(source.survival.fear)) : 0;
  const penalty = Math.min(1, fearPenalty + statusAccuracyPenaltyPercent(source) / 100);
  return roll() >= penalty;
}

function damageMultiplierFor(source: Actor): number {
  if (!isCharacter(source)) return 1;
  return 1 - getFearDamagePenalty(getFearTier(source.survival.fear));
}

function applyCombatStatDelta(actor: Actor, stat: CombatStat, amount: number): void {
  if (stat === "aggro") {
    // Monster has no `aggro` field (only the party's aggro decides monster targeting) — a Summon does, since it's a real target on the player's side.
    if (isCharacter(actor) || isSummon(actor)) actor.aggro += amount;
    return;
  }
  actor[stat] += amount;
}

function getCombatStatValue(actor: Actor, stat: CombatStat): number {
  if (stat === "aggro") return isCharacter(actor) || isSummon(actor) ? actor.aggro : 0;
  return actor[stat];
}

/**
 * The delta a `modifyCombatStat` effect actually applies: `effect.amount` unless `effect.minPercent`
 * is set and `actorStat * minPercent / 100` (read from the actor's stat *before* this delta lands) has
 * the larger magnitude — sign preserved either way, so a negative `minPercent` floors a debuff the same
 * way a positive one floors a buff. A tie keeps the flat `amount`.
 */
function computeCombatStatDelta(actor: Actor, effect: SkillEffect): number {
  const amount = effect.amount ?? 0;
  if (!effect.minPercent || !effect.combatStat) return amount;
  const floor = Math.round((getCombatStatValue(actor, effect.combatStat) * effect.minPercent) / 100);
  return Math.abs(floor) > Math.abs(amount) ? floor : amount;
}

export interface ResolveContext {
  log: LogEntry[];
  statusEffectName?: string;
  /** Name of the skill this effect came from, shown in the damage log line ("X takes N damage from Y's Skill."). Omit for basic attacks and other unnamed sources. */
  skillName?: string;
  isMagic?: boolean;
  /** Required for a `modifyStat` effect targeting `"satiety"` — that stat lives on GameState (party-wide), not on the Character. */
  gameState?: GameState;
  /** Set by the caller (after rolling `effect.critChance`) to apply this damage effect's crit multiplier. */
  isCrit?: boolean;
  /** The casting skill's own `SkillDefinition.executeBonus` (a `SkillDefinition`-level field, so the caller threads it through same as `skillName`/`isMagic`). */
  executeBonus?: { hpPercentThreshold: number; bonusDamagePercent?: number; bonusDamageFlat?: number };
  /** A flat extra % applied to this specific damage instance, on top of everything else — e.g. Ninja's stealth-break bonus on a skill attack. */
  bonusDamagePercent?: number;
  /** Replaces the source's live `attack`/`magicPower` as the stat a `damage` effect's `offenseMultiplierPercent` scales — used by an Ability's `autoDamage`, which scales off the bearer's base stat, not whatever buffs/equipment currently sit on top of it. */
  offensiveStatOverride?: number;
  /** Set by the caller (combat.ts) when this effect came from the source's own class skill, as opposed
   *  to an item or another class's skill — the only thing Acolyte's own-healing-output passive boosts. */
  castByOwnClassSkill?: boolean;
  /** For `applyStatusEffect` with `effect.linksToCasterSummon` — the id of the summon (from this same
   *  skill's own `summon` effect) this status's expiry is tied to. Set by combat.ts's `applySkillEffects`. */
  linkedSummonId?: Id;
}

function offensiveStatFor(source: Actor, isMagic: boolean | undefined): number {
  if (isMagic && (isCharacter(source) || isSummon(source))) return source.magicPower;
  return source.attack;
}

export function mitigatedOffense(off: number, def: number): number {
  return off - off * (def / (BALANCE.combat.defenseMitigationX + def)) - def / BALANCE.combat.defenseMitigationY;
}

/** Resist/weak only ever applies to a Monster target — a Character is never affected, per this
 *  feature's design (see docs/superpowers/specs/2026-09-16-monster-race-damage-scaling-design.md,
 *  Design invariant 2). Returns 1 (no-op) for anything that isn't a Monster. */
function raceMultiplierFor(target: Actor, damageType: DamageType): number {
  if (!isMonster(target)) return 1;
  const profile = resolveRaceProfile(target.race, target.subRace, target.traitIds ?? []);
  const resist = profile.resistPercent[damageType];
  const weak = profile.weakPercent[damageType];
  return (1 - resist / 100) * (1 + weak / 100);
}

export function resolveSkillEffect(effect: SkillEffect, source: Actor, target: Actor, ctx: ResolveContext): number {
  switch (effect.kind) {
    case "damage": {
      const isSelfTick = source === target;
      const effectiveDefense = target.defense * (1 - (effect.ignoreDefensePercent ?? 0) / 100);
      const critMultiplier = !isSelfTick && ctx.isCrit ? (effect.critMultiplierPercent ?? BALANCE.combat.defaultCritMultiplierPercent) / 100 : 1;
      const stacks = effect.scalesWithStatusStacks
        ? target.activeStatusEffects.find((s) => s.statusEffectId === effect.scalesWithStatusStacks!.statusEffectId)?.stacks ?? 0
        : 0;
      const stackOffenseBonusPercent = effect.scalesWithStatusStacks ? stacks * effect.scalesWithStatusStacks.percentPerStack : 0;
      const offenseMultiplier = ((effect.offenseMultiplierPercent ?? 100) + stackOffenseBonusPercent) / 100;
      const isExecuteTarget =
        !isSelfTick && ctx.executeBonus !== undefined && target.hp / target.maxHp < ctx.executeBonus.hpPercentThreshold / 100;
      const executeMultiplier = isExecuteTarget && ctx.executeBonus?.bonusDamagePercent ? 1 + ctx.executeBonus.bonusDamagePercent / 100 : 1;
      const executeFlat = isExecuteTarget ? ctx.executeBonus?.bonusDamageFlat ?? 0 : 0;
      const bonusMultiplier = !isSelfTick && ctx.bonusDamagePercent ? 1 + ctx.bonusDamagePercent / 100 : 1;
      const raceMultiplier = raceMultiplierFor(target, effect.damageType ?? "physical");
      const rawDamage = isSelfTick
        ? Math.round((effect.amount ?? 0) * raceMultiplier)
        : Math.round(
            ((effect.amount ?? 0) +
              executeFlat +
              mitigatedOffense((ctx.offensiveStatOverride ?? offensiveStatFor(source, ctx.isMagic)) * offenseMultiplier, effectiveDefense)) *
              damageMultiplierFor(source) *
              critMultiplier *
              executeMultiplier *
              bonusMultiplier *
              raceMultiplier
          );
      const finalDamage = raceMultiplier === 0 ? 0 : Math.max(1, rawDamage);
      target.hp = Math.max(0, target.hp - finalDamage);
      const sourceLabel = isSelfTick && ctx.statusEffectName ? ctx.statusEffectName : nameOf(source);
      const isCrit = !isSelfTick && ctx.isCrit;
      const damageText =
        !isSelfTick && ctx.skillName
          ? t(isCrit ? "resolver.damageWithSkillCrit" : "resolver.damageWithSkill", { target: nameOf(target), amount: finalDamage, source: sourceLabel, skill: ctx.skillName })
          : t(isCrit ? "resolver.damageCrit" : "resolver.damage", { target: nameOf(target), amount: finalDamage, source: sourceLabel });
      ctx.log.push({ text: damageText, kind: "attack" });
      if (target.hp <= 0 && isCharacter(target)) target.isAlive = false;
      if (target.hp <= 0) ctx.log.push({ text: t("resolver.defeated", { target: nameOf(target) }), kind: "death" });
      if (!isSelfTick && effect.lifestealPercent) {
        const healed = Math.min(source.maxHp - source.hp, Math.round(finalDamage * (effect.lifestealPercent / 100)));
        if (healed > 0) {
          source.hp += healed;
          ctx.log.push({ text: t("resolver.heal", { target: nameOf(source), amount: healed }), kind: "heal" });
        }
      }
      return finalDamage;
    }
    case "heal": {
      const before = target.hp;
      const healPower =
        ctx.isMagic && (isCharacter(source) || isSummon(source)) ? source.magicPower * ((effect.offenseMultiplierPercent ?? 100) / 100) : 0;
      const acolyteBoost =
        ctx.castByOwnClassSkill && isCharacter(source) && source.classId === "acolyte"
          ? 1 + ACOLYTE_HEAL_BOOST_BY_RANK[getUnlockedPassiveRank(getClass("acolyte").passiveSkill, source.level)] / 100
          : 1;
      target.hp = Math.min(target.maxHp, target.hp + Math.round(((effect.amount ?? 0) + healPower) * acolyteBoost));
      const healed = target.hp - before;
      ctx.log.push({ text: t("resolver.heal", { target: nameOf(target), amount: healed }), kind: "heal" });
      return healed;
    }
    case "restoreMp": {
      if (!isCharacter(target)) return 0;
      const before = target.mp;
      target.mp = Math.min(target.maxMp, target.mp + (effect.amount ?? 0));
      ctx.log.push({ text: t("resolver.restoreMp", { target: nameOf(target), amount: target.mp - before }), kind: "heal" });
      return 0;
    }
    case "applyStatusEffect": {
      if (!effect.statusEffectId) return 0;
      // A status normally applies its own JSON-declared modifyCombatStat magnitude; passing
      // amount/minPercent on the *effect* here (unused by "applyStatusEffect" otherwise) overrides
      // it — needed by a passive like Mage's shred, whose 1 status id must express 3 different
      // rank magnitudes rather than needing a separate status per rank.
      const magnitudeOverride =
        effect.amount !== undefined || effect.minPercent !== undefined ? { amount: effect.amount, minPercent: effect.minPercent } : undefined;
      const linkedSummonId = effect.linksToCasterSummon ? ctx.linkedSummonId : undefined;
      applyStatusEffectToActor(target, effect.statusEffectId, effect.durationTurns, ctx, magnitudeOverride, linkedSummonId);
      for (const id of effect.alsoApplyStatusEffectIds ?? []) applyStatusEffectToActor(target, id, effect.durationTurns, ctx, magnitudeOverride, linkedSummonId);
      return 0;
    }
    case "removeStatusEffect": {
      removeStatusEffectFromActor(target, effect.statusEffectId, ctx);
      return 0;
    }
    case "modifyStat": {
      if (!effect.stat) return 0;
      if (effect.stat === "satiety") {
        if (!ctx.gameState) return 0;
        const before = ctx.gameState.satiety;
        ctx.gameState.satiety = clamp(before + (effect.amount ?? 0), 0, 100);
        const delta = ctx.gameState.satiety - before;
        if (delta !== 0) {
          const verb = delta < 0 ? t("resolver.verbDecrease") : t("resolver.verbIncrease");
          ctx.log.push({
            text: t("resolver.statChange", { target: t("resolver.partyTarget"), verb, amount: Math.abs(delta), stat: t("resolver.statLabelSatiety") }),
            kind: delta < 0 ? "debuff" : "buff",
          });
        }
        return 0;
      }
      if (!isCharacter(target)) return 0;
      const before = target.survival[effect.stat];
      target.survival[effect.stat] = clamp(before + (effect.amount ?? 0), 0, 100);
      const delta = target.survival[effect.stat] - before;
      if (delta !== 0) {
        const verb = delta < 0 ? t("resolver.verbDecrease") : t("resolver.verbIncrease");
        ctx.log.push({
          text: t("resolver.statChange", { target: nameOf(target), verb, amount: Math.abs(delta), stat: SURVIVAL_STAT_LABEL[effect.stat] }),
          kind: delta < 0 ? "buff" : "debuff",
        });
      }
      return 0;
    }
    case "modifyCombatStat": {
      if (!effect.combatStat) return 0;
      const delta = computeCombatStatDelta(target, effect);
      applyCombatStatDelta(target, effect.combatStat, delta);
      if (delta !== 0) {
        const verb = delta < 0 ? t("resolver.verbDecrease") : t("resolver.verbIncrease");
        ctx.log.push({
          text: t("resolver.statChange", { target: nameOf(target), verb, amount: Math.abs(delta), stat: COMBAT_STAT_LABEL[effect.combatStat] }),
          kind: delta < 0 ? "debuff" : "buff",
        });
      }
      return 0;
    }
    case "summon": {
      // Spawning a combatant needs CombatState/EngineContext (to register it in `combat.combatants`
      // and `ctx.summons`), which this function doesn't have — `applySkillEffects` (combat.ts)
      // intercepts a "summon" effect before it ever reaches here.
      return 0;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nameOf(actor: Actor): string {
  return actor.name;
}

/** `amount`/`minPercent` override the status's own JSON-declared magnitude for every modifyCombatStat
 *  perTurnEffect it has — see the "applyStatusEffect" case in resolveSkillEffect. */
interface StatusMagnitudeOverride {
  amount?: number;
  minPercent?: number;
}

function modifyCombatStatEffects(def: StatusEffectDefinition, override: StatusMagnitudeOverride | undefined): SkillEffect[] {
  return def.perTurnEffects
    .filter((e) => e.kind === "modifyCombatStat" && e.combatStat)
    .map((e) => (override ? { ...e, amount: override.amount ?? e.amount, minPercent: override.minPercent ?? e.minPercent } : e));
}

function applyStatusEffectToActor(
  actor: Actor,
  statusEffectId: string,
  durationTurns: number | undefined,
  ctx: ResolveContext,
  magnitudeOverride?: StatusMagnitudeOverride,
  linkedSummonId?: Id
): void {
  const def = getStatusEffect(statusEffectId);
  const statEffects = modifyCombatStatEffects(def, magnitudeOverride);
  const existingIndex = actor.activeStatusEffects.findIndex((s) => s.statusEffectId === statusEffectId);
  if (existingIndex !== -1) {
    // Replaced, not mutated in place: a fresh object identity keeps a refreshed "special" status out of
    // the eligibility snapshot tickSpecialEffects checks (see specialStatusSnapshot), so re-casting an
    // active special status doesn't lose a tick to the very turn that refreshed it — same as a first cast.
    const existing = actor.activeStatusEffects[existingIndex]!;
    const stackedBefore = existing.stacks ?? 1;
    const stackedAfter = def.stackable ? Math.min(def.maxStacks ?? 1, stackedBefore + 1) : existing.stacks;
    const gainedANewStack = def.stackable && stackedAfter !== undefined && stackedAfter > stackedBefore;
    const appliedAmounts = { ...existing.appliedAmounts };
    if (gainedANewStack) {
      // A fresh, independent delta for this new stack — computed against the actor's CURRENT stat
      // value, then accumulated on top of whatever earlier stacks already applied (not overwritten),
      // so expireStatusEffect's undo still unwinds the correct running total.
      for (const e of statEffects) {
        const delta = computeCombatStatDelta(actor, e);
        applyCombatStatDelta(actor, e.combatStat!, delta);
        appliedAmounts[e.combatStat!] = (appliedAmounts[e.combatStat!] ?? 0) + delta;
      }
    }
    actor.activeStatusEffects[existingIndex] = {
      statusEffectId,
      turnsRemaining: durationTurns ?? existing.turnsRemaining,
      stacks: stackedAfter,
      appliedAmounts,
      linkedSummonId: linkedSummonId ?? existing.linkedSummonId,
    };
    // A stackable status that actually gained a stack gets its own message — otherwise a Bleeding
    // reapply always logged "refreshes", even while its stack count (and tick damage) was climbing,
    // making the stacking mechanic invisible to the player.
    ctx.log.push({
      text: gainedANewStack
        ? t("resolver.statusStack", { actor: nameOf(actor), effect: statusDisplayName(def), stacks: stackedAfter })
        : t("resolver.statusRefresh", { actor: nameOf(actor), effect: statusDisplayName(def) }),
      kind: isHelpfulStatusEffect(def) ? "buff" : "debuff",
    });
    return;
  }
  // Computed before any delta is applied, so a status with 2+ modifyCombatStat entries (e.g. storm-recoil's
  // defense debuff + aggro buff) never has one entry's own delta bleed into another's minPercent floor.
  const appliedAmounts: Partial<Record<CombatStat, number>> = {};
  for (const e of statEffects) appliedAmounts[e.combatStat!] = computeCombatStatDelta(actor, e);
  const entry: ActiveStatusEffect = {
    statusEffectId,
    turnsRemaining: durationTurns ?? 1,
    stacks: def.stackable ? 1 : undefined,
    appliedAmounts,
    linkedSummonId,
  };
  actor.activeStatusEffects.push(entry);
  for (const e of statEffects) applyCombatStatDelta(actor, e.combatStat!, appliedAmounts[e.combatStat!]!);
  ctx.log.push({ text: t("resolver.statusApply", { actor: nameOf(actor), effect: statusDisplayName(def) }), kind: isHelpfulStatusEffect(def) ? "buff" : "debuff" });
}

function removeStatusEffectFromActor(actor: Actor, statusEffectId: string | undefined, ctx: ResolveContext): void {
  // Every no-id use in data/classes.json is a "cleanse 1 debuff" effect (appliesToRelation: "ally") —
  // the target is specifically the first harmful status, never just whatever sits at index 0. If the
  // actor is carrying no debuff at all, there is nothing for this effect to do; falling back to index
  // 0 would strip a helpful buff instead, which no skill in the data intends.
  const target = statusEffectId
    ? actor.activeStatusEffects.find((s) => s.statusEffectId === statusEffectId)
    : actor.activeStatusEffects.find((s) => !isHelpfulStatusEffect(getStatusEffect(s.statusEffectId)));
  if (!target) return;
  expireStatusEffect(actor, target, ctx);
}

export function expireStatusEffect(actor: Actor, active: ActiveStatusEffect, ctx: ResolveContext): void {
  const def = getStatusEffect(active.statusEffectId);
  for (const e of def.perTurnEffects) {
    if (e.kind === "modifyCombatStat" && e.combatStat) {
      // Undoes the exact value stored at apply time, not a fresh recompute — the actor's stat may
      // have moved since (e.g. a 2nd, unrelated buff/debuff on the same stat), which would make a
      // recomputed minPercent floor disagree with what was actually added.
      applyCombatStatDelta(actor, e.combatStat, -(active.appliedAmounts?.[e.combatStat] ?? e.amount ?? 0));
    }
  }
  actor.activeStatusEffects = actor.activeStatusEffects.filter((s) => s !== active);
  ctx.log.push({ text: t("resolver.statusExpire", { actor: nameOf(actor), effect: statusDisplayName(def) }), kind: "info" });
}

function vulnerabilityMultiplier(actor: Actor, statusEffectId: string): number {
  let multiplier = 1;
  for (const active of actor.activeStatusEffects) {
    const def = getStatusEffect(active.statusEffectId);
    if (def.vulnerableTo?.statusEffectId === statusEffectId) multiplier *= def.vulnerableTo.multiplier;
  }
  return multiplier;
}

/**
 * Every active-status-effect entry currently on `actor` whose category is "special" — used to
 * snapshot which ones existed *before* this actor's own turn runs, so tickSpecialEffects can tell
 * "already active" from "just applied (or refreshed) by this very turn" without a per-status flag.
 * Tracked by object identity, not statusEffectId: a refresh replaces the entry's identity (see
 * applyStatusEffectToActor), so a status re-cast on its own actor's turn falls out of this snapshot
 * exactly like a first cast would.
 */
export function specialStatusSnapshot(actor: Actor): ReadonlySet<ActiveStatusEffect> {
  return new Set(actor.activeStatusEffects.filter((s) => statusCategory(getStatusEffect(s.statusEffectId)) === "special"));
}

/** Shared tail for every tick path: decrement, then expire once it runs out. */
function decrementAndMaybeExpire(actor: Actor, active: ActiveStatusEffect, ctx: ResolveContext): void {
  active.turnsRemaining -= 1;
  if (active.turnsRemaining <= 0) {
    expireStatusEffect(actor, active, ctx);
  }
}

/** Shared by tickDotEffects/tickStatModEffects — both always tick everything of their category. */
function tickCategoryUnconditionally(actor: Actor, category: "dot" | "statMod", ctx: ResolveContext): void {
  for (const active of [...actor.activeStatusEffects]) {
    const def = getStatusEffect(active.statusEffectId);
    if (statusCategory(def) !== category) continue;
    if (category === "dot") {
      for (const e of def.perTurnEffects) {
        if (e.kind !== "damage" && e.kind !== "heal" && e.kind !== "restoreMp") continue;
        let amount = e.amount ?? 0;
        if (e.kind === "damage") {
          if (e.maxHpPercent) amount += (actor.maxHp * e.maxHpPercent) / 100;
          if (def.stackable) amount *= 1 + ((active.stacks ?? 1) - 1) * ((def.perStackBonusPercent ?? 0) / 100);
          if (isMonster(actor) && (actor.tier === "elite" || actor.tier === "boss")) amount *= 0.8;
          amount *= vulnerabilityMultiplier(actor, active.statusEffectId);
        }
        const effectToApply = { ...e, amount, maxHpPercent: undefined };
        resolveSkillEffect(effectToApply, actor, actor, { log: ctx.log, statusEffectName: statusDisplayName(def) });
      }
      if (!isActorAlive(actor)) continue;
    }
    decrementAndMaybeExpire(actor, active, ctx);
  }
}

/**
 * Called once at the very start of resolveRound, before any actions this round. A DoT/HoT applied
 * *during* this round can't have existed yet when this round's start-tick ran, so it's naturally
 * untouched until the following round's start-tick — a free round with no bookkeeping needed.
 */
export function tickDotEffects(actor: Actor, ctx: ResolveContext): void {
  tickCategoryUnconditionally(actor, "dot", ctx);
}

/**
 * Called once at the end of resolveRound, for every combatant, unconditionally. A fresh stat
 * modifier ticks down the instant the round it was cast in ends — no free round.
 */
export function tickStatModEffects(actor: Actor, ctx: ResolveContext): void {
  tickCategoryUnconditionally(actor, "statMod", ctx);
}

/**
 * Called once per combatant, immediately after resolveRound processes that combatant's own turn
 * (whether they acted, fizzled, or were skipped for being stunned) — only for statuses present in
 * `eligible` (a snapshot taken *before* that turn ran, via specialStatusSnapshot). Skipping anything
 * not in that snapshot is what stops a status from ticking on the very turn that applied (or
 * refreshed) it — e.g. a self-cast buff's own casting action must not count as its first "turn used".
 * Because each combatant gets exactly one turn per round, this alone reproduces the full range of
 * expected timing: a self-cast status (the casting action IS this round's turn) starts ticking next
 * round; a status inflicted on a slower target who hasn't acted yet this round — already present
 * before their own turn runs — ticks as soon as that still-pending turn resolves, later in this same
 * round.
 */
export function tickSpecialEffects(actor: Actor, eligible: ReadonlySet<ActiveStatusEffect>, ctx: ResolveContext): void {
  for (const active of [...actor.activeStatusEffects]) {
    const def = getStatusEffect(active.statusEffectId);
    if (statusCategory(def) !== "special") continue;
    if (!eligible.has(active)) continue;
    decrementAndMaybeExpire(actor, active, ctx);
  }
}
