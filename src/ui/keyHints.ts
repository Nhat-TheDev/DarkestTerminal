import { t } from "../data/strings";
import type { UiState } from "./state";

export const HINT_GAP = "   ";
export const GROUP_SEP = "   │   ";

/** These lists mirror the guards in `App.handleKey`: edit them together. */
const PARTY_INFO_KINDS: readonly UiState["kind"][] = [
  "room",
  "rest",
  "pickAction",
  "pickSkill",
  "skillDetail",
  "pickCommandMinion",
  "pickCommandSkill",
  "pickItemInCombat",
  "pickTarget",
  "roundResolved",
  "combatOver",
  "pickItemOutOfCombat",
  "itemDetail",
  "artifactMenu",
  "artifactDetail",
  "roomReward",
  "campPrompt",
];
const COMBAT_KINDS: readonly UiState["kind"][] = [
  "pickAction",
  "pickSkill",
  "skillDetail",
  "pickCommandMinion",
  "pickCommandSkill",
  "pickItemInCombat",
  "pickTarget",
  "roundResolved",
  "combatOver",
];
/**
 * Left off any screen whose fullest footer would no longer fit the smallest terminal: `roomReward` for both, and `room` and the
 * paged `pickItemInCombat` for `[v]` (the bestiary is one step away through the map, the fight's monsters through `[Esc]`).
 */
const MAP_KINDS: readonly UiState["kind"][] = ["room", "rest", "campPrompt", ...COMBAT_KINDS, "monsterInfo", "bestiary"];
const MONSTER_KINDS: readonly UiState["kind"][] = ["rest", "campPrompt", ...COMBAT_KINDS.filter((k) => k !== "pickItemInCombat"), "floorMap"];

/** The full-screen viewers: they hide every panel and open over the screen they were called from. */
export const VIEWER_KINDS: readonly UiState["kind"][] = ["floorMap", "monsterInfo", "bestiary"];

export function canOpenMap(kind: UiState["kind"]): boolean {
  return MAP_KINDS.includes(kind);
}

export function canOpenMonsters(kind: UiState["kind"]): boolean {
  return MONSTER_KINDS.includes(kind);
}

const NO_SAVE_KINDS: readonly UiState["kind"][] = ["gameover", "journalLastPage", "abilityBuyback", "saveMenu", "fullLog", "gatekeeper"];
const NO_QUICKSAVE_KINDS: readonly UiState["kind"][] = ["gameover", "journalLastPage", "abilityBuyback", "fullLog", "gatekeeper"];
const NO_LOG_KINDS: readonly UiState["kind"][] = ["fullLog"];
const NO_MEMORY_KINDS: readonly UiState["kind"][] = ["fullLog", "gameover", "abilityBuyback", "gatekeeper", "memoryIntro", "memory"];

export function canOpenMemory(kind: UiState["kind"]): boolean {
  return !NO_MEMORY_KINDS.includes(kind);
}

const NO_JOURNAL_KINDS: readonly UiState["kind"][] = [
  ...NO_MEMORY_KINDS,
  "journal",
  "journalDeduction",
  "journalPickup",
  "journalLastPage",
];

export function canOpenJournal(kind: UiState["kind"]): boolean {
  return !NO_JOURNAL_KINDS.includes(kind);
}

export function joinHints(...parts: (string | null | false | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(HINT_GAP);
}

/** `allowPartyInfo` is false while the combat reveal swallows keys, which also covers `[p]` and `[v]`; `allowMonsters` says there is a fight or a bestiary entry to show. */
export function globalHints(
  kind: UiState["kind"],
  allowPartyInfo: boolean = true,
  allowMemory: boolean = false,
  allowJournal: boolean = false,
  allowMonsters: boolean = false
): string {
  return joinHints(
    allowPartyInfo && PARTY_INFO_KINDS.includes(kind) ? t("ui.hintParty") : null,
    allowMemory && canOpenMemory(kind) ? t("ui.hintMemory") : null,
    allowJournal && canOpenJournal(kind) ? t("ui.hintJournal") : null,
    allowPartyInfo && canOpenMap(kind) ? t("ui.hintMap") : null,
    allowPartyInfo && allowMonsters && canOpenMonsters(kind) ? t("ui.hintMonsters") : null,
    NO_LOG_KINDS.includes(kind) ? null : t("ui.hintLog"),
    NO_SAVE_KINDS.includes(kind) ? null : t("ui.hintSave"),
    NO_QUICKSAVE_KINDS.includes(kind) ? null : t("ui.hintQuicksave"),
    t("ui.hintQuit")
  );
}

/** Paging goes before the back hint, so it is spliced in ahead of a trailing `[…] Back`/`[…] Cancel`. */
const TRAILING_BACK = /(?:^|\s{3})(\[[^\]]+\] (?:Back|Cancel))$/;

export function withPageHint(contextual: string, paginated: boolean): string {
  if (!paginated) return contextual;
  const page = t("ui.hintPage");
  const match = TRAILING_BACK.exec(contextual);
  if (!match) return joinHints(contextual, page);
  return joinHints(contextual.slice(0, match.index), page, match[1]);
}

export function digitRange(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1" : `1-${count}`;
}

export function digitHint(key: string, count: number, fallbackKey: string = "ui.footerBackOnly"): string {
  const range = digitRange(count);
  return range === null ? t(fallbackKey) : t(key, { keys: range });
}

export function composeFooter(
  contextual: string,
  kind: UiState["kind"],
  paginated: boolean,
  allowPartyInfo: boolean = true,
  allowMemory: boolean = false,
  allowJournal: boolean = false,
  allowMonsters: boolean = false
): string {
  const left = withPageHint(contextual, paginated);
  const right = globalHints(kind, allowPartyInfo, allowMemory, allowJournal, allowMonsters);
  return left.length > 0 ? left + GROUP_SEP + right : right;
}
