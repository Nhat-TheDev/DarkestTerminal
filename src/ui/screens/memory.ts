import type { KeyEvent } from "@opentui/core";
import type { Id } from "../../types";
import { t } from "../../data/strings";
import { formatAbilityEffect, getAbility } from "../../data/abilities";
import { wrapText } from "../layout";
import type { UiState } from "../state";
import { proceedAfterVictory, type ScreenContext } from "./context";

export type MemoryUiState = Extract<UiState, { kind: "memory" }>;

export const MEMORY_PAGE_SIZE = 5;
/** The Dungeon panel's inner size at the minimum terminal size, less the title and the blank line under it. */
export const MEMORY_LIST_ROWS = 11;
const MEMORY_LIST_WIDTH = 79;
const EFFECT_INDENT = "      ";

export function handleIntroKey(ctx: ScreenContext, key: KeyEvent): void {
  if (key.name !== "return") return;
  ctx.game.dismissMemoryIntro();
  proceedAfterVictory(ctx);
}

export function renderIntro(): string {
  return t("ui.memoryIntro");
}

export function renderIntroFooter(): string {
  return t("ui.footerMemoryIntro");
}

function entryLines(id: Id): string[] {
  const ability = getAbility(id);
  const effect = wrapText(formatAbilityEffect(ability), MEMORY_LIST_WIDTH - EFFECT_INDENT.length).map((line) => EFFECT_INDENT + line);
  return [t("ui.memoryEntry", { name: ability.name, rarity: ability.rarity }), ...effect];
}

/** At most `MEMORY_PAGE_SIZE` entries that fit `MEMORY_LIST_ROWS` rows, so a page with long effects holds fewer; always at least one page. */
export function memoryPages(abilityIds: Id[]): string[][] {
  const pages: string[][] = [[]];
  let entries = 0;
  for (const id of abilityIds) {
    const lines = entryLines(id);
    const page = pages[pages.length - 1]!;
    if (entries > 0 && (entries >= MEMORY_PAGE_SIZE || page.length + lines.length > MEMORY_LIST_ROWS)) {
      pages.push([...lines]);
      entries = 1;
      continue;
    }
    page.push(...lines);
    entries++;
  }
  return pages;
}

export function renderMain(ui: MemoryUiState, page: number): string {
  const lines = [t("ui.memoryTitle"), ""];
  if (ui.abilityIds.length === 0) {
    lines.push(t("ui.memoryEmpty"));
    return lines.join("\n");
  }
  const pages = memoryPages(ui.abilityIds);
  lines.push(...pages[Math.min(Math.max(page, 0), pages.length - 1)]!);
  return lines.join("\n");
}

export function renderFooter(): string {
  return t("ui.footerMemory");
}
