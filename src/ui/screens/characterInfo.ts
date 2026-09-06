import type { KeyEvent } from "@opentui/core";
import type { Game } from "../../engine/game";
import type { UiState } from "../state";
import { PALETTE, colorChunk, boldColorChunk, plainChunk } from "../theme";
import type { ScreenContext } from "./context";
import { getClass } from "../../data/classes";
import { getArtifact } from "../../data/artifacts";
import { getStatusEffect } from "../../data/statusEffects";
import { getAbility } from "../../data/abilities";
import { statsForLevel, activeStatusCombatStatSum } from "../../engine/party";
import { artifactStatBoostSum, curseAggroBoostSum, abilityWidenedStatBoost } from "../../engine/artifacts";
import { applyExhaustedMultiplier } from "../../engine/survival";
import type { Character, CombatStat } from "../../types";

export type CharacterInfoUiState = Extract<UiState, { kind: "characterInfo" }>;

export function handleKey(ctx: ScreenContext, ui: CharacterInfoUiState, key: KeyEvent, digit: number | null): void {
  if (key.name === "escape" || key.name === "b") {
    ctx.setUi(ui.previousUi);
    return;
  }
  
  if (digit !== null && digit >= 1 && digit <= ctx.game.state.party.length) {
    ui.characterIndex = digit - 1;
  }
}

function formatStat(
  name: string,
  base: number,
  exhaustedMultiplierValue: number,
  artifactBonus: number,
  abilityBonus: number,
  statusBonus: number,
  total: number
): string {
  let out = ` ${name.padEnd(12)} : `;
  out += `<Base ${base.toString().padStart(3)}> `;
  
  const exhaustedBonus = exhaustedMultiplierValue - base;

  if (artifactBonus !== 0) {
    const sign = artifactBonus > 0 ? "+" : "";
    out += `\x1b[38;2;216;162;58m(${sign}${artifactBonus} Af)\x1b[0m `;
  }
  if (abilityBonus !== 0) {
    const sign = abilityBonus > 0 ? "+" : "";
    out += `\x1b[38;2;91;143;201m(${sign}${abilityBonus} Abi)\x1b[0m `;
  }
  if (statusBonus !== 0) {
    const sign = statusBonus > 0 ? "+" : "";
    const color = statusBonus > 0 ? "59;168;89" : "192;57;43";
    out += `\x1b[38;2;${color}m(${sign}${statusBonus} Status)\x1b[0m `;
  }
  if (exhaustedBonus !== 0) {
    out += `\x1b[38;2;192;57;43m(${exhaustedBonus} Exhausted)\x1b[0m `;
  }

  out += `[Total: ${total}]`;
  return out;
}

export function renderMain(game: Game, ui: CharacterInfoUiState): string {
  const character = game.state.party[ui.characterIndex];
  if (!character) return "Invalid character index.";

  const cls = getClass(character.classId);
  const baseStats = statsForLevel(cls, character.level);
  const artBoost = artifactStatBoostSum(character);

  const lines: string[] = [];
  lines.push(`\x1b[38;2;201;162;39m${character.name}\x1b[0m (Level ${character.level} ${cls.name})`);
  lines.push(` HP: \x1b[38;2;95;168;95m${character.hp}/${character.maxHp}\x1b[0m  MP: \x1b[38;2;91;143;201m${character.mp}/${character.maxMp}\x1b[0m`);
  lines.push("");

  // Attack
  lines.push(formatStat(
    "Attack",
    baseStats.attack,
    applyExhaustedMultiplier(baseStats.attack, game.state.satiety),
    artBoost.attack,
    0, // Abilities don't usually boost attack
    activeStatusCombatStatSum(character, "attack"),
    character.attack
  ));

  // Defense
  lines.push(formatStat(
    "Defense",
    baseStats.defense,
    applyExhaustedMultiplier(baseStats.defense, game.state.satiety),
    artBoost.defense,
    0,
    activeStatusCombatStatSum(character, "defense"),
    character.defense
  ));

  // Magic Power
  lines.push(formatStat(
    "Magic Power",
    baseStats.magicPower,
    applyExhaustedMultiplier(baseStats.magicPower, game.state.satiety),
    0,
    abilityWidenedStatBoost(character, "magicPower"),
    0,
    character.magicPower
  ));

  // Speed
  lines.push(formatStat(
    "Speed",
    cls.baseSpeed,
    applyExhaustedMultiplier(cls.baseSpeed, game.state.satiety),
    0,
    abilityWidenedStatBoost(character, "speed"),
    activeStatusCombatStatSum(character, "speed"),
    character.speed
  ));

  // Aggro
  lines.push(formatStat(
    "Aggro",
    cls.baseAggro,
    applyExhaustedMultiplier(cls.baseAggro, game.state.satiety),
    curseAggroBoostSum(character),
    abilityWidenedStatBoost(character, "aggro"),
    activeStatusCombatStatSum(character, "aggro"),
    character.aggro
  ));

  lines.push("");
  lines.push("\x1b[38;2;201;162;39mEquipped Artifacts:\x1b[0m");
  if (character.equippedArtifactIds.length === 0) {
    lines.push("  (None)");
  } else {
    for (const artId of character.equippedArtifactIds) {
      lines.push(`  - ${getArtifact(artId).name}`);
    }
  }

  lines.push("");
  lines.push("\x1b[38;2;91;143;201mEquipped Ability:\x1b[0m");
  if (character.equippedAbilityId) {
    lines.push(`  - ${getAbility(character.equippedAbilityId).name}`);
  } else {
    lines.push("  (None)");
  }

  lines.push("");
  lines.push("\x1b[38;2;216;203;176mActive Status Effects:\x1b[0m");
  if (character.activeStatusEffects.length === 0) {
    lines.push("  (None)");
  } else {
    for (const active of character.activeStatusEffects) {
      const def = getStatusEffect(active.statusEffectId);
      const duration = active.turnsRemaining !== undefined ? `(${active.turnsRemaining} turns)` : "";
      lines.push(`  - ${def.name} ${duration}`);
    }
  }

  return lines.join("\n");
}

export function renderFooter(_ui: CharacterInfoUiState): string {
  return "[\x1b[1m1-4\x1b[0m] Switch Character   [\x1b[1mb/Esc\x1b[0m] Back";
}
