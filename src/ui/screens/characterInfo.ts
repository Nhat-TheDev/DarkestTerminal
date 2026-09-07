import type { KeyEvent, StyledText, TextChunk } from "@opentui/core";
import type { Game } from "../../engine/game";
import type { UiState } from "../state";
import { PALETTE, colorChunk, boldColorChunk, plainChunk, joinLines, hpColorFor } from "../theme";
import type { ScreenContext } from "./context";
import { digitHint } from "../keyHints";
import { getClass } from "../../data/classes";
import { getArtifact, formatArtifactEffect } from "../../data/artifacts";
import { getStatusEffect, statusDisplayName, formatStatusEffectMechanics } from "../../data/statusEffects";
import { getAbility, formatAbilityEffect } from "../../data/abilities";
import { wrapText } from "../layout";
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

const statTag = (amount: number, color: string): TextChunk =>
  colorChunk(t("ui.characterInfoStatTag", { sign: signed(amount), amount }), color);

/**
 * Width the wrapped effect/description text under an Artifact/Ability/Status entry may occupy.
 * Fixed rather than measured: this screen renders into the middle panel, which is whatever the
 * terminal has left after the 34-wide party panel and the 32-wide monster panel — 32 usable
 * columns at 100. `ui.characterInfoDetailLine` indents by DETAIL_INDENT, so the wrap budget is
 * what remains after that; wrapping to the full 32 would push every line 5 columns past the edge.
 */
const DETAIL_INDENT = 5;
const DETAIL_WIDTH = 32 - DETAIL_INDENT;

/** The "what does this actually do" line under a list entry — wrapped, indented, dimmed. */
const detailLines = (text: string): TextChunk[][] =>
  wrapText(text, DETAIL_WIDTH).map((line) => [colorChunk(t("ui.characterInfoDetailLine", { text: line }), PALETTE.dim)]);

/**
 * One stat as `Name  total`, then its sources on an indented line: the base value followed by one
 * bracketed number per source, each summed into a single figure and told apart by colour alone
 * (gold = Artifacts, blue = Ability, green/red = status effects). The base itself turns red while
 * Exhausted is scaling it down, which is why that penalty needs no bracket of its own. The
 * breakdown wraps onto its own line because this screen renders into the middle panel, only ~32
 * columns wide on an 80-100 column terminal.
 */
function statLines(
  name: string,
  exhaustedBase: number,
  isExhausted: boolean,
  artifactBonus: number,
  abilityBonus: number,
  statusBonus: number,
  total: number
): TextChunk[][] {
  const sources: TextChunk[] = [
    colorChunk(t("ui.characterInfoBaseTag", { base: exhaustedBase }), isExhausted ? PALETTE.hpLow : PALETTE.dim),
  ];
  const push = (chunk: TextChunk) => {
    sources.push(plainChunk(" "));
    sources.push(chunk);
  };
  if (artifactBonus !== 0) push(statTag(artifactBonus, PALETTE.title));
  if (abilityBonus !== 0) push(statTag(abilityBonus, PALETTE.mp));
  if (statusBonus !== 0) push(statTag(statusBonus, statusBonus > 0 ? PALETTE.hpHigh : PALETTE.hpLow));

  return [
    [boldColorChunk(t("ui.characterInfoStatLine", { stat: name.padEnd(12), total }), PALETTE.text)],
    [plainChunk("   "), ...sources],
  ];
}

