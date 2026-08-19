import type { Character, LogEntry } from "../types";
import { fearResistMultiplier, survivalDrainMultiplier } from "./artifacts";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";

// docs/gameplay-decisions.md §3. Values: data/balance-config.json BALANCE.survival.*.
const HUNGER_DRAIN_PER_ACTION = BALANCE.survival.hungerDrainPerAction;
const THIRST_DRAIN_PER_ACTION = BALANCE.survival.thirstDrainPerAction;
const STARVATION_DAMAGE_PERCENT = BALANCE.survival.starvationDamagePercent;
const EAT_DRINK_RESTORE_PERCENT = BALANCE.survival.eatDrinkRestorePercent;
const CHAT_RESTORE_PERCENT = BALANCE.survival.chatRestorePercent;
const CHAT_FEAR_RELIEF = BALANCE.survival.chatFearRelief;

// Round-based combat fear (docs/gameplay-decisions/03-survival-stats.md §3).
const FEAR_PER_ROUND_BASE = BALANCE.survival.fearPerRoundBase;
const FEAR_PER_ROUND_LOW_HP = BALANCE.survival.fearPerRoundLowHp;
const FEAR_PER_ROUND_BASE_CAP = BALANCE.survival.fearPerRoundBaseCap;
const FEAR_PER_ROUND_LOW_HP_CAP = BALANCE.survival.fearPerRoundLowHpCap;
/** +5%/floor depth, compounding from depth 1 = base (no bonus yet) — same convention as monster stat scaling. */
const FEAR_PER_ROUND_DEPTH_GROWTH = BALANCE.survival.fearPerRoundDepthGrowth;
const FEAR_LOW_HP_THRESHOLD_PERCENT = BALANCE.survival.fearLowHpThresholdPercent;
const FEAR_VICTORY_RELIEF = BALANCE.survival.fearVictoryRelief;
const FEAR_ELITE_OR_BOSS_VICTORY_RELIEF = BALANCE.survival.fearEliteOrBossVictoryRelief;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Called once per dungeon action (room move) or once per resolved combat round. */
export function tickSurvivalOnAction(character: Character, log: LogEntry[]): void {
  if (!character.isAlive) return;
  // docs/gameplay-decisions/07-items-artifacts.md §7.2 — survivalDrainReduction artifacts, rounded to 1 decimal.
  const drainMultiplier = survivalDrainMultiplier(character);
  const hungerDrain = Math.round(HUNGER_DRAIN_PER_ACTION * drainMultiplier * 10) / 10;
  const thirstDrain = Math.round(THIRST_DRAIN_PER_ACTION * drainMultiplier * 10) / 10;
  character.survival.hunger = clamp(character.survival.hunger - hungerDrain, 0, 100);
  character.survival.thirst = clamp(character.survival.thirst - thirstDrain, 0, 100);

  let starving = 0;
  if (character.survival.hunger <= 0) starving += 1;
  if (character.survival.thirst <= 0) starving += 1;
  if (starving > 0) {
    const damage = Math.max(1, Math.round(character.maxHp * STARVATION_DAMAGE_PERCENT * starving));
    character.hp = Math.max(0, character.hp - damage);
    log.push({ text: t("survival.starving", { name: character.name, damage }), kind: "debuff" });
    if (character.hp <= 0) {
      character.isAlive = false;
      log.push({ text: t("survival.collapsed", { name: character.name }), kind: "death" });
    }
  }
}

/**
 * Fear gained for surviving 1 combat round that didn't end the fight
 * (docs/gameplay-decisions/03-survival-stats.md §3) — a character below 60%
 * HP uses the higher low-HP amount *instead of* the base amount (not
 * additive). Both amounts scale +5%/floor depth with their own cap, then get
 * reduced by fearResist artifacts (docs/gameplay-decisions/07-items-artifacts.md §7.2).
 */
export function fearGainForRound(character: Character, floorDepth: number): number {
  const isLowHp = character.hp < character.maxHp * FEAR_LOW_HP_THRESHOLD_PERCENT;
  const base = isLowHp ? FEAR_PER_ROUND_LOW_HP : FEAR_PER_ROUND_BASE;
  const cap = isLowHp ? FEAR_PER_ROUND_LOW_HP_CAP : FEAR_PER_ROUND_BASE_CAP;
  const growthMultiplier = 1 + FEAR_PER_ROUND_DEPTH_GROWTH * (floorDepth - 1);
  const scaled = Math.min(base * growthMultiplier, cap);
  return Math.round(scaled * fearResistMultiplier(character));
}

/** Applies fearGainForRound to 1 living character — called once per combat round that didn't end the fight. */
export function applyRoundFear(character: Character, floorDepth: number): void {
  if (!character.isAlive) return;
  character.survival.fear = clamp(character.survival.fear + fearGainForRound(character, floorDepth), 0, 100);
}

/**
 * Team-wide fear relief after winning a fight (docs/gameplay-decisions/03-survival-stats.md
 * §3) — beating an Elite or Boss uses its own larger relief instead of
 * stacking with the normal one.
 */
export function applyVictoryFearRelief(party: Character[], isEliteOrBossFight: boolean): void {
  const relief = isEliteOrBossFight ? FEAR_ELITE_OR_BOSS_VICTORY_RELIEF : FEAR_VICTORY_RELIEF;
  for (const c of party) {
    if (!c.isAlive) continue;
    c.survival.fear = clamp(c.survival.fear - relief, 0, 100);
  }
}

/** Rest room option "Ăn uống": restores 50% of max HP/MP. */
export function restEatDrink(character: Character): void {
  if (!character.isAlive) return;
  character.hp = clamp(character.hp + Math.round(character.maxHp * EAT_DRINK_RESTORE_PERCENT), 0, character.maxHp);
  character.mp = clamp(character.mp + Math.round(character.maxMp * EAT_DRINK_RESTORE_PERCENT), 0, character.maxMp);
}

/** Rest room option "Trò chuyện": restores 10% of max HP/MP and relieves fear. */
export function restChat(character: Character): void {
  if (!character.isAlive) return;
  character.hp = clamp(character.hp + Math.round(character.maxHp * CHAT_RESTORE_PERCENT), 0, character.maxHp);
  character.mp = clamp(character.mp + Math.round(character.maxMp * CHAT_RESTORE_PERCENT), 0, character.maxMp);
  character.survival.fear = clamp(character.survival.fear - CHAT_FEAR_RELIEF, 0, 100);
}
