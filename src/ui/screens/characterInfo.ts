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

/** Fixed, not measured: the middle panel is 32 columns on a 100-column terminal, less the detail indent. */
const DETAIL_INDENT = 5;
const DETAIL_WIDTH = 32 - DETAIL_INDENT;

const detailLines = (text: string): TextChunk[][] =>
  wrapText(text, DETAIL_WIDTH).map((line) => [colorChunk(t("ui.characterInfoDetailLine", { text: line }), PALETTE.dim)]);

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
  if (rankDef.gambleBonusPercentPerStack !== undefined) {
    const fortune = passive.gambleStatusEffectId ? getStatusEffect(passive.gambleStatusEffectId) : undefined;
    parts.push(t("passive.jesterFortune", { percent: rankDef.gambleBonusPercentPerStack, max: fortune?.maxStacks ?? 1 }));
  }
  if (rankDef.reflectPercent !== undefined) {
    parts.push(t("passive.paladinReflect", { percent: rankDef.reflectPercent }));
  }
  if (rankDef.killRestoreMpPercent !== undefined || rankDef.killRestoreHpPercent !== undefined) {
    parts.push(t("passive.warlockSoulFeast", { mp: rankDef.killRestoreMpPercent ?? 0, hp: rankDef.killRestoreHpPercent ?? 0 }));
  }
  return parts.join(" ");
}

/** Sources are told apart by colour alone; the base turns red while Exhausted scales it down. */
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
      // Ranked variants share `def.name`.
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
      // `appliedAmounts` carries a stat delta or floor resolved at cast time.
      lines.push(...detailLines(formatStatusEffectMechanics(def, { applied: active.appliedAmounts })));
    }
  }

  return joinLines(lines);
}

export function renderFooter(_ui: CharacterInfoUiState, game: Game): string {
  return digitHint("ui.characterInfoFooter", game.state.party.length);
}
