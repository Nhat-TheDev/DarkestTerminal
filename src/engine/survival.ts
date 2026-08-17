import type { Character } from "../types";

// docs/gameplay-decisions.md §3.
const HUNGER_DRAIN_PER_ACTION = 1;
const THIRST_DRAIN_PER_ACTION = 1.5;
const STARVATION_DAMAGE_PERCENT = 0.02;
const EAT_DRINK_RESTORE_PERCENT = 0.5;
const CHAT_RESTORE_PERCENT = 0.1;
const CHAT_FEAR_RELIEF = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Called once per dungeon action (room move) or once per resolved combat round. */
export function tickSurvivalOnAction(character: Character, log: string[]): void {
  if (!character.isAlive) return;
  character.survival.hunger = clamp(character.survival.hunger - HUNGER_DRAIN_PER_ACTION, 0, 100);
  character.survival.thirst = clamp(character.survival.thirst - THIRST_DRAIN_PER_ACTION, 0, 100);

  let starving = 0;
  if (character.survival.hunger <= 0) starving += 1;
  if (character.survival.thirst <= 0) starving += 1;
  if (starving > 0) {
    const damage = Math.max(1, Math.round(character.maxHp * STARVATION_DAMAGE_PERCENT * starving));
    character.hp = Math.max(0, character.hp - damage);
    log.push(`${character.name} kiệt sức vì đói/khát, mất ${damage} HP.`);
    if (character.hp <= 0) {
      character.isAlive = false;
      log.push(`${character.name} đã gục ngã vì kiệt sức.`);
    }
  }
}

/** Ambient fear gain on entering a new room (docs/gameplay-decisions.md §3). */
export function applyAmbientFear(character: Character, darknessLevel: number): void {
  if (!character.isAlive) return;
  character.survival.fear = clamp(character.survival.fear + darknessLevel, 0, 100);
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
