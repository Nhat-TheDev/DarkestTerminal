import type { Character, GameState, LogEntry } from "../types";
import { fearResistMultiplier } from "./artifacts";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";
import { CAMP_KIT_ITEM_ID } from "../data/items";
import { getStatusEffect } from "../data/statusEffects";

export const SATIETY_DRAIN_COMBAT = BALANCE.survival.satietyDrainCombat;
export const SATIETY_DRAIN_EVENT = BALANCE.survival.satietyDrainEvent;
const EXHAUSTED_THRESHOLD = BALANCE.survival.exhaustedThreshold;
const EXHAUSTED_STAT_MULTIPLIER = BALANCE.survival.exhaustedStatMultiplier;
const DYING_THRESHOLD = BALANCE.survival.dyingThreshold;
const DYING_DAMAGE_PER_ROUND = BALANCE.survival.dyingDamagePerRound;
const EAT_DRINK_RESTORE_FRACTION = BALANCE.survival.eatDrinkRestoreFraction;
const EAT_DRINK_SATIETY_RESTORE = BALANCE.survival.eatDrinkSatietyRestore;
const CAMP_SATIETY_RESTORE = BALANCE.survival.campSatietyRestore;
const CHAT_RESTORE_FRACTION = BALANCE.survival.chatRestoreFraction;
const CHAT_FEAR_RELIEF = BALANCE.survival.chatFearRelief;

const FEAR_PER_ROUND_BASE = BALANCE.survival.fearPerRoundBase;
const FEAR_PER_ROUND_LOW_HP = BALANCE.survival.fearPerRoundLowHp;
const FEAR_PER_ROUND_BASE_CAP = BALANCE.survival.fearPerRoundBaseCap;
const FEAR_PER_ROUND_LOW_HP_CAP = BALANCE.survival.fearPerRoundLowHpCap;
const FEAR_PER_ROUND_DEPTH_GROWTH = BALANCE.survival.fearPerRoundDepthGrowth;
const FEAR_LOW_HP_THRESHOLD_FRACTION = BALANCE.survival.fearLowHpThresholdFraction;
const FEAR_PER_HIT_TAKEN = BALANCE.survival.fearPerHitTaken;
const FEAR_PER_HIT_TAKEN_CAP = BALANCE.survival.fearPerHitTakenCap;
const FEAR_VICTORY_RELIEF = BALANCE.survival.fearVictoryRelief;
const FEAR_VICTORY_RELIEF_QUICK = BALANCE.survival.fearVictoryReliefQuick;
const FEAR_QUICK_VICTORY_ROUND_THRESHOLD = BALANCE.survival.fearQuickVictoryRoundThreshold;
const FEAR_ELITE_OR_BOSS_VICTORY_RELIEF = BALANCE.survival.fearEliteOrBossVictoryRelief;
const FEAR_ELITE_OR_BOSS_VICTORY_RELIEF_QUICK = BALANCE.survival.fearEliteOrBossVictoryReliefQuick;
const FEAR_ELITE_OR_BOSS_QUICK_VICTORY_ROUND_THRESHOLD = BALANCE.survival.fearEliteOrBossQuickVictoryRoundThreshold;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isPartyExhausted(satiety: number): boolean {
  return satiety <= EXHAUSTED_THRESHOLD;
}

export function isPartyDying(satiety: number): boolean {
  return satiety <= DYING_THRESHOLD;
}

export function applyExhaustedMultiplier(baseStat: number, satiety: number): number {
  return isPartyExhausted(satiety) ? Math.round(baseStat * EXHAUSTED_STAT_MULTIPLIER) : baseStat;
}

export function drainSatiety(state: GameState, amount: number, log: LogEntry[]): void {
  if (amount <= 0) return;
  state.satiety = clamp(state.satiety - amount, 0, 100);
  log.push({ text: t("survival.satietyDrained", { satiety: state.satiety }), kind: "debuff" });
}

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

/** One decimal place, so a small gain still shows its fearResist reduction. */
export function roundFear(value: number): number {
  return Math.round(value * 10) / 10;
}

export function formatFear(value: number): string {
  return String(roundFear(value));
}

/** The share of a fear gain a character's statuses let through (`fearResistPercent`, each one combined multiplicatively). */
function statusFearResistMultiplier(character: Character): number {
  return character.activeStatusEffects.reduce((mult, s) => mult * (1 - Math.min(100, getStatusEffect(s.statusEffectId).fearResistPercent ?? 0) / 100), 1);
}

