import type { KeyEvent, StyledText, TextChunk } from "@opentui/core";
import type { Game } from "../../engine/game";
import type { UiState } from "../state";
import { PALETTE, colorChunk, boldColorChunk, plainChunk, joinLines, hpColorFor } from "../theme";
import type { ScreenContext } from "./context";
import { digitHint } from "../keyHints";
import { getClass, passiveRankDef } from "../../data/classes";
import type { PassiveRankDefinition, PassiveSkillDefinition } from "../../types";
import { getArtifact, formatArtifactEffect } from "../../data/artifacts";
import { getStatusEffect, statusDisplayName, formatStatusEffectMechanics } from "../../data/statusEffects";
import { getAbility, formatAbilityEffect } from "../../data/abilities";
import { wrapText } from "../layout";
import { characterStatBreakdown, type StatBreakdown } from "../../engine/party";
import { t } from "../../data/strings";
import { lastsWholeFight } from "./combat";

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
 * The passive's actual mechanical effect at its currently-unlocked rank, composed straight from
 * `rankDef`'s fields — never a hand-typed number, so this can never drift from what the engine
 * applies (`party.ts`/`resolver.ts`/`combat.ts`/`combatHooks.ts`/`artifacts.ts` all read the exact
 * same `data/classes.json` fields). Driven by which fields are present, not by `classId` — same
 * shape as `formatArtifactEffect`/`formatStatusEffectMechanics` switching on effect kind rather
 * than on which artifact/status it came from, so a class needs no code change here unless it
 * introduces a genuinely new field.
 */
export function formatPassiveEffect(passive: PassiveSkillDefinition, rankDef: PassiveRankDefinition): string {
  const parts: string[] = [];
  if (rankDef.maxHpPercent !== undefined) {
    parts.push(t("passive.vanguardBuff", { maxHp: rankDef.maxHpPercent, defense: rankDef.defensePercent ?? 0, aggro: rankDef.aggroFlat ?? 0 }));
  }
  if (rankDef.onHitStatusEffectId !== undefined) {
    const shredStat = getStatusEffect(rankDef.onHitStatusEffectId).perTurnEffects.find((e) => e.kind === "modifyCombatStat" && e.combatStat === "defense");
    parts.push(t("passive.mageShred", { flat: Math.abs(shredStat?.amount ?? 0), percent: Math.abs(shredStat?.minPercent ?? 0) }));
  }
  if (rankDef.bonusPercent !== undefined) {
    parts.push(t("passive.roguePoisonBonus", { percent: rankDef.bonusPercent, flat: rankDef.bonusFlat ?? 0 }));
  }
  if (rankDef.healBoostPercent !== undefined) {
    parts.push(t("passive.acolyteHealBoost", { percent: rankDef.healBoostPercent }));
  }
  if (rankDef.debuffResistPercent !== undefined) {
    parts.push(t("passive.acolyteDebuffResist", { percent: rankDef.debuffResistPercent }));
  }
  if (rankDef.hpThresholdPercent !== undefined) {
    parts.push(
      t("passive.vikingBloodFury", {
        threshold: rankDef.hpThresholdPercent,
        effect: rankDef.thresholdStatusEffectId ? formatStatusEffectMechanics(getStatusEffect(rankDef.thresholdStatusEffectId)) : "",
        selfDamage: passive.selfDamagePerHitMaxHPPercent ?? 0,
      })
    );
  }
  if (rankDef.procChancePercent !== undefined) {
    parts.push(t("passive.plagueDoctorProc", { percent: rankDef.procChancePercent }));
  }
  if (rankDef.critChancePercent !== undefined) {
    parts.push(t("passive.archerCrit", { chance: rankDef.critChancePercent, multiplier: rankDef.critMultiplierPercent ?? 0 }));
  }
  if (rankDef.dodgePercent !== undefined) {
    parts.push(t("passive.ninjaDodge", { percent: rankDef.dodgePercent }));
  }
  if (rankDef.secondCloneChancePercent !== undefined) {
    parts.push(t("passive.ninjaSecondClone", { chance: rankDef.secondCloneChancePercent, max: passive.maxClones ?? 0 }));
  }
  if (rankDef.minionMaxHpPercent !== undefined) {
    parts.push(t("passive.summonerMinionBuff", { hp: rankDef.minionMaxHpPercent, attack: rankDef.minionAttackPercent ?? 0 }));
  }
  if (rankDef.maxActiveMinions !== undefined) {
    parts.push(t("passive.summonerMinionCap", { count: rankDef.maxActiveMinions }));
  }
  return parts.join(" ");
}

