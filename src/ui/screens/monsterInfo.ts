import type { TextChunk } from "@opentui/core";
import type { Game } from "../../engine/game";
import type { DamageType, Id, Monster, MonsterArchetype, MonsterTier, SkillDefinition } from "../../types";
import type { UiState } from "../state";
import type { ScreenContext } from "./context";
import { t } from "../../data/strings";
import { MONSTER_ARCHETYPES, getArchetype, getBossTelegraph, getMonsterSkill } from "../../data/monsters";
import { getRace, getSubRace, getTrait, resolveRaceProfile } from "../../data/monsterRaces";
import { getStatusEffect, statusDisplayName, formatStatusEffectMechanics } from "../../data/statusEffects";
import { getActorByRef } from "../../engine/combat";
import { PALETTE, boldColorChunk, colorChunk, hpColorFor, plainChunk } from "../theme";
import { digitHint } from "../keyHints";
import { PAGE_SIZE } from "../pagination";
import { wrapText } from "../layout";
import { MONSTER_TARGET_SUFFIX, skillEffectLine, skillMechanicLines, statusTurnsSuffix } from "./combat";

export type MonsterInfoUiState = Extract<UiState, { kind: "monsterInfo" }>;
export type BestiaryUiState = Extract<UiState, { kind: "bestiary" }>;

const DETAIL_INDENT = "     ";

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
    .map((type) => t("ui.monsterDamagePercent", { type: DAMAGE_TYPE_LABEL[type], percent: values[type] }));
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Race, traits, reach, and the damage it takes more or less of. */
function natureLines(source: { race: Id; subRace?: Id; traitIds?: Id[] }, archetype: MonsterArchetype): TextChunk[][] {
  const race = getRace(source.race);
  const raceText = source.subRace ? t("ui.monsterRaceSub", { race: race.name, subRace: getSubRace(source.race, source.subRace).name }) : race.name;
  const range = archetype.attackRange === "ranged" ? t("ui.monsterRangeRanged") : t("ui.monsterRangeMelee");
  const lines: TextChunk[][] = [[colorChunk(t("ui.monsterRaceLine", { race: raceText, range }), PALETTE.text)]];
  const traitIds = source.traitIds ?? [];
  if (traitIds.length > 0) lines.push([colorChunk(t("ui.monsterTraitsLine", { traits: traitIds.map((id) => getTrait(id).name).join(", ") }), PALETTE.text)]);
  const profile = resolveRaceProfile(source.race, source.subRace, traitIds);
  const weak = percentList(profile.weakPercent);
  const resist = percentList(profile.resistPercent);
  if (weak) lines.push([colorChunk(t("ui.monsterWeakLine", { list: weak }), PALETTE.hpHigh)]);
  if (resist) lines.push([colorChunk(t("ui.monsterResistLine", { list: resist }), PALETTE.hpLow)]);
  return lines;
}

function skillLines(skills: SkillDefinition[], head: (skill: SkillDefinition) => string, width: number): TextChunk[][] {
  const lines: TextChunk[][] = [[colorChunk(t("ui.monsterSkillsLabel"), PALETTE.title)]];
  if (skills.length === 0) lines.push([colorChunk(t("ui.monsterNoSkills"), PALETTE.dim)]);
  for (const skill of skills) {
    lines.push([colorChunk(head(skill), PALETTE.text)]);
    const effects = [...(skill.effects ?? []).map((e) => skillEffectLine(e, skill, MONSTER_TARGET_SUFFIX)), ...skillMechanicLines(skill)];
    for (const effect of effects) {
      if (effect === null) continue;
      for (const line of effect.split("\n")) lines.push([colorChunk(`  ${line}`, PALETTE.dim)]);
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

export function renderPage(game: Game, ui: MonsterInfoUiState, width: number): TextChunk[][] {
  const monsters = fightMonsters(game);
  const picker: TextChunk[] = [];
  monsters.forEach((m, i) => {
    if (i > 0) picker.push(plainChunk("  "));
    const label = t("ui.monsterPickerEntry", { index: i + 1, name: m.name });
    if (i === ui.monsterIndex) picker.push(boldColorChunk(label, PALETTE.title));
    else picker.push(colorChunk(label, m.hp > 0 ? PALETTE.dim : PALETTE.dead));
  });
  const monster = monsters[ui.monsterIndex] ?? monsters[0];
  if (!monster) return [picker];
  const archetype = getArchetype(monster.archetypeId);

  const lines: TextChunk[][] = [picker, [], [boldColorChunk(t("ui.monsterInfoHeading", { name: archetype.name, tier: TIER_LABEL[monster.tier] }), PALETTE.title)]];
  lines.push(...natureLines(monster, archetype));
  if (monster.hp <= 0) {
    lines.push([colorChunk(t("ui.monsterFallenLine"), PALETTE.dead)]);
  } else {
    lines.push([
      colorChunk(
        t("ui.monsterStatsLine", { hp: monster.hp, maxHp: monster.maxHp, attack: monster.attack, defense: monster.defense, speed: monster.speed }),
        hpColorFor(monster.hp, monster.maxHp)
      ),
    ]);
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
  return lines;
}

export function renderFooter(game: Game): string {
  return digitHint("ui.footerMonsterInfo", fightMonsters(game).length);
}

function renderEntry(archetype: MonsterArchetype, width: number): TextChunk[][] {
  const lines: TextChunk[][] = [[boldColorChunk(archetype.name, PALETTE.title)]];
  lines.push(...natureLines(archetype, archetype));
  lines.push([colorChunk(t("ui.monsterRolesLine", { roles: archetype.roles.map((r) => TIER_LABEL[r]).join(", ") }), PALETTE.text)]);
  if (archetype.minFloor !== undefined && archetype.minFloor > 0) lines.push([colorChunk(t("ui.monsterMinFloorLine", { floor: archetype.minFloor }), PALETTE.text)]);
  lines.push([colorChunk(t("ui.monsterBaseStatsLine", { hp: archetype.baseHp, attack: archetype.baseAttack, defense: archetype.baseDefense, speed: archetype.baseSpeed }), PALETTE.text)]);
  lines.push([colorChunk(t("ui.monsterBaseStatsNote"), PALETTE.dim)]);
  lines.push([]);
  lines.push(...skillLines(skillsFor(archetype, null), catalogSkillHead, width));
  lines.push([]);
  for (const line of wrapText(archetype.description, width)) lines.push([colorChunk(line, PALETTE.dim)]);
  return lines;
}

export function renderBestiary(game: Game, ui: BestiaryUiState, page: number, width: number): TextChunk[][] {
  if (ui.viewingId !== null) return renderEntry(getArchetype(ui.viewingId), width);
  const entries = bestiaryEntries(game);
  const lines: TextChunk[][] = [[colorChunk(t("ui.bestiaryHeading", { seen: entries.length, total: MONSTER_ARCHETYPES.length }), PALETTE.title)], []];
  if (entries.length === 0) lines.push([colorChunk(t("ui.bestiaryEmpty"), PALETTE.dim)]);
  entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach((a, i) => lines.push([colorChunk(t("ui.bestiaryEntry", { index: i + 1, name: a.name }), PALETTE.text)]));
  return lines;
}

export function renderBestiaryFooter(game: Game, ui: BestiaryUiState, page: number): string {
  if (ui.viewingId !== null) return t("ui.footerBackOnly");
  return digitHint("ui.footerBestiary", Math.max(0, Math.min(PAGE_SIZE, bestiaryEntries(game).length - page * PAGE_SIZE)));
}