export function resistedFearGain(character: Character, amount: number): number {
  return roundFear(amount * fearResistMultiplier(character) * statusFearResistMultiplier(character));
}

/** The one place fear is written. Returns the change actually made. */
export function adjustFear(character: Character, delta: number): number {
  const before = character.survival.fear;
  character.survival.fear = roundFear(clamp(before + delta, 0, 100));
  return roundFear(character.survival.fear - before);
}

function scaledFearGain(character: Character, base: number, cap: number, floorDepth: number): number {
  const growthMultiplier = 1 + FEAR_PER_ROUND_DEPTH_GROWTH * (floorDepth - 1);
  const scaled = Math.min(base * growthMultiplier, cap);
  return scaled > 0 ? resistedFearGain(character, scaled) : roundFear(scaled);
}

export function fearGainForRound(character: Character, floorDepth: number): number {
  const isLowHp = character.hp < character.maxHp * FEAR_LOW_HP_THRESHOLD_FRACTION;
  return isLowHp
    ? scaledFearGain(character, FEAR_PER_ROUND_LOW_HP, FEAR_PER_ROUND_LOW_HP_CAP, floorDepth)
    : scaledFearGain(character, FEAR_PER_ROUND_BASE, FEAR_PER_ROUND_BASE_CAP, floorDepth);
}

export function fearGainForHit(character: Character, floorDepth: number): number {
  return scaledFearGain(character, FEAR_PER_HIT_TAKEN, FEAR_PER_HIT_TAKEN_CAP, floorDepth);
}

export function applyRoundFear(character: Character, floorDepth: number): number {
  return character.isAlive ? adjustFear(character, fearGainForRound(character, floorDepth)) : 0;
}

export function applyHitFear(character: Character, floorDepth: number): number {
  return character.isAlive ? adjustFear(character, fearGainForHit(character, floorDepth)) : 0;
}

export function applyVictoryFearRelief(party: Character[], isEliteOrBossFight: boolean, roundNumber: number): Character[] {
  const relief = isEliteOrBossFight
    ? roundNumber < FEAR_ELITE_OR_BOSS_QUICK_VICTORY_ROUND_THRESHOLD
      ? FEAR_ELITE_OR_BOSS_VICTORY_RELIEF_QUICK
      : FEAR_ELITE_OR_BOSS_VICTORY_RELIEF
    : roundNumber < FEAR_QUICK_VICTORY_ROUND_THRESHOLD
      ? FEAR_VICTORY_RELIEF_QUICK
      : FEAR_VICTORY_RELIEF;
  return party.filter((c) => c.isAlive && adjustFear(c, -relief) !== 0);
}

/** Satiety is party-wide: restore it once via `restEatDrinkSatiety`. */
export function restEatDrink(character: Character): void {
  if (!character.isAlive) return;
  character.hp = clamp(character.hp + Math.round(character.maxHp * EAT_DRINK_RESTORE_FRACTION), 0, character.maxHp);
  character.mp = clamp(character.mp + Math.round(character.maxMp * EAT_DRINK_RESTORE_FRACTION), 0, character.maxMp);
}

export function restEatDrinkSatiety(state: GameState): void {
  state.satiety = clamp(state.satiety + EAT_DRINK_SATIETY_RESTORE, 0, 100);
}

export function restChat(character: Character): void {
  if (!character.isAlive) return;
  character.hp = clamp(character.hp + Math.round(character.maxHp * CHAT_RESTORE_FRACTION), 0, character.maxHp);
  character.mp = clamp(character.mp + Math.round(character.maxMp * CHAT_RESTORE_FRACTION), 0, character.maxMp);
  adjustFear(character, -CHAT_FEAR_RELIEF);
}

export function campAction(state: GameState): { reason: string } | null {
  const kits = state.inventory[CAMP_KIT_ITEM_ID] ?? 0;
  if (kits <= 0) return { reason: t("errors.noExplorationKits") };
  state.inventory[CAMP_KIT_ITEM_ID] = kits - 1;
  state.satiety = clamp(state.satiety + CAMP_SATIETY_RESTORE, 0, 100);
  state.message = t("game.campUsed");
  return null;
}
