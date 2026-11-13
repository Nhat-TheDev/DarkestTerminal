import type { KeyEvent, StyledText, TextChunk } from "@opentui/core";
import type { Game } from "../../engine/game";
import type { UiState } from "../state";
import { PALETTE, colorChunk, boldColorChunk, plainChunk, joinLines, hpColorFor } from "../theme";
import type { ScreenContext } from "./context";
import { digitHint } from "../keyHints";
import { getReligion } from "../../data/religions";
import { getClass, getSkill, passiveRankDef } from "../../data/classes";
import type { ActiveStatusEffect, CombatStat, PassiveRankDefinition, PassiveSkillDefinition, Summon } from "../../types";
import { getArtifact, formatArtifactEffect } from "../../data/artifacts";
import { getStatusEffect, statusDisplayName, formatStatusEffectMechanics, COMBAT_STAT_LABEL } from "../../data/statusEffects";
import { getAbility, formatAbilityEffect } from "../../data/abilities";
import { wrapText } from "../layout";
import { activeStatusCombatStatSum, characterStatBreakdown, type StatBreakdown } from "../../engine/party";
import { getSummonArchetype, getSummonSkill } from "../../data/summons";
import { t } from "../../data/strings";
import { lastsWholeFight } from "./combat";
import { skillLines, statRows } from "./monsterInfo";

export type CharacterInfoUiState = Extract<UiState, { kind: "characterInfo" }>;

/** Digit keys stop at 9. */
const MAX_PICKS = 9;

/** Living minions in party order, numbered after the party on the picker. */
export function livingMinions(game: Game): Summon[] {
  const party = game.state.party;
  return party.flatMap((c) => game.ctx.summons.filter((s) => s.ownerId === c.id && s.hp > 0)).slice(0, Math.max(0, MAX_PICKS - party.length));
}

export function handleKey(ctx: ScreenContext, ui: CharacterInfoUiState, key: KeyEvent, digit: number | null): void {
  if (key.name === "escape" || key.name === "b") {
    ctx.setUi(ui.previousUi);
    return;
  }

  if (digit !== null && digit >= 1 && digit <= ctx.game.state.party.length + livingMinions(ctx.game).length) {
    ui.characterIndex = digit - 1;
  }
}

const signed = (amount: number): string => (amount > 0 ? "+" : "");

const statTag = (amount: number, color: string): TextChunk =>
  colorChunk(t("ui.characterInfoStatTag", { sign: signed(amount), amount }), color);

/** Fixed, not measured: the middle panel is 32 columns on a 100-column terminal, less the detail indent. */
const DETAIL_INDENT = 5;
const DETAIL_WIDTH = 32 - DETAIL_INDENT;
const MINION_STATS: { stat: CombatStat & keyof Summon; key: string }[] = [
  { stat: "attack", key: "ui.characterInfoStatAttack" },
  { stat: "defense", key: "ui.characterInfoStatDefense" },
  { stat: "magicPower", key: "ui.characterInfoStatMagicPower" },
  { stat: "speed", key: "ui.characterInfoStatSpeed" },
];

const detailLines = (text: string): TextChunk[][] =>
  wrapText(text, DETAIL_WIDTH).map((line) => [colorChunk(t("ui.characterInfoDetailLine", { text: line }), PALETTE.dim)]);

