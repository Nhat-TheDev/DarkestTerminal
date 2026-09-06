import type { KeyEvent, StyledText, TextChunk } from "@opentui/core";
import type { Game } from "../../engine/game";
import type { UiState } from "../state";
import { PALETTE, colorChunk, boldColorChunk, plainChunk, joinLines, hpColorFor } from "../theme";
import type { ScreenContext } from "./context";
import { getClass } from "../../data/classes";
import { getArtifact } from "../../data/artifacts";
import { getStatusEffect } from "../../data/statusEffects";
import { getAbility } from "../../data/abilities";
import { statsForLevel, activeStatusCombatStatSum } from "../../engine/party";
import { artifactStatBoostSum, curseAggroBoostSum, abilityWidenedStatBoost } from "../../engine/artifacts";
import { applyExhaustedMultiplier } from "../../engine/survival";
import { t } from "../../data/strings";

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

const signed = (amount: number): string => (amount > 0 ? "+" : "");

/**
 * One stat as `Name  total` followed by its breakdown. The breakdown wraps onto its own indented
 * line because this screen renders into the middle panel, which is only ~32 columns wide on an
 * 80-100 column terminal.
 */
function statLines(
  name: string,
  base: number,
  exhaustedBase: number,
  artifactBonus: number,
  abilityBonus: number,
  statusBonus: number,
  total: number
): TextChunk[][] {
  const tags: TextChunk[] = [colorChunk(t("ui.characterInfoBaseTag", { base }), PALETTE.dim)];
  const push = (chunk: TextChunk) => {
    tags.push(plainChunk(" "));
    tags.push(chunk);
  };
  if (artifactBonus !== 0) {
    push(colorChunk(t("ui.characterInfoArtifactTag", { sign: signed(artifactBonus), amount: artifactBonus }), PALETTE.title));
  }
  if (abilityBonus !== 0) {
    push(colorChunk(t("ui.characterInfoAbilityTag", { sign: signed(abilityBonus), amount: abilityBonus }), PALETTE.mp));
  }
  if (statusBonus !== 0) {
    push(colorChunk(t("ui.characterInfoStatusTag", { sign: signed(statusBonus), amount: statusBonus }), statusBonus > 0 ? PALETTE.hpHigh : PALETTE.hpLow));
  }
  const exhaustedBonus = exhaustedBase - base;
  if (exhaustedBonus !== 0) {
    push(colorChunk(t("ui.characterInfoExhaustedTag", { amount: exhaustedBonus }), PALETTE.hpLow));
  }

  return [
    [boldColorChunk(t("ui.characterInfoStatLine", { stat: name.padEnd(12), total }), PALETTE.text)],
    [plainChunk("   "), ...tags],
  ];
}

export function renderMain(game: Game, ui: CharacterInfoUiState): StyledText | string {
  const character = game.state.party[ui.characterIndex];
  if (!character) return t("ui.characterInfoInvalidIndex");

  const cls = getClass(character.classId);
  const satiety = game.state.satiety;
  const baseStats = statsForLevel(cls, character.level);
  // `artifactStatBoostSum` deliberately folds the equipped Ability's shared effects in with the
  // Artifacts', so the Ability's share has to be subtracted back out to label the two apart.
  const boost = artifactStatBoostSum(character);
  const abilityBoost = (stat: "attack" | "defense") => abilityWidenedStatBoost(character, stat);

  const lines: TextChunk[][] = [
    [colorChunk(t("ui.characterInfoHeading", { name: character.name, level: character.level, cls: cls.name }), PALETTE.title)],
    [
      colorChunk(t("ui.characterInfoHp", { hp: character.hp, maxHp: character.maxHp }), hpColorFor(character.hp, character.maxHp)),
      colorChunk(t("ui.characterInfoMp", { mp: character.mp, maxMp: character.maxMp }), PALETTE.mp),
    ],
    [],
    ...statLines(
      t("ui.characterInfoStatAttack"),
      baseStats.attack,
      applyExhaustedMultiplier(baseStats.attack, satiety),
      boost.attack - abilityBoost("attack"),
      abilityBoost("attack"),
      activeStatusCombatStatSum(character, "attack"),
      character.attack
    ),
    ...statLines(
      t("ui.characterInfoStatDefense"),
      baseStats.defense,
      applyExhaustedMultiplier(baseStats.defense, satiety),
      boost.defense - abilityBoost("defense"),
      abilityBoost("defense"),
      activeStatusCombatStatSum(character, "defense"),
      character.defense
    ),
    ...statLines(
      t("ui.characterInfoStatMagicPower"),
      baseStats.magicPower,
      applyExhaustedMultiplier(baseStats.magicPower, satiety),
      0,
      abilityWidenedStatBoost(character, "magicPower"),
      0,
      character.magicPower
    ),
    ...statLines(
      t("ui.characterInfoStatSpeed"),
      cls.baseSpeed,
      applyExhaustedMultiplier(cls.baseSpeed, satiety),
      0,
      abilityWidenedStatBoost(character, "speed"),
      activeStatusCombatStatSum(character, "speed"),
      character.speed
    ),
    ...statLines(
      t("ui.characterInfoStatAggro"),
      cls.baseAggro,
      applyExhaustedMultiplier(cls.baseAggro, satiety),
      curseAggroBoostSum(character),
      abilityWidenedStatBoost(character, "aggro"),
      activeStatusCombatStatSum(character, "aggro"),
      character.aggro
    ),
    [],
    [colorChunk(t("ui.characterInfoArtifactsLabel"), PALETTE.title)],
  ];

  if (character.equippedArtifactIds.length === 0) {
    lines.push([colorChunk(t("ui.characterInfoNone"), PALETTE.dim)]);
  } else {
    for (const artifactId of character.equippedArtifactIds) {
      lines.push([colorChunk(t("ui.characterInfoListItem", { name: getArtifact(artifactId).name }), PALETTE.text)]);
    }
  }

  lines.push([]);
  lines.push([colorChunk(t("ui.characterInfoAbilityLabel"), PALETTE.mp)]);
  lines.push(
    character.equippedAbilityId
      ? [colorChunk(t("ui.characterInfoListItem", { name: getAbility(character.equippedAbilityId).name }), PALETTE.text)]
      : [colorChunk(t("ui.characterInfoNone"), PALETTE.dim)]
  );

  lines.push([]);
  lines.push([colorChunk(t("ui.characterInfoStatusLabel"), PALETTE.text)]);
  if (character.activeStatusEffects.length === 0) {
    lines.push([colorChunk(t("ui.characterInfoNone"), PALETTE.dim)]);
  } else {
    for (const active of character.activeStatusEffects) {
      const name = getStatusEffect(active.statusEffectId).name;
      lines.push([
        colorChunk(
          active.turnsRemaining !== undefined
            ? t("ui.characterInfoStatusItem", { name, turns: active.turnsRemaining })
            : t("ui.characterInfoListItem", { name }),
          PALETTE.text
        ),
      ]);
    }
  }

  return joinLines(lines);
}

export function renderFooter(_ui: CharacterInfoUiState): string {
  return t("ui.characterInfoFooter");
}
