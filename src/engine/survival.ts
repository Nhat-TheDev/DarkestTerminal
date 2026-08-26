import type { Character, GameState, LogEntry } from "../types";
import { fearResistMultiplier } from "./artifacts";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";

export const SATIETY_DRAIN_COMBAT = BALANCE.survival.satietyDrainCombat;
export const SATIETY_DRAIN_EVENT = BALANCE.survival.satietyDrainEvent;
const EXHAUSTED_THRESHOLD = BALANCE.survival.exhaustedThreshold;
const EXHAUSTED_STAT_MULTIPLIER = BALANCE.survival.exhaustedStatMultiplier;
const DYING_THRESHOLD = BALANCE.survival.dyingThreshold;
const DYING_DAMAGE_PER_ROUND = BALANCE.survival.dyingDamagePerRound;
const EAT_DRINK_RESTORE_PERCENT = BALANCE.survival.eatDrinkRestorePercent;
const EAT_DRINK_SATIETY_RESTORE = BALANCE.survival.eatDrinkSatietyRestore;
const CAMP_SATIETY_RESTORE = BALANCE.survival.campSatietyRestore;
const CHAT_RESTORE_PERCENT = BALANCE.survival.chatRestorePercent;
const CHAT_FEAR_RELIEF = BALANCE.survival.chatFearRelief;

const FEAR_PER_ROUND_BASE = BALANCE.survival.fearPerRoundBase;
const FEAR_PER_ROUND_LOW_HP = BALANCE.survival.fearPerRoundLowHp;
const FEAR_PER_ROUND_BASE_CAP = BALANCE.survival.fearPerRoundBaseCap;
const FEAR_PER_ROUND_LOW_HP_CAP = BALANCE.survival.fearPerRoundLowHpCap;
const FEAR_PER_ROUND_DEPTH_GROWTH = BALANCE.survival.fearPerRoundDepthGrowth;
const FEAR_LOW_HP_THRESHOLD_PERCENT = BALANCE.survival.fearLowHpThresholdPercent;
const FEAR_VICTORY_RELIEF = BALANCE.survival.fearVictoryRelief;
const FEAR_VICTORY_RELIEF_QUICK = BALANCE.survival.fearVictoryReliefQuick;
const FEAR_QUICK_VICTORY_ROUND_THRESHOLD = BALANCE.survival.fearQuickVictoryRoundThreshold;
const FEAR_ELITE_OR_BOSS_VICTORY_RELIEF = BALANCE.survival.fearEliteOrBossVictoryRelief;
const FEAR_ELITE_OR_BOSS_VICTORY_RELIEF_QUICK = BALANCE.survival.fearEliteOrBossVictoryReliefQuick;
const FEAR_ELITE_OR_BOSS_QUICK_VICTORY_ROUND_THRESHOLD = BALANCE.survival.fearEliteOrBossQuickVictoryRoundThreshold;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** C.3 — live-computed, not a stored status effect (mirrors getFearTier). */
export function isPartyExhausted(satiety: number): boolean {
  return satiety <= EXHAUSTED_THRESHOLD;
}

/** C.4 — live-computed; stacks with Exhausted below the Dying threshold. */
export function isPartyDying(satiety: number): boolean {
  return satiety <= DYING_THRESHOLD;
}

/** Applied to a character's own base stat, before artifact `statBoost` is added on top (maxHp/maxMp are never touched). */
export function applyExhaustedMultiplier(baseStat: number, satiety: number): number {
  return isPartyExhausted(satiety) ? Math.round(baseStat * EXHAUSTED_STAT_MULTIPLIER) : baseStat;
}

/**
 * C.2 (amended) — satiety drains by room type: combat rooms and combat-triggering events cost
 * SATIETY_DRAIN_COMBAT (10), non-combat events cost SATIETY_DRAIN_EVENT (5), the Rest room costs
 * nothing (0 — call sites simply don't call this for a Rest room at all).
 */
export function drainSatiety(state: GameState, amount: number, log: LogEntry[]): void {
  if (amount <= 0) return;
  state.satiety = clamp(state.satiety - amount, 0, 100);
  log.push({ text: t("survival.satietyDrained", { satiety: state.satiety }), kind: "debuff" });
}

