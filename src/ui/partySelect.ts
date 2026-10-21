import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent, type TextChunk } from "@opentui/core";
import type { AbilityDefinition, CharacterClass, Id, SkillDefinition } from "../types";
import { ABILITIES, formatAbilityEffect, getAbility } from "../data/abilities";
import { loadProfile } from "../engine/profile";
import { PALETTE, CLASS_STYLE, chip, colorChunk, boldColorChunk, plainChunk, joinLines, highlightKeyHints } from "./theme";
import { joinHints, withPageHint, digitHint } from "./keyHints";
import { spriteForClass, renderSpriteInSlot, spriteHeight } from "./sprites";
import { wrapText } from "./layout";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";

const PARTY_SIZE = BALANCE.party.size;
const ABILITY_PAGE_SIZE = 9;
/** Rows of the Ability list: nine entries whose effect fits on one line. A page holds fewer entries when longer effects wrap, so the block never grows. */
const ABILITY_LIST_ROWS = 18;
/** The class skills shown on the browse screen: the two a level-1 character starts with. */
const PREVIEW_SLOTS = [1, 2];
/** Inner size of the sprite box on the browse screen. */
const SPRITE_BOX_WIDTH = 15;
const SPRITE_BOX_HEIGHT = 10;
/** Inner width of the browse block's full-width panels; the stats box takes what the sprite box leaves. */
const BLOCK_INNER_WIDTH = 86;
const STATS_WIDTH = BLOCK_INNER_WIDTH - SPRITE_BOX_WIDTH - 1;

export interface PartyPick {
  classId: Id;
  abilityId: Id | null;
}

type Step = { kind: "browse"; index: number } | { kind: "ability"; classId: Id; page: number };

/** Every `common` ability, plus every non-`common` id in the persistent profile, minus the ones already taken this screen — `11-abilities.md` §11.1. */
function selectableAbilities(taken: Id[]): AbilityDefinition[] {
  const profile = loadProfile();
  return ABILITIES.filter((a) => (a.rarity === "common" || profile.unlockedAbilityIds.includes(a.id)) && !taken.includes(a.id));
}

/** The party so far, one bracket per seat: class and ability for a filled one, empty for the rest. */
function partyLine(picks: PartyPick[], classes: CharacterClass[]): TextChunk[] {
  const chunks: TextChunk[] = [colorChunk(t("partySelect.partyLabel"), PALETTE.dim)];
  for (let i = 0; i < PARTY_SIZE; i++) {
    chunks.push(plainChunk("  "));
    const pick = picks[i];
    if (!pick) {
      chunks.push(colorChunk(t("partySelect.emptySeat"), PALETTE.disabled));
      continue;
    }
    const cls = classes.find((c) => c.id === pick.classId)!;
    const style = CLASS_STYLE[cls.id];
    if (style) chunks.push(chip(style.abbr, style.color), plainChunk(" "));
    const ability = pick.abilityId ? getAbility(pick.abilityId).name : t("partySelect.noAbility");
    chunks.push(colorChunk(t("partySelect.seat", { name: cls.name, ability }), PALETTE.text));
  }
  return chunks;
}

function chunksWidth(row: TextChunk[]): number {
  return row.reduce((sum, chunk) => sum + chunk.text.length, 0);
}

/** `rows` as exactly `height` rows (extra ones dropped, missing ones blank), each padded out to `width` columns, so a panel never changes size. */
function fitBlock(rows: TextChunk[][], width: number, height: number): TextChunk[][] {
  const out: TextChunk[][] = [];
  for (let i = 0; i < height; i++) {
    const row = rows[i] ?? [];
    out.push([...row, plainChunk(" ".repeat(Math.max(0, width - chunksWidth(row))))]);
  }
  return out;
}

const border = (text: string) => colorChunk(text, PALETTE.border);

