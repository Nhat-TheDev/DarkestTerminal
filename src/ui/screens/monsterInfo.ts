import type { StyledText, TextChunk } from "@opentui/core";
import type { Game } from "../../engine/game";
import type { CombatStat, DamageType, Id, Monster, MonsterArchetype, MonsterTier, SkillDefinition } from "../../types";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";
import { t } from "../../data/strings";
import { MONSTER_ARCHETYPES, getArchetype, getBossTelegraph, getMonsterSkill } from "../../data/monsters";
import { getRace, getSubRace, getTrait, resolveRaceProfile } from "../../data/monsterRaces";
import { getStatusEffect, statusDisplayName, formatStatusEffectMechanics } from "../../data/statusEffects";
import { getActorByRef } from "../../engine/combat";
import { activeStatusCombatStatSum } from "../../engine/party";
import { PALETTE, boldColorChunk, colorChunk, hpColorFor, joinLines, plainChunk } from "../theme";
import { digitHint } from "../keyHints";
import { PAGE_SIZE } from "../pagination";
import { wrapText } from "../layout";
import { MONSTER_TARGET_SUFFIX, skillEffectLine, skillMechanicLines, statusTurnsSuffix } from "./combat";

export type MonsterInfoUiState = Extract<UiState, { kind: "monsterInfo" }>;
export type BestiaryUiState = Extract<UiState, { kind: "bestiary" }>;

const DETAIL_INDENT = "     ";
/** Wide enough for the longest row label, so the values line up. */
const ROW_LABEL_WIDTH = 8;
/** Matches the stat column of the character info screen. */
const STAT_LABEL_WIDTH = 12;

const TIER_LABEL: Record<MonsterTier, string> = {
  normal: t("ui.monsterTierNormal"),
  elite: t("ui.monsterTierElite"),
  boss: t("ui.monsterTierBoss"),
};

const DAMAGE_TYPE_LABEL: Record<DamageType, string> = {
  physical: t("ui.damageTypePhysical"),
  magic: t("ui.damageTypeMagic"),
  fire: t("ui.damageTypeFire"),
  ice: t("ui.damageTypeIce"),
  lightning: t("ui.damageTypeLightning"),
  poison: t("ui.damageTypePoison"),
  bleed: t("ui.damageTypeBleed"),
  holy: t("ui.damageTypeHoly"),
};

/** The monsters of the current fight, in the order they joined it, fallen ones included. */
export function fightMonsters(game: Game): Monster[] {
  const combat = game.state.combat;
  if (!combat) return [];
  return combat.combatants.filter((c) => c.ref.kind === "monster").map((c) => getActorByRef(c.ref, game.ctx) as Monster);
}

/** The slot's bestiary, in catalog order. */
export function bestiaryEntries(game: Game): MonsterArchetype[] {
  return MONSTER_ARCHETYPES.filter((a) => game.seenMonsterIds.includes(a.id));
}

export function handleKey(ctx: ScreenContext, ui: MonsterInfoUiState, digit: number | null): void {
  if (digit !== null && digit <= fightMonsters(ctx.game).length) ui.monsterIndex = digit - 1;
}

export function handleBestiaryKey(ctx: ScreenContext, ui: BestiaryUiState, digit: number | null): void {
  if (ui.viewingId !== null || digit === null) return;
  const entry = bestiaryEntries(ctx.game)[ctx.getListPage() * PAGE_SIZE + digit - 1];
  if (entry) ui.viewingId = entry.id;
}

const detail = (text: string, width: number): TextChunk[][] =>
  wrapText(text, width - DETAIL_INDENT.length).map((line) => [colorChunk(`${DETAIL_INDENT}${line}`, PALETTE.dim)]);

/** Skills the archetype can cast at `tier`: its weights, phases, bars, entry casts and telegraph. Every skill when no tier is given. */
function skillsFor(archetype: MonsterArchetype, tier: MonsterTier | null): SkillDefinition[] {
  if (tier === null) return archetype.skillIds.map(getMonsterSkill);
  const ids = new Set<Id>(Object.keys(archetype.actionWeights?.[tier] ?? {}));
  for (const phase of archetype.phases ?? []) if (phase.tier === tier) {
    for (const id of Object.keys(phase.weights)) ids.add(id);
    if (phase.onEnterSkillId) ids.add(phase.onEnterSkillId);
  }
  if (tier === "boss") {
    for (const bar of archetype.bars ?? []) {
      for (const id of Object.keys(bar.weights ?? {})) ids.add(id);
      if (bar.onEnterSkillId) ids.add(bar.onEnterSkillId);
      if (bar.bossTelegraph) ids.add(bar.bossTelegraph.skillId);
    }
    if (archetype.bossTelegraph) ids.add(archetype.bossTelegraph.skillId);
  }
  return archetype.skillIds.filter((id) => ids.has(id)).map(getMonsterSkill);
}

