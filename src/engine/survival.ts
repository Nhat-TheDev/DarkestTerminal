import type { Character } from "../types";

// docs/gameplay-decisions.md §3.
const HUNGER_DRAIN_PER_ACTION = 1;
const THIRST_DRAIN_PER_ACTION = 1.5;
const STARVATION_DAMAGE_PERCENT = 0.02;
const REST_FEAR_RELIEF = 30;

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

/** Resting fully restores HP/MP/hunger/thirst and relieves (not zeroes) fear. */
export function restCharacter(character: Character): void {
  if (!character.isAlive) return;
  character.hp = character.maxHp;
  character.mp = character.maxMp;
  character.survival.hunger = 100;
  character.survival.thirst = 100;
  character.survival.fear = clamp(character.survival.fear - REST_FEAR_RELIEF, 0, 100);
}