/** Panel text wrapped to the panel's width, with a one-column margin on each side. */
function panelText(text: string, color: string, width: number, indent = ""): TextChunk[][] {
  return wrapText(text, width - 2 - indent.length).map((line) => [colorChunk(` ${indent}${line}`, color)]);
}

function previewSkills(cls: CharacterClass): SkillDefinition[] {
  return PREVIEW_SLOTS.map((slot) => cls.skills.find((s) => s.slot === slot)).filter((s): s is SkillDefinition => s !== undefined);
}

function skillsPanel(cls: CharacterClass): TextChunk[][] {
  return previewSkills(cls).flatMap((skill) => [
    [boldColorChunk(` ${skill.name}`, PALETTE.text)],
    ...(skill.shortDescription ? panelText(skill.shortDescription, PALETTE.dim, BLOCK_INNER_WIDTH, "  ") : []),
  ]);
}

function passivePanel(cls: CharacterClass): TextChunk[][] {
  const passive = cls.passiveSkill;
  return [
    [boldColorChunk(` ${t("partySelect.passiveLine", { name: passive.name })}`, PALETTE.title)],
    ...panelText(passive.description, PALETTE.dim, BLOCK_INNER_WIDTH, "  "),
  ];
}

function statsPanel(cls: CharacterClass): TextChunk[][] {
  const pad = (value: number) => String(value).padStart(3);
  return [
    [boldColorChunk(` ${cls.name.toUpperCase()}`, PALETTE.title)],
    ...panelText(cls.roleTags.join(" · "), PALETTE.dim, STATS_WIDTH),
    [],
    [colorChunk(` ${t("partySelect.statsRow1", { hp: pad(cls.baseMaxHp), attack: pad(cls.baseAttack), magic: pad(cls.baseMagicPower), aggro: pad(cls.baseAggro) })}`, PALETTE.text)],
    [colorChunk(` ${t("partySelect.statsRow2", { mp: pad(cls.baseMaxMp), defense: pad(cls.baseDefense), speed: pad(cls.baseSpeed) })}`, PALETTE.text)],
  ];
}

/** The rows each full-width panel gets: enough for the longest class, so browsing never resizes the block. */
function panelHeights(classes: CharacterClass[]) {
  const max = (panel: (cls: CharacterClass) => TextChunk[][]) => Math.max(...classes.map((cls) => panel(cls).length));
  return {
    description: max((cls) => panelText(cls.description, PALETTE.text, BLOCK_INNER_WIDTH)),
    skills: max(skillsPanel),
    passive: max(passivePanel),
  };
}

/** The top of a class block: the sprite box beside the stats box, opened by the block's top border. */
function classHeader(cls: CharacterClass): TextChunk[][] {
  const sprite = spriteForClass(cls.id);
  const spriteRows = renderSpriteInSlot(sprite, Math.min(spriteHeight(sprite), SPRITE_BOX_HEIGHT), SPRITE_BOX_WIDTH);
  const topPad = Math.floor((SPRITE_BOX_HEIGHT - spriteRows.length) / 2);
  const spriteBox = fitBlock([...Array.from({ length: topPad }, () => []), ...spriteRows], SPRITE_BOX_WIDTH, SPRITE_BOX_HEIGHT);
  const statsBox = fitBlock(statsPanel(cls), STATS_WIDTH, SPRITE_BOX_HEIGHT);
  const rule = (left: string, mid: string, right: string) =>
    [border(left + "─".repeat(SPRITE_BOX_WIDTH) + mid + "─".repeat(STATS_WIDTH) + right)];
  return [
    rule("┌", "┬", "┐"),
    ...spriteBox.map((row, i) => [border("│"), ...row, border("│"), ...statsBox[i]!, border("│")]),
    rule("├", "┴", "┤"),
  ];
}

const fullRule = (left: string, right: string) => [border(left + "─".repeat(BLOCK_INNER_WIDTH) + right)];
const framed = (rows: TextChunk[][], height: number) =>
  fitBlock(rows, BLOCK_INNER_WIDTH, height).map((row) => [border("│"), ...row, border("│")]);

