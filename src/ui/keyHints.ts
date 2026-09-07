import { t } from "../data/strings";
import type { UiState } from "./state";

/**
 * Footer grammar — see `docs/developer-guide.md` §"Key hints". Every hint is `[key] Label`; hints
 * inside a group are separated by `HINT_GAP`, and the screen's own hints are divided from the
 * always-available global ones by `GROUP_SEP`.
 */
export const HINT_GAP = "   ";
export const GROUP_SEP = "   │   ";

/**
 * The 3 global-key rules below mirror the guards in `App.handleKey` exactly — a footer that
 * advertises a key the handler rejects is the bug this whole convention exists to prevent, so
 * these lists must be edited together with those guards.
 */
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
const NO_SAVE_KINDS: readonly UiState["kind"][] = ["gameover", "abilityBuyback", "saveMenu"];
const NO_QUICKSAVE_KINDS: readonly UiState["kind"][] = ["gameover", "abilityBuyback"];

export function joinHints(...parts: (string | null | false | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(HINT_GAP);
}

export function globalHints(kind: UiState["kind"], allowPartyInfo: boolean = true): string {
  return joinHints(
    allowPartyInfo && PARTY_INFO_KINDS.includes(kind) ? t("ui.hintParty") : null,
    NO_SAVE_KINDS.includes(kind) ? null : t("ui.hintSave"),
    NO_QUICKSAVE_KINDS.includes(kind) ? null : t("ui.hintQuicksave"),
    t("ui.hintQuit")
  );
}

/**
 * The fixed hint order puts paging *before* the back hint, so on a screen that has one the page
 * hint is spliced in rather than appended. Only footer strings this repo writes reach here, so
 * matching the trailing `[…] Back`/`[…] Cancel` is enough to find the seam.
 */
const TRAILING_BACK = /\s{3}(\[[^\]]+\] (?:Back|Cancel))$/;

export function withPageHint(contextual: string, paginated: boolean): string {
  if (!paginated) return contextual;
  const page = t("ui.hintPage");
  const match = TRAILING_BACK.exec(contextual);
  if (!match) return joinHints(contextual, page);
  return joinHints(contextual.slice(0, match.index), page, match[1]);
}

/**
 * The digit range a screen actually accepts, for the `{{keys}}` placeholder in its footer string:
 * `null` when nothing is numbered (the caller drops the hint entirely), `"1"` for a lone option —
 * never `"1-1"` — and `"1-n"` otherwise. Advertising `[1-9]` on a 2-option screen is exactly the
 * dead-key problem R6 forbids.
 */
export function digitRange(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1" : `1-${count}`;
}

/**
 * Renders a footer string's `{{keys}}` range, falling back to a hint-free string when the screen
 * has nothing numbered — otherwise a count of 0 would print a literal `[]`.
 */
export function digitHint(key: string, count: number, fallbackKey: string = "ui.footerBackOnly"): string {
  const range = digitRange(count);
  return range === null ? t(fallbackKey) : t(key, { keys: range });
}

export function composeFooter(contextual: string, kind: UiState["kind"], paginated: boolean, allowPartyInfo: boolean = true): string {
  const left = withPageHint(contextual, paginated);
  const right = globalHints(kind, allowPartyInfo);
  return left.length > 0 ? left + GROUP_SEP + right : right;
}