export function formatPassiveEffect(passive: PassiveSkillDefinition, rankDef: PassiveRankDefinition): string {
  const parts: string[] = [];
  if (rankDef.maxHpPercent !== undefined) {
    parts.push(t("passive.knightBuff", { maxHp: rankDef.maxHpPercent, defense: rankDef.defensePercent ?? 0, chance: rankDef.interceptWeakestChancePercent ?? 0 }));
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
  if (rankDef.growthSwapWeights !== undefined && passive.growthSwapStats) {
    const [first, second] = passive.growthSwapStats.map((stat) => COMBAT_STAT_LABEL[stat]) as [string, string];
    parts.push(t("passive.jesterGrowthSwap", { first, second, low: rankDef.growthSwapWeights.low, high: rankDef.growthSwapWeights.high }));
  }
  if (rankDef.reflectPercent !== undefined) {
    parts.push(t("passive.paladinReflect", { percent: rankDef.reflectPercent }));
  }
  if (passive.ignoresFearEffects) parts.push(t("passive.paladinFearImmune"));
  if (rankDef.stackBurstPowerPercent !== undefined && passive.stackBurst) {
    const burst = passive.stackBurst;
    parts.push(
      t("passive.warlockStackBurst", {
        status: getStatusEffect(burst.statusEffectId).name,
        stacks: burst.atStacks,
        skill: getSkill(burst.skillId).name,
        percent: rankDef.stackBurstPowerPercent,
        removed: burst.removeStacks,
      })
    );
  }
  if (rankDef.deathSpreadChancePercentPerStack !== undefined && passive.deathSpread) {
    const spread = passive.deathSpread;
    parts.push(
      t("passive.warlockDeathSpread", { status: getStatusEffect(spread.statusEffectId).name, percent: rankDef.deathSpreadChancePercentPerStack, stacks: spread.stacks })
    );
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
  if (stat.boon !== 0) push(statTag(stat.boon, PALETTE.markerHealParty));
  if (stat.status !== 0) push(statTag(stat.status, stat.status > 0 ? PALETTE.hpHigh : PALETTE.hpLow));

  return [
    [boldColorChunk(t("ui.characterInfoStatLine", { stat: name.padEnd(12), total }), PALETTE.text)],
    [plainChunk("   "), ...sources],
  ];
}

function statusLines(effects: ActiveStatusEffect[]): TextChunk[][] {
  const lines: TextChunk[][] = [[colorChunk(t("ui.characterInfoStatusLabel"), PALETTE.text)]];
  if (effects.length === 0) {
    lines.push([colorChunk(t("ui.characterInfoNone"), PALETTE.dim)]);
    return lines;
  }
  for (const active of effects) {
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
  return lines;
}

function pickerLines(game: Game, minions: Summon[], selected: number): TextChunk[][] {
  const party = game.state.party;
  const entry = (i: number, name: string, color: string): TextChunk => {
    const label = t("ui.characterInfoPartyPickerEntry", { index: i + 1, name });
    return i === selected ? boldColorChunk(label, PALETTE.title) : colorChunk(label, color);
  };
  const row = (entries: TextChunk[]): TextChunk[] => entries.flatMap((chunk, i) => (i > 0 ? [plainChunk("  "), chunk] : [chunk]));
  const lines = [row(party.map((member, i) => entry(i, member.name, member.isAlive ? PALETTE.dim : PALETTE.dead)))];
  if (minions.length > 0) {
    lines.push([colorChunk(t("ui.characterInfoMinionsLabel"), PALETTE.dim), ...row(minions.map((m, i) => entry(party.length + i, m.name, PALETTE.dim)))]);
  }
  return lines;
}

function minionLines(game: Game, summon: Summon): TextChunk[][] {
  const owner = game.state.party.find((c) => c.id === summon.ownerId);
  const skills = (getSummonArchetype(summon.archetypeId).signatureSkillIds ?? []).map(getSummonSkill);
  return [
    [colorChunk(t("ui.characterInfoMinionHeading", { name: summon.name, owner: owner?.name ?? "" }), PALETTE.title)],
    [colorChunk(t("ui.characterInfoHp", { hp: summon.hp, maxHp: summon.maxHp }), hpColorFor(summon.hp, summon.maxHp))],
    [],
    ...MINION_STATS.flatMap(({ stat, key }) => {
      const status = activeStatusCombatStatSum(summon, stat);
      return statRows(t(key), String(summon[stat]), summon[stat] - status, status, PALETTE.text);
    }),
    [],
    ...skillLines(skills, (skill) => t("ui.monsterSkillReady", { name: skill.name }), DETAIL_INDENT + DETAIL_WIDTH, true),
    [],
    ...statusLines(summon.activeStatusEffects),
  ];
}

export function renderMain(game: Game, ui: CharacterInfoUiState): StyledText | string {
  const party = game.state.party;
  const minions = livingMinions(game);
  // A minion that died or was dismissed while its page was open falls back to the first character.
  const selected = ui.characterIndex < party.length + minions.length ? ui.characterIndex : 0;
  const picker = pickerLines(game, minions, selected);
  if (selected >= party.length) return joinLines([...picker, ...minionLines(game, minions[selected - party.length]!)]);

  const character = party[selected];
  if (!character) return t("ui.characterInfoInvalidIndex");

  const cls = getClass(character.classId);
  const stats = characterStatBreakdown(character, game.state.satiety, game.state.boon);

  const lines: TextChunk[][] = [
    ...picker,
    [colorChunk(t("ui.characterInfoHeading", { name: character.name, level: character.level, cls: cls.name }), PALETTE.title)],
    [colorChunk(t("ui.characterInfoReligion", { name: getReligion(cls.religionId).name }), getReligion(cls.religionId).style.color)],
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
  lines.push(...statusLines(character.activeStatusEffects));

  return joinLines(lines);
}

export function renderFooter(_ui: CharacterInfoUiState, game: Game): string {
  return digitHint("ui.characterInfoFooter", game.state.party.length + livingMinions(game).length);
}