function percentList(values: Record<DamageType, number>): string | null {
  const parts = (Object.keys(DAMAGE_TYPE_LABEL) as DamageType[])
    .filter((type) => values[type] > 0)
    .sort((a, b) => values[b] - values[a])
    .map((type) => t("ui.monsterDamagePercent", { type: DAMAGE_TYPE_LABEL[type], percent: values[type] }));
  return parts.length > 0 ? parts.join(", ") : null;
}

const row = (label: string, value: string, color: string): TextChunk[] => [colorChunk(t("ui.monsterRow", { label: label.padEnd(ROW_LABEL_WIDTH), value }), color)];

/** Race and reach, for the heading line. */
function natureText(source: { race: Id; subRace?: Id }, archetype: MonsterArchetype): string {
  const race = getRace(source.race);
  const raceText = source.subRace ? t("ui.monsterRaceSub", { race: race.name, subRace: getSubRace(source.race, source.subRace).name }) : race.name;
  const range = archetype.attackRange === "ranged" ? t("ui.monsterRangeRanged") : t("ui.monsterRangeMelee");
  return t("ui.monsterRaceLine", { race: raceText, range });
}

/** Traits and the damage it takes more or less of, highest first. */
function natureRows(source: { race: Id; subRace?: Id; traitIds?: Id[] }): TextChunk[][] {
  const lines: TextChunk[][] = [];
  const traitIds = source.traitIds ?? [];
  if (traitIds.length > 0) lines.push(row(t("ui.monsterTraitsLabel"), traitIds.map((id) => getTrait(id).name).join(", "), PALETTE.text));
  const profile = resolveRaceProfile(source.race, source.subRace, traitIds);
  const weak = percentList(profile.weakPercent);
  const resist = percentList(profile.resistPercent);
  if (weak) lines.push(row(t("ui.monsterWeakLabel"), weak, PALETTE.hpHigh));
  if (resist) lines.push(row(t("ui.monsterResistLabel"), resist, PALETTE.hpLow));
  return lines;
}

/** One stat per row; a second row splits off what its status effects add, coloured as on the character info screen. */
export function statRows(label: string, shown: string, base: number, status: number, color: string): TextChunk[][] {
  const lines: TextChunk[][] = [[boldColorChunk(t("ui.characterInfoStatLine", { stat: label.padEnd(STAT_LABEL_WIDTH), total: shown }), color)]];
  if (status !== 0) {
    lines.push([
      plainChunk("   "),
      colorChunk(t("ui.characterInfoBaseTag", { base }), PALETTE.dim),
      plainChunk(" "),
      colorChunk(t("ui.characterInfoStatTag", { sign: status > 0 ? "+" : "", amount: status }), status > 0 ? PALETTE.hpHigh : PALETTE.hpLow),
    ]);
  }
  return lines;
}

function liveStatRows(monster: Monster): TextChunk[][] {
  const status = (stat: CombatStat) => activeStatusCombatStatSum(monster, stat);
  const hpStatus = status("maxHp");
  return [
    ...statRows(t("ui.monsterStatHp"), `${monster.hp}/${monster.maxHp}`, monster.maxHp - hpStatus, hpStatus, hpColorFor(monster.hp, monster.maxHp)),
    ...(["attack", "defense", "speed"] as const).flatMap((stat) =>
      statRows(t(STAT_LABEL_KEY[stat]), String(monster[stat]), monster[stat] - status(stat), status(stat), PALETTE.text)
    ),
  ];
}

const STAT_LABEL_KEY = { attack: "ui.characterInfoStatAttack", defense: "ui.characterInfoStatDefense", speed: "ui.characterInfoStatSpeed" } as const;