/** The class as one fixed-size bordered block: sprite | stats, then description, skills and passive. */
function classDetail(cls: CharacterClass, heights: ReturnType<typeof panelHeights>): TextChunk[][] {
  return [
    ...classHeader(cls),
    ...framed(panelText(cls.description, PALETTE.text, BLOCK_INNER_WIDTH), heights.description),
    fullRule("├", "┤"),
    ...framed(skillsPanel(cls), heights.skills),
    fullRule("├", "┤"),
    ...framed(passivePanel(cls), heights.passive),
    fullRule("└", "┘"),
  ];
}

function abilityEntry(ability: AbilityDefinition, i: number): TextChunk[][] {
  return [
    [colorChunk(t("partySelect.abilityLine", { i: i + 1, name: ability.name, rarity: ability.rarity }), PALETTE.text)],
    ...panelText(formatAbilityEffect(ability), PALETTE.dim, BLOCK_INNER_WIDTH, "     "),
  ];
}

/** `options` split into pages of at most `ABILITY_PAGE_SIZE` entries that fit `ABILITY_LIST_ROWS` rows; always at least one page. */
function abilityPages(options: AbilityDefinition[]): AbilityDefinition[][] {
  const pages: AbilityDefinition[][] = [[]];
  let rows = 0;
  for (const ability of options) {
    const height = abilityEntry(ability, 0).length;
    const page = pages[pages.length - 1]!;
    if (page.length > 0 && (page.length >= ABILITY_PAGE_SIZE || rows + height > ABILITY_LIST_ROWS)) {
      pages.push([ability]);
      rows = height;
    } else {
      page.push(ability);
      rows += height;
    }
  }
  return pages;
}

/** The class header, then one page of Abilities and the skip/page line, at a fixed size. */
function abilityDetail(cls: CharacterClass, pageOptions: AbilityDefinition[], page: number, totalPages: number): TextChunk[][] {
  const list = pageOptions.flatMap((ability, i) => abilityEntry(ability, i));
  if (pageOptions.length === 0) list.push([colorChunk(t("partySelect.noAbilities"), PALETTE.dim)]);
  const skip = t("partySelect.skipAbility");
  const pageTag = totalPages > 1 ? `${t("partySelect.pageTag", { page: page + 1, total: totalPages })} ` : "";
  const gap = " ".repeat(Math.max(1, BLOCK_INNER_WIDTH - skip.length - pageTag.length));
  return [
    ...classHeader(cls),
    ...framed(list, ABILITY_LIST_ROWS),
    fullRule("├", "┤"),
    ...framed([[colorChunk(skip, PALETTE.dim), plainChunk(gap), colorChunk(pageTag, PALETTE.dim)]], 1),
    fullRule("└", "┘"),
  ];
}

/**
 * Party creation in one screen: browse the classes one at a time, pick one, choose its Ability, and
 * repeat until the party is full. A picked class leaves the browse list, so the party is always 4
 * different classes; an Ability is never offered twice either (an invariant the death flow relies on,
 * `11-abilities.md` §11.1). `Esc` steps back: out of the Ability list to the class it was for, or
 * from browsing to undo the last finished pick.
 */