/** C.4 DOT — mirrors Poisoned II's tick, applied once per combat round while Dying. */
export function applyDyingDamage(party: Character[], log: LogEntry[]): void {
  for (const c of party) {
    if (!c.isAlive) continue;
    c.hp = Math.max(0, c.hp - DYING_DAMAGE_PER_ROUND);
    log.push({ text: t("survival.dyingTick", { name: c.name, damage: DYING_DAMAGE_PER_ROUND }), kind: "debuff" });
    if (c.hp <= 0) {
      c.isAlive = false;
      log.push({ text: t("survival.collapsed", { name: c.name }), kind: "death" });
    }
  }
}

export function fearGainForRound(character: Character, floorDepth: number): number {
  const isLowHp = character.hp < character.maxHp * FEAR_LOW_HP_THRESHOLD_PERCENT;
  const base = isLowHp ? FEAR_PER_ROUND_LOW_HP : FEAR_PER_ROUND_BASE;
  const cap = isLowHp ? FEAR_PER_ROUND_LOW_HP_CAP : FEAR_PER_ROUND_BASE_CAP;
  const growthMultiplier = 1 + FEAR_PER_ROUND_DEPTH_GROWTH * (floorDepth - 1);
  const scaled = Math.min(base * growthMultiplier, cap);
  return Math.round(scaled * fearResistMultiplier(character));
}

export function applyRoundFear(character: Character, floorDepth: number): void {
  if (!character.isAlive) return;
  character.survival.fear = clamp(character.survival.fear + fearGainForRound(character, floorDepth), 0, 100);
}

/** D — relief also depends on how fast the fight was won (`roundNumber` at the moment of victory). Quick-win and normal relief are not additive with each other, same as Elite/Boss relief vs. regular. */
export function applyVictoryFearRelief(party: Character[], isEliteOrBossFight: boolean, roundNumber: number): void {
  const relief = isEliteOrBossFight
    ? roundNumber < FEAR_ELITE_OR_BOSS_QUICK_VICTORY_ROUND_THRESHOLD
      ? FEAR_ELITE_OR_BOSS_VICTORY_RELIEF_QUICK
      : FEAR_ELITE_OR_BOSS_VICTORY_RELIEF
    : roundNumber < FEAR_QUICK_VICTORY_ROUND_THRESHOLD
      ? FEAR_VICTORY_RELIEF_QUICK
      : FEAR_VICTORY_RELIEF;
  for (const c of party) {
    if (!c.isAlive) continue;
    c.survival.fear = clamp(c.survival.fear - relief, 0, 100);
  }
}

/** Rest room "Eat & Drink": restores each character's HP/MP. Satiety is party-wide — restore it once via `restEatDrinkSatiety`, not per character. */
export function restEatDrink(character: Character): void {
  if (!character.isAlive) return;
  character.hp = clamp(character.hp + Math.round(character.maxHp * EAT_DRINK_RESTORE_PERCENT), 0, character.maxHp);
  character.mp = clamp(character.mp + Math.round(character.maxMp * EAT_DRINK_RESTORE_PERCENT), 0, character.maxMp);
}

/** Rest room "Eat & Drink" — party-wide satiety restore (C.6), called once per rest action, not per character. */
export function restEatDrinkSatiety(state: GameState): void {
  state.satiety = clamp(state.satiety + EAT_DRINK_SATIETY_RESTORE, 0, 100);
}

/** Rest room "Chat" — unchanged: only hp/mp/fear, no satiety (C.6). */
export function restChat(character: Character): void {
  if (!character.isAlive) return;
  character.hp = clamp(character.hp + Math.round(character.maxHp * CHAT_RESTORE_PERCENT), 0, character.maxHp);
  character.mp = clamp(character.mp + Math.round(character.maxMp * CHAT_RESTORE_PERCENT), 0, character.maxMp);
  character.survival.fear = clamp(character.survival.fear - CHAT_FEAR_RELIEF, 0, 100);
}

/** Camp (C.5) — post-victory option, distinct from the Rest room: costs 1 Exploration Kit, +30 satiety only, no HP/MP restore. */
export function campAction(state: GameState): { reason: string } | null {
  const kits = state.inventory["exploration-kit"] ?? 0;
  if (kits <= 0) return { reason: t("errors.noExplorationKits") };
  state.inventory["exploration-kit"] = kits - 1;
  state.satiety = clamp(state.satiety + CAMP_SATIETY_RESTORE, 0, 100);
  state.message = t("game.campUsed");
  return null;
}