/**
 * One stat as `Name  total`, then its sources on an indented line: the base value followed by one
 * bracketed number per source, each summed into a single figure and told apart by colour alone
 * (gold = Artifacts, blue = Ability, purple = class passive, green/red = status effects). The base
 * itself turns red while Exhausted is scaling it down, which is why that penalty needs no bracket of
 * its own. The breakdown wraps onto its own line because this screen renders into the middle panel,
 * only ~32 columns wide on an 80-100 column terminal.
 */
function statLines(name: string, stat: StatBreakdown, total: number): TextChunk[][] {
  const sources: TextChunk[] = [colorChunk(t("ui.characterInfoBaseTag", { base: stat.base }), stat.isExhausted ? PALETTE.hpLow : PALETTE.dim)];
  const push = (chunk: TextChunk) => {
    sources.push(plainChunk(" "));
    sources.push(chunk);
  };
  if (stat.artifact !== 0) push(statTag(stat.artifact, PALETTE.title));
  if (stat.ability !== 0) push(statTag(stat.ability, PALETTE.mp));
  if (stat.passive !== 0) push(statTag(stat.passive, PALETTE.passive));
  if (stat.status !== 0) push(statTag(stat.status, stat.status > 0 ? PALETTE.hpHigh : PALETTE.hpLow));

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
  const stats = characterStatBreakdown(character, game.state.satiety);

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
    // maxHp/maxMp sit above the combat stats because they are what the HP:/MP: line above is measured against.
    ...statLines(t("ui.characterInfoStatMaxHp"), stats.maxHp, character.maxHp),
    ...statLines(t("ui.characterInfoStatMaxMp"), stats.maxMp, character.maxMp),
    ...statLines(t("ui.characterInfoStatAttack"), stats.attack, character.attack),
    ...statLines(t("ui.characterInfoStatDefense"), stats.defense, character.defense),
    ...statLines(t("ui.characterInfoStatMagicPower"), stats.magicPower, character.magicPower),
    ...statLines(t("ui.characterInfoStatSpeed"), stats.speed, character.speed),
    ...statLines(t("ui.characterInfoStatAggro"), stats.aggro, character.aggro),
    [],
    [colorChunk(t("ui.characterInfoPassiveLabel"), PALETTE.title)],
  ];

  const rankDef = passiveRankDef(cls.passiveSkill, character.level);
  if (!rankDef) {
    const firstUnlock = cls.passiveSkill.ranks[0]!.unlockLevel;
    lines.push([colorChunk(t("ui.characterInfoPassiveItemLocked", { name: cls.passiveSkill.name, level: firstUnlock }), PALETTE.dim)]);
  } else {
    lines.push([colorChunk(t("ui.characterInfoPassiveItemRanked", { name: cls.passiveSkill.name, rank: rankDef.rank }), PALETTE.text)]);
    lines.push(...detailLines(formatPassiveEffect(cls.passiveSkill, rankDef)));
    const nextRank = cls.passiveSkill.ranks.find((r) => r.rank === rankDef.rank + 1);
    if (nextRank) lines.push(...detailLines(t("ui.characterInfoPassiveNextRank", { level: nextRank.unlockLevel })));
  }

  lines.push([]);
  lines.push([colorChunk(t("ui.characterInfoArtifactsLabel"), PALETTE.title)]);

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
          active.turnsRemaining === undefined
            ? t("ui.characterInfoListItem", { name })
            : lastsWholeFight(active.turnsRemaining)
              ? `${t("ui.characterInfoListItem", { name })}${t("ui.statusLastsFightSuffix")}`
              : t("ui.characterInfoStatusItem", { name, turns: active.turnsRemaining }),
          PALETTE.text
        ),
      ]);
      // Composed from the status's own mechanical fields (not `description`), so what the player
      // reads here and what the engine applies can never disagree. `appliedAmounts` carries a stat
      // delta a casting skill set (Totem Recall) or a floor resolved at cast time.
      lines.push(...detailLines(formatStatusEffectMechanics(def, { applied: active.appliedAmounts })));
    }
  }

  return joinLines(lines);
}

export function renderFooter(_ui: CharacterInfoUiState, game: Game): string {
  return digitHint("ui.characterInfoFooter", game.state.party.length);
}
