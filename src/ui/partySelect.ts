import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent, type TextChunk } from "@opentui/core";
import type { AbilityDefinition, CharacterClass, Id, SkillDefinition } from "../types";
import { ABILITIES, formatAbilityEffect, getAbility } from "../data/abilities";
import { loadProfile } from "../engine/profile";
import { PALETTE, CLASS_STYLE, chip, colorChunk, boldColorChunk, plainChunk, joinLines, highlightKeyHints } from "./theme";
import { joinHints, withPageHint, digitHint } from "./keyHints";
import { spriteForClass, renderSpriteInSlot, spriteHeight, spriteWidth } from "./sprites";
import { wrapText, mergeBlocksHorizontally } from "./layout";
import { formatPassiveEffect } from "./screens/characterInfo";
import { skillEffectLine, skillMechanicLines } from "./screens/combat";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";

const PARTY_SIZE = BALANCE.party.size;
const ABILITY_PAGE_SIZE = 9;
/** Width of the text column beside the sprite, and of every wrapped line below it. */
const TEXT_WIDTH = 76;
/** The class skills shown on the browse screen: the two a level-1 character starts with. */
const PREVIEW_SLOTS = [1, 2];

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

function textLines(text: string, color: string, indent = ""): TextChunk[][] {
  return wrapText(text, TEXT_WIDTH - indent.length).map((line) => [colorChunk(indent + line, color)]);
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

/** The sprite on the left, `right` beside it; the shorter of the two is padded so the rows line up. */
function besideSprite(cls: CharacterClass, right: TextChunk[][]): TextChunk[][] {
  const sprite = spriteForClass(cls.id);
  const slotWidth = spriteWidth(sprite) + 2;
  const height = Math.max(spriteHeight(sprite), right.length);
  const left = renderSpriteInSlot(sprite, spriteHeight(sprite), slotWidth);
  const pad = (block: TextChunk[][], width: number) => {
    const out = block.map((row) => row);
    while (out.length < height) out.push([plainChunk(" ".repeat(width))]);
    return out;
  };
  return mergeBlocksHorizontally([pad(left, slotWidth), pad(right, 0)], 2);
}

function skillPreview(skill: SkillDefinition): TextChunk[][] {
  const lines: TextChunk[][] = [[boldColorChunk(t("partySelect.skillLine", { name: skill.name, mp: skill.mpCost }), PALETTE.text)]];
  if (skill.shortDescription) lines.push(...textLines(skill.shortDescription, PALETTE.dim, "  "));
  for (const effect of skill.effects ?? []) {
    const line = skillEffectLine(effect, skill);
    if (line) for (const part of line.split("\n")) lines.push([colorChunk(part, PALETTE.dim)]);
  }
  for (const line of skillMechanicLines(skill)) lines.push([colorChunk(line, PALETTE.dim)]);
  return lines;
}

function classDetail(cls: CharacterClass): TextChunk[][] {
  const right: TextChunk[][] = [
    [boldColorChunk(cls.name.toUpperCase(), PALETTE.title)],
    ...textLines(cls.description, PALETTE.text),
    [colorChunk(cls.roleTags.join(" · "), PALETTE.dim)],
    [],
    [
      colorChunk(
        t("partySelect.stats", {
          hp: cls.baseMaxHp,
          mp: cls.baseMaxMp,
          attack: cls.baseAttack,
          defense: cls.baseDefense,
          magic: cls.baseMagicPower,
          speed: cls.baseSpeed,
          aggro: cls.baseAggro,
        }),
        PALETTE.text
      ),
    ],
  ];
  const passive = cls.passiveSkill;
  const lines: TextChunk[][] = [
    ...besideSprite(cls, right),
    [],
    [boldColorChunk(t("partySelect.passiveLine", { name: passive.name, levels: passive.ranks.map((r) => r.unlockLevel).join(" / ") }), PALETTE.title)],
    ...textLines(passive.description, PALETTE.dim, "  "),
    ...textLines(formatPassiveEffect(passive, passive.ranks[0]!), PALETTE.text, "  "),
  ];
  for (const slot of PREVIEW_SLOTS) {
    const skill = cls.skills.find((s) => s.slot === slot);
    if (!skill) continue;
    lines.push([], ...skillPreview(skill));
  }
  return lines;
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
        ...classDetail(cls),
      ];
      body.content = joinLines(lines);
      footer.content = joinLines([highlightKeyHints(joinHints(t("partySelect.browseHint"), picks.length > 0 ? t("partySelect.undoHint") : null))]);
    };

    const renderAbility = (classId: Id, page: number) => {
      const cls = classes.find((c) => c.id === classId)!;
      const options = abilityOptions();
      const totalPages = Math.max(1, Math.ceil(options.length / ABILITY_PAGE_SIZE));
      const pageOptions = options.slice(page * ABILITY_PAGE_SIZE, (page + 1) * ABILITY_PAGE_SIZE);
      const list: TextChunk[][] = [];
      pageOptions.forEach((ability, i) => {
        list.push([colorChunk(t("partySelect.abilityLine", { i: i + 1, name: ability.name, rarity: ability.rarity }), PALETTE.text)]);
        list.push(...textLines(formatAbilityEffect(ability), PALETTE.dim, "      "));
      });
      if (pageOptions.length === 0) list.push([colorChunk(t("partySelect.noAbilities"), PALETTE.dim)]);
      list.push([], [colorChunk(t("partySelect.skipAbility"), PALETTE.dim)]);
      if (totalPages > 1) list.push([colorChunk(t("partySelect.pageTag", { page: page + 1, total: totalPages }), PALETTE.dim)]);
      const lines: TextChunk[][] = [
        [colorChunk(t("partySelect.abilityTitle", { name: cls.name, count: picks.length + 1, total: PARTY_SIZE }), PALETTE.title)],
        partyLine(picks, classes),
        [],
        ...besideSprite(cls, [[boldColorChunk(cls.name.toUpperCase(), PALETTE.title)], [colorChunk(cls.roleTags.join(" · "), PALETTE.dim)]]),
        [],
        ...list,
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

      const options = abilityOptions();
      const totalPages = Math.max(1, Math.ceil(options.length / ABILITY_PAGE_SIZE));
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
        const chosen = digit !== null ? options.slice(step.page * ABILITY_PAGE_SIZE, (step.page + 1) * ABILITY_PAGE_SIZE)[digit - 1] : undefined;
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