export function renderMain(game: Game, ui: CharacterInfoUiState): StyledText | string {
  const party = game.state.party;
  const character = party[ui.characterIndex];
  if (!character) return t("ui.characterInfoInvalidIndex");

  const cls = getClass(character.classId);
  const satiety = game.state.satiety;
  const baseStats = statsForLevel(cls, character.level);
  const exhausted = (base: number) => applyExhaustedMultiplier(base, satiety);
  // Sampled off a fixed number rather than a real stat, so a class whose base is 0 for that stat
  // (a Vanguard's magic power) doesn't read as "not exhausted".
  const isExhausted = exhausted(100) !== 100;
  // `artifactStatBoostSum` deliberately folds the equipped Ability's shared effects in with the
  // Artifacts', so the Ability's share has to be subtracted back out to colour the two apart.
  const boost = artifactStatBoostSum(character);
  const abilityBoost = (stat: "attack" | "defense") => abilityWidenedStatBoost(character, stat);

  // Which digit switches to whom — the only place the party's indices are visible on this screen.
  const picker: TextChunk[] = [];
  party.forEach((member, i) => {
    if (i > 0) picker.push(plainChunk("  "));
    const label = t("ui.characterInfoPartyPickerEntry", { index: i + 1, name: member.name });
    if (i === ui.characterIndex) picker.push(boldColorChunk(label, PALETTE.title));
    else picker.push(colorChunk(label, member.isAlive ? PALETTE.dim : PALETTE.dead));
  });

  const lines: TextChunk[][] = [
    picker,
    [colorChunk(t("ui.characterInfoHeading", { name: character.name, level: character.level, cls: cls.name }), PALETTE.title)],
    [
      colorChunk(t("ui.characterInfoHp", { hp: character.hp, maxHp: character.maxHp }), hpColorFor(character.hp, character.maxHp)),
      colorChunk(t("ui.characterInfoMp", { mp: character.mp, maxMp: character.maxMp }), PALETTE.mp),
    ],
    [],
    // maxHp/maxMp sit above the combat stats because they are what the HP:/MP: line above is
    // measured against. Exhausted does not scale them (`party.ts` `recomputeCharacterStats`), and
    // no status effect touches them, so those two sources are hard-zeroed here.
    ...statLines(
      t("ui.characterInfoStatMaxHp"),
      baseStats.maxHp,
      false,
      boost.maxHp - abilityWidenedStatBoost(character, "maxHp"),
      abilityWidenedStatBoost(character, "maxHp"),
      0,
      character.maxHp
    ),
    ...statLines(
      t("ui.characterInfoStatMaxMp"),
      baseStats.maxMp,
      false,
      boost.maxMp - abilityWidenedStatBoost(character, "maxMp"),
      abilityWidenedStatBoost(character, "maxMp"),
      0,
      character.maxMp
    ),
    ...statLines(
      t("ui.characterInfoStatAttack"),
      exhausted(baseStats.attack),
      isExhausted,
      boost.attack - abilityBoost("attack"),
      abilityBoost("attack"),
      activeStatusCombatStatSum(character, "attack"),
      character.attack
    ),
    ...statLines(
      t("ui.characterInfoStatDefense"),
      exhausted(baseStats.defense),
      isExhausted,
      boost.defense - abilityBoost("defense"),
      abilityBoost("defense"),
      activeStatusCombatStatSum(character, "defense"),
      character.defense
    ),
    ...statLines(
      t("ui.characterInfoStatMagicPower"),
      exhausted(baseStats.magicPower),
      isExhausted,
      0,
      abilityWidenedStatBoost(character, "magicPower"),
      0,
      character.magicPower
    ),
    ...statLines(
      t("ui.characterInfoStatSpeed"),
      exhausted(cls.baseSpeed),
      isExhausted,
      0,
      abilityWidenedStatBoost(character, "speed"),
      activeStatusCombatStatSum(character, "speed"),
      character.speed
    ),
    ...statLines(
      t("ui.characterInfoStatAggro"),
      exhausted(cls.baseAggro),
      isExhausted,
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
      const artifact = getArtifact(artifactId);
      lines.push([colorChunk(t("ui.characterInfoListItem", { name: artifact.name }), PALETTE.text)]);
      lines.push(...detailLines(formatArtifactEffect(artifact)));
    }
  }

  lines.push([]);
  lines.push([colorChunk(t("ui.characterInfoAbilityLabel"), PALETTE.mp)]);
  if (character.equippedAbilityId) {
    const ability = getAbility(character.equippedAbilityId);
    lines.push([colorChunk(t("ui.characterInfoListItem", { name: ability.name }), PALETTE.text)]);
    lines.push(...detailLines(formatAbilityEffect(ability)));
  } else {
    lines.push([colorChunk(t("ui.characterInfoNone"), PALETTE.dim)]);
  }

  lines.push([]);
  lines.push([colorChunk(t("ui.characterInfoStatusLabel"), PALETTE.text)]);
  if (character.activeStatusEffects.length === 0) {
    lines.push([colorChunk(t("ui.characterInfoNone"), PALETTE.dim)]);
  } else {
    for (const active of character.activeStatusEffects) {
      const def = getStatusEffect(active.statusEffectId);
      // statusDisplayName, not `def.name`: ranked variants share one `name`, so Storm-Empowered
      // II would otherwise render identical to Storm-Empowered while the line below it reports a
      // different number. The party panel has always used the composed name.
      const name = statusDisplayName(def);
      lines.push([
        colorChunk(
          active.turnsRemaining !== undefined
            ? t("ui.characterInfoStatusItem", { name, turns: active.turnsRemaining })
            : t("ui.characterInfoListItem", { name }),
          PALETTE.text
        ),
      ]);
      // A status carries no prose of its own — this line is composed from its mechanical fields,
      // so what the player reads and what the engine applies can never disagree.
      lines.push(...detailLines(formatStatusEffectMechanics(def)));
    }
  }

  return joinLines(lines);
}

export function renderFooter(_ui: CharacterInfoUiState, game: Game): string {
  return digitHint("ui.characterInfoFooter", game.state.party.length);
}
