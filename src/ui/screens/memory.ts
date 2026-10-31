import type { KeyEvent } from "@opentui/core";
import type { Id } from "../../types";
import { t } from "../../data/strings";
import { formatAbilityEffect, getAbility } from "../../data/abilities";
import { MIN_TERMINAL_WIDTH, PARTY_PANEL_WIDTH, SIDE_PANEL_WIDTH, wrapText } from "../layout";
import { paginateByRows } from "../pagination";
import type { UiState } from "../state";
import { proceedAfterVictory, type ScreenContext } from "./context";

export type MemoryUiState = Extract<UiState, { kind: "memory" }>;

export const MEMORY_PAGE_SIZE = 5;
/** The Dungeon panel's inner height at the minimum terminal size, less the title and the blank line under it. */
export const MEMORY_LIST_ROWS = 11;
/** The Dungeon panel's inner width at the minimum terminal size: what the two side columns and its own border leave. */
export const MEMORY_LIST_WIDTH = MIN_TERMINAL_WIDTH - PARTY_PANEL_WIDTH - SIDE_PANEL_WIDTH - 2;
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

/** Each page's lines: at most `MEMORY_PAGE_SIZE` entries that fit `MEMORY_LIST_ROWS` rows, so long effects mean fewer per page. Empty for no abilities. */
export function memoryPages(abilityIds: Id[]): string[][] {
  if (abilityIds.length === 0) return [];
  return paginateByRows(abilityIds.map(entryLines), (lines) => lines.length, MEMORY_PAGE_SIZE, MEMORY_LIST_ROWS).map((page) => page.flat());
}

export function renderMain(ui: MemoryUiState, page: number): string {
  const lines = [t("ui.memoryTitle"), ""];
  lines.push(...(ui.pages[page] ?? [t("ui.memoryEmpty")]));
  return lines.join("\n");
}

export function renderFooter(): string {
  return t("ui.footerMemory");
}
