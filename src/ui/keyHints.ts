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
const NO_SAVE_KINDS: readonly UiState["kind"][] = ["gameover", "abilityBuyback", "saveMenu", "fullLog", "gatekeeper"];
const NO_QUICKSAVE_KINDS: readonly UiState["kind"][] = ["gameover", "abilityBuyback", "fullLog", "gatekeeper"];
const NO_LOG_KINDS: readonly UiState["kind"][] = ["fullLog"];

export function joinHints(...parts: (string | null | false | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(HINT_GAP);
}

export function globalHints(kind: UiState["kind"], allowPartyInfo: boolean = true): string {
  return joinHints(
    allowPartyInfo && PARTY_INFO_KINDS.includes(kind) ? t("ui.hintParty") : null,
    NO_LOG_KINDS.includes(kind) ? null : t("ui.hintLog"),
    NO_SAVE_KINDS.includes(kind) ? null : t("ui.hintSave"),
    NO_QUICKSAVE_KINDS.includes(kind) ? null : t("ui.hintQuicksave"),
    t("ui.hintQuit")
  );
}

/** Paging goes before the back hint, so it is spliced in ahead of a trailing `[…] Back`/`[…] Cancel`. */
const TRAILING_BACK = /\s{3}(\[[^\]]+\] (?:Back|Cancel))$/;

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

export function composeFooter(contextual: string, kind: UiState["kind"], paginated: boolean, allowPartyInfo: boolean = true): string {
  const left = withPageHint(contextual, paginated);
  const right = globalHints(kind, allowPartyInfo);
  return left.length > 0 ? left + GROUP_SEP + right : right;
}