export function showPartySelect(renderer: CliRenderer, classes: CharacterClass[]): Promise<PartyPick[]> {
  return new Promise((resolve) => {
    const root = new BoxRenderable(renderer, {
      id: "partyselect-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PALETTE.bg,
    });
    renderer.root.add(root);
    const body = new TextRenderable(renderer, { id: "partyselect-body", content: "" });
    root.add(body);
    const footer = new TextRenderable(renderer, { id: "partyselect-footer", content: "", position: "absolute", left: 2, bottom: 1 });
    root.add(footer);

    const heights = panelHeights(classes);
    const picks: PartyPick[] = [];
    let step: Step = { kind: "browse", index: 0 };

    const available = () => classes.filter((c) => !picks.some((p) => p.classId === c.id));
    const abilityOptions = () => selectableAbilities(picks.map((p) => p.abilityId).filter((id): id is Id => id !== null));

    const renderBrowse = (index: number) => {
      const pool = available();
      const cls = pool[index]!;
      const lines: TextChunk[][] = [
        [colorChunk(t("partySelect.browseTitle", { count: picks.length, total: PARTY_SIZE }), PALETTE.title)],
        partyLine(picks, classes),
        [],
        [colorChunk(t("partySelect.browsePosition", { index: index + 1, total: pool.length }), PALETTE.dim)],
        ...classDetail(cls, heights),
      ];
      body.content = joinLines(lines);
      footer.content = joinLines([highlightKeyHints(joinHints(t("partySelect.browseHint"), picks.length > 0 ? t("partySelect.undoHint") : null))]);
    };

    const renderAbility = (classId: Id, page: number) => {
      const cls = classes.find((c) => c.id === classId)!;
      const pages = abilityPages(abilityOptions());
      const totalPages = pages.length;
      const pageOptions = pages[page] ?? [];
      const lines: TextChunk[][] = [
        [colorChunk(t("partySelect.abilityTitle", { name: cls.name, count: picks.length + 1, total: PARTY_SIZE }), PALETTE.title)],
        partyLine(picks, classes),
        [],
        ...abilityDetail(cls, pageOptions, page, totalPages),
      ];
      body.content = joinLines(lines);
      const contextual = joinHints(digitHint("partySelect.abilityHint", pageOptions.length, "partySelect.abilityHintSkipOnly"), t("partySelect.abilityBackHint"));
      footer.content = joinLines([highlightKeyHints(withPageHint(contextual, totalPages > 1))]);
    };

    const render = () => (step.kind === "browse" ? renderBrowse(step.index) : renderAbility(step.classId, step.page));
    render();

    const finish = () => {
      renderer.keyInput.off("keypress", onKey);
      renderer.root.remove(root);
      resolve(picks);
    };

    const onKey = (key: KeyEvent) => {
      if (step.kind === "browse") {
        const pool = available();
        if (key.name === "left" || key.name === "right") {
          step = { kind: "browse", index: (step.index + (key.name === "right" ? 1 : -1) + pool.length) % pool.length };
        } else if (key.name === "return") {
          step = { kind: "ability", classId: pool[step.index]!.id, page: 0 };
        } else if (key.name === "escape" && picks.length > 0) {
          const undone = picks.pop()!;
          step = { kind: "browse", index: available().findIndex((c) => c.id === undone.classId) };
        } else return;
        render();
        return;
      }

      const pages = abilityPages(abilityOptions());
      const totalPages = pages.length;
      if ((key.name === "left" || key.name === "right") && totalPages > 1) {
        step = { ...step, page: (step.page + (key.name === "right" ? 1 : -1) + totalPages) % totalPages };
        render();
        return;
      }
      if (key.name === "escape") {
        const classId = step.classId;
        step = { kind: "browse", index: available().findIndex((c) => c.id === classId) };
        render();
        return;
      }
      let abilityId: Id | null;
      if (key.name === "0") abilityId = null;
      else {
        const digit = /^[1-9]$/.test(key.name) ? Number(key.name) : null;
        const chosen = digit !== null ? pages[step.page]?.[digit - 1] : undefined;
        if (!chosen) return;
        abilityId = chosen.id;
      }
      const pickedClassId = step.classId;
      const pickedIndex = classes.findIndex((c) => c.id === pickedClassId);
      picks.push({ classId: pickedClassId, abilityId });
      if (picks.length >= PARTY_SIZE) return finish();
      // Land on the class that followed the one just picked, so browsing carries on where it left off.
      const pool = available();
      const next = pool.findIndex((c) => classes.indexOf(c) > pickedIndex);
      step = { kind: "browse", index: next === -1 ? 0 : next };
      render();
    };
    renderer.keyInput.on("keypress", onKey);
  });
}