/** `partySide` words targets as a party member's skill does (enemies are the monsters). */
export function skillLines(skills: SkillDefinition[], head: (skill: SkillDefinition) => string, width: number, partySide = false): TextChunk[][] {
  const lines: TextChunk[][] = [[colorChunk(t("ui.monsterSkillsLabel"), PALETTE.title)]];
  if (skills.length === 0) lines.push([colorChunk(t("ui.monsterNoSkills"), PALETTE.dim)]);
  for (const skill of skills) {
    lines.push([colorChunk(head(skill), PALETTE.text)]);
    const effects = [...(skill.effects ?? []).map((e) => (partySide ? skillEffectLine(e, skill) : skillEffectLine(e, skill, MONSTER_TARGET_SUFFIX))), ...skillMechanicLines(skill)];
    for (const effect of effects) {
      if (effect === null) continue;
      for (const line of effect.split("\n")) lines.push(...detail(line.trim(), width));
    }
    lines.push(...detail(skill.description, width));
  }
  return lines;
}

/** A skill as the bestiary shows it: its cooldown and use limit, not the state of one fight. */
function catalogSkillHead(skill: SkillDefinition): string {
  if (skill.usesPerCombat !== undefined) return t("ui.monsterSkillUsesTag", { name: skill.name, uses: skill.usesPerCombat });
  if (skill.cooldownTurns) return t("ui.monsterSkillCooldownTag", { name: skill.name, turns: skill.cooldownTurns });
  return t("ui.monsterSkillReady", { name: skill.name });
}

function liveSkillHead(monster: Monster, skill: SkillDefinition): string {
  if (skill.usesPerCombat !== undefined && (monster.skillUses?.[skill.id] ?? 0) >= skill.usesPerCombat) return t("ui.monsterSkillSpent", { name: skill.name });
  const cooldown = monster.skillCooldowns?.[skill.id] ?? 0;
  return cooldown > 0 ? t("ui.monsterSkillCooldown", { name: skill.name, turns: cooldown }) : t("ui.monsterSkillReady", { name: skill.name });
}

export function renderMain(game: Game, ui: MonsterInfoUiState, width: number): StyledText {
  const monsters = fightMonsters(game);
  const picker: TextChunk[] = [];
  monsters.forEach((m, i) => {
    if (i > 0) picker.push(plainChunk("  "));
    const label = t("ui.monsterPickerEntry", { index: i + 1, name: m.name });
    if (i === ui.monsterIndex) picker.push(boldColorChunk(label, PALETTE.title));
    else picker.push(colorChunk(label, m.hp > 0 ? PALETTE.dim : PALETTE.dead));
  });
  const monster = monsters[ui.monsterIndex] ?? monsters[0];
  if (!monster) return joinLines([picker]);
  const archetype = getArchetype(monster.archetypeId);

  const lines: TextChunk[][] = [
    picker,
    [boldColorChunk(t("ui.monsterInfoHeading", { name: archetype.name, tier: TIER_LABEL[monster.tier], nature: natureText(monster, archetype) }), PALETTE.title)],
    ...natureRows(monster),
  ];
  if (monster.hp <= 0) {
    lines.push([colorChunk(t("ui.monsterFallenLine"), PALETTE.dead)]);
  } else {
    lines.push(...liveStatRows(monster));
    const bars = monster.tier === "boss" ? archetype.bars : undefined;
    const barIndex = monster.barIndex ?? 0;
    if (bars) lines.push([colorChunk(t("ui.monsterBarPhase", { n: barIndex + 1, total: bars.length }), PALETTE.dim)]);
    if (monster.shell) {
      lines.push([
        monster.shell.state === "intact"
          ? colorChunk(monster.shell.hitsLeft === 1 ? t("ui.shellIntactOne") : t("ui.shellIntact", { hits: monster.shell.hitsLeft }), PALETTE.mp)
          : colorChunk(t("ui.shellBroken"), PALETTE.fearPanic),
      ]);
    }
    const telegraph = monster.tier === "boss" ? getBossTelegraph(archetype, barIndex) : undefined;
    if (telegraph) {
      const filled = Math.min(monster.telegraphMeter ?? 0, telegraph.meterLength);
      lines.push([
        colorChunk(t("ui.monsterTelegraphLine", { skill: getMonsterSkill(telegraph.skillId).name }), PALETTE.text),
        colorChunk(t("ui.telegraphMeterFilled").repeat(filled), PALETTE.fearPanic),
        colorChunk(t("ui.telegraphMeterEmpty").repeat(telegraph.meterLength - filled), PALETTE.dim),
      ]);
    }
  }
  lines.push([]);
  lines.push(...skillLines(skillsFor(archetype, monster.tier), (skill) => liveSkillHead(monster, skill), width));

  if (monster.hp > 0) {
    lines.push([]);
    lines.push([colorChunk(t("ui.monsterStatusLabel"), PALETTE.title)]);
    if (monster.activeStatusEffects.length === 0) lines.push([colorChunk(t("ui.characterInfoNone"), PALETTE.dim)]);
    for (const active of monster.activeStatusEffects) {
      const def = getStatusEffect(active.statusEffectId);
      const stacks = active.stacks && active.stacks > 1 ? t("ui.statusStacksSuffix", { stacks: active.stacks }) : "";
      lines.push([colorChunk(`${t("ui.characterInfoListItem", { name: statusDisplayName(def) })}${statusTurnsSuffix(active.turnsRemaining)}${stacks}`, PALETTE.text)]);
      lines.push(...detail(formatStatusEffectMechanics(def, { applied: active.appliedAmounts }), width));
    }
  }
  lines.push([]);
  for (const line of wrapText(archetype.description, width)) lines.push([colorChunk(line, PALETTE.dim)]);
  return joinLines(lines);
}

export function renderFooter(game: Game): string {
  return digitHint("ui.footerMonsterInfo", fightMonsters(game).length);
}

function renderEntry(archetype: MonsterArchetype, width: number): TextChunk[][] {
  const lines: TextChunk[][] = [
    [boldColorChunk(t("ui.monsterEntryHeading", { name: archetype.name, nature: natureText(archetype, archetype) }), PALETTE.title)],
    ...natureRows(archetype),
    row(t("ui.monsterRolesLabel"), archetype.roles.map((r) => TIER_LABEL[r]).join(", "), PALETTE.text),
  ];
  if (archetype.minFloor !== undefined && archetype.minFloor > 0) lines.push(row(t("ui.monsterMinFloorLabel"), t("ui.monsterMinFloorValue", { floor: archetype.minFloor }), PALETTE.text));
  lines.push(...statRows(t("ui.monsterStatHp"), String(archetype.baseHp), archetype.baseHp, 0, PALETTE.text));
  lines.push(...statRows(t("ui.characterInfoStatAttack"), String(archetype.baseAttack), archetype.baseAttack, 0, PALETTE.text));
  lines.push(...statRows(t("ui.characterInfoStatDefense"), String(archetype.baseDefense), archetype.baseDefense, 0, PALETTE.text));
  lines.push(...statRows(t("ui.characterInfoStatSpeed"), String(archetype.baseSpeed), archetype.baseSpeed, 0, PALETTE.text));
  lines.push([colorChunk(t("ui.monsterBaseStatsNote"), PALETTE.dim)]);
  lines.push([]);
  lines.push(...skillLines(skillsFor(archetype, null), catalogSkillHead, width));
  lines.push([]);
  for (const line of wrapText(archetype.description, width)) lines.push([colorChunk(line, PALETTE.dim)]);
  return lines;
}

export function renderBestiary(game: Game, ui: BestiaryUiState, page: number, width: number): StyledText {
  if (ui.viewingId !== null) return joinLines(renderEntry(getArchetype(ui.viewingId), width));
  const entries = bestiaryEntries(game);
  const lines: TextChunk[][] = [[colorChunk(t("ui.bestiaryHeading", { seen: entries.length, total: MONSTER_ARCHETYPES.length }), PALETTE.title)], []];
  if (entries.length === 0) lines.push([colorChunk(t("ui.bestiaryEmpty"), PALETTE.dim)]);
  entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((a, i) => lines.push([colorChunk(t("ui.bestiaryEntry", { index: i + 1, name: a.name }), PALETTE.text)]));
  return joinLines(lines);
}

export function renderBestiaryFooter(game: Game, ui: BestiaryUiState, page: number): string {
  if (ui.viewingId !== null) return t("ui.footerBackOnly");
  return digitHint("ui.footerBestiary", Math.max(0, Math.min(PAGE_SIZE, bestiaryEntries(game).length - page * PAGE_SIZE)));
}
