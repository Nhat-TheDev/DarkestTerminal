import type { Game } from "../../engine/game";
import type { KeyEvent } from "@opentui/core";
import type { DroppedJournal, Id, JournalLineState, JournalMergeStep, SlotJournal } from "../../types";
import { t } from "../../data/strings";
import { getClass } from "../../data/classes";
import { JOURNAL_FRAGMENTS, JOURNAL_PAGES, getJournalEcho, getJournalFragment, getJournalLine, journalPageOf } from "../../data/journal";
import { assignSpeakers, deductionOptions, type JournalOption } from "../../engine/journal";
import { digitHint } from "../keyHints";
import { MIN_TERMINAL_WIDTH, PARTY_PANEL_WIDTH, SIDE_PANEL_WIDTH, wrapText } from "../layout";
import type { UiState } from "../state";
import { proceedAfterVictory, type ScreenContext } from "./context";

export type JournalUiState = Extract<UiState, { kind: "journal" }>;

/** The Dungeon panel's inner size at the minimum terminal size, less the title and the blank line under it. */
const JOURNAL_ROWS = 11;
const JOURNAL_WIDTH = MIN_TERMINAL_WIDTH - PARTY_PANEL_WIDTH - SIDE_PANEL_WIDTH - 2;
const INDENT = "  ";

const OPTION_INDENT = "      ";

function speechLine(classId: Id | null, text: string): string {
  return classId ? t("ui.journalSpeech", { speaker: getClass(classId).name, text }) : t("ui.journalMargin", { text });
}

/** A reading is offered as the line its speaker says; choosing it writes the reading's label into the journal. */
function optionText(option: JournalOption, speaker: Id | null): string {
  switch (option.kind) {
    case "write":
      return speechLine(speaker, option.direction.speech);
    case "strikeAndWrite":
      return t("ui.journalStrikeAndWrite", { speech: speechLine(speaker, option.direction.speech) });
    case "leaveBlank":
      return t("ui.journalLeaveUnwritten");
    case "keep":
      return t("ui.journalKeepIt");
    case "strikeLeaveBlank":
      return t("ui.journalStrikeLeaveBlank");
  }
}

function optionRows(index: number, text: string): string[] {
  const [first = "", ...rest] = wrapText(text, JOURNAL_WIDTH - OPTION_INDENT.length);
  return [`${INDENT}[${index}] ${first}`, ...rest.map((l) => OPTION_INDENT + l)];
}

export function handleDeductionKey(ctx: ScreenContext, digit: number | null): void {
  if (digit === null) return;
  const pending = ctx.game.state.pendingJournal;
  const option = pending ? deductionOptions(pending.lineId, ctx.game.journal, ctx.game.state)[digit - 1] : undefined;
  if (ctx.game.resolveJournalDeduction(digit - 1)) return;
  if (option && "direction" in option) ctx.logInfo(t("ui.journalCurrent", { label: option.direction.label }));
  proceedAfterVictory(ctx);
}

export function renderDeduction(game: Game): string {
  const pending = game.state.pendingJournal;
  const line = pending && getJournalLine(pending.lineId);
  if (!pending || !line) return "";
  const page = journalPageOf(line.id);
  const fragment = pending.fragmentId ? getJournalFragment(pending.fragmentId) : undefined;
  const current = game.journal.lines[line.id]?.directionId;
  const options = deductionOptions(line.id, game.journal, game.state);
  const remark = current && fragment?.remark ? fragment.remark : undefined;
  const voices = [...(remark ? [remark.voice] : []), ...options.flatMap((o) => ("direction" in o ? [o.direction.voice] : []))];
  const speakers = assignSpeakers(voices, game.state.party);
  const out = [t("ui.journalTitle", { page: (page?.title ?? "").toUpperCase(), subject: line.subject })];
  if (fragment) out.push(t("ui.journalCopied", { text: fragment.text }));
  if (current) out.push(t("ui.journalCurrent", { label: line.directions.find((d) => d.id === current)?.label ?? "" }));
  if (remark) out.push(speechLine(speakers[0] ?? null, remark.text));
  out.push("");
  let next = remark ? 1 : 0;
  options.forEach((o, i) => out.push(...optionRows(i + 1, optionText(o, "direction" in o ? (speakers[next++] ?? null) : null))));
  return out.join("\n");
}

export function renderDeductionFooter(game: Game): string {
  const pending = game.state.pendingJournal;
  const count = pending ? deductionOptions(pending.lineId, game.journal, game.state).length : 0;
  return digitHint("ui.footerJournalWrite", count);
}

function wrapped(text: string, indent: string): string[] {
  return wrapText(text, JOURNAL_WIDTH - indent.length).map((l) => indent + l);
}

function entryRows(entry: JournalLineState, lineId: Id, journal: SlotJournal, run: number): string[] {
  const line = getJournalLine(lineId)!;
  const label = (id: Id) => line.directions.find((d) => d.id === id)?.label ?? "";
  const rows: string[] = [];
  if (entry.split) {
    rows.push(...wrapped(t("ui.journalSplit", { first: label(entry.split[0]), second: label(entry.split[1]) }), INDENT));
  } else if (entry.directionId) {
    const name = entry.writerClassId ? getClass(entry.writerClassId).name : "";
    const writer = name && entry.run !== undefined && entry.run !== run ? t("ui.journalWriterRun", { writer: name, run: entry.run }) : name;
    rows.push(...wrapped(t("ui.journalReading", { label: label(entry.directionId), writer }).trimEnd(), INDENT));
  } else {
    rows.push(INDENT + t("ui.journalUnwritten"));
  }
  for (const id of entry.struck) rows.push(...wrapped(t("ui.journalStruck", { label: label(id) }), INDENT));
  const readings = [entry.directionId, ...entry.struck, ...(entry.split ?? [])];
  for (const seen of journal.echoes) {
    const echo = getJournalEcho(seen.id);
    if (echo?.echoes.some((x) => x.lineId === lineId && readings.includes(x.directionId))) {
      rows.push(...wrapped(t("ui.journalSince", { text: echo.text, depth: seen.depth }), INDENT));
    }
  }
  return rows;
}

/** Each journal page's rows, split into screens of `JOURNAL_ROWS` with the page title on each; only pages the slot holds a fragment for. */
export function journalPages(journal: SlotJournal, dropped: DroppedJournal | null, run: number): string[][] {
  const screens: string[][] = [];
  for (const page of JOURNAL_PAGES) {
    const lineIds = page.lines.map((l) => l.id);
    const held = journal.fragments.filter((f) => JOURNAL_FRAGMENTS.find((x) => x.id === f.id)?.lineIds.some((id) => lineIds.includes(id)));
    if (held.length === 0) continue;
    const rows: string[] = [];
    for (const line of page.lines) {
      const seen = held.filter((f) => JOURNAL_FRAGMENTS.find((x) => x.id === f.id)?.lineIds.includes(line.id));
      const entry = journal.lines[line.id];
      const tornOut = !entry && dropped?.hands.some((h) => h.lines[line.id]);
      if (seen.length === 0 && !entry && !tornOut) continue;
      const depth = seen.length > 0 ? Math.min(...seen.map((f) => f.depth)) : dropped?.depth;
      rows.push(depth !== undefined ? t("ui.journalLineHeading", { subject: line.subject, depth }) : line.subject);
      if (entry) rows.push(...entryRows(entry, line.id, journal, run));
      else if (tornOut) rows.push(INDENT + t("ui.journalTornOut", { depth: dropped!.depth }));
      else rows.push(INDENT + t("ui.journalUnwritten"));
    }
    rows.push("", t("ui.journalSeenHeading"));
    for (const f of held) rows.push(...wrapped(t("ui.journalSeen", { run: f.run, depth: f.depth, text: getJournalFragment(f.id)!.text }), INDENT));
    for (let i = 0; i < rows.length; i += JOURNAL_ROWS) screens.push([page.title.toUpperCase(), "", ...rows.slice(i, i + JOURNAL_ROWS)]);
  }
  return screens;
}

function labelOf(lineId: Id, directionId: Id | undefined): string {
  return getJournalLine(lineId)?.directions.find((d) => d.id === directionId)?.label ?? "";
}

function pickupStep(game: Game): JournalMergeStep | undefined {
  const pickup = game.state.pendingJournalPickup;
  return pickup?.steps[pickup.step];
}

export function handlePickupKey(ctx: ScreenContext, key: KeyEvent, digit: number | null): void {
  const step = pickupStep(ctx.game);
  if (!step) return;
  const takesDigit = step.kind === "copyPage" || step.kind === "conflict";
  const choice = takesDigit ? (digit === null ? null : digit - 1) : key.name === "return" ? 0 : null;
  if (choice === null || ctx.game.resolveJournalPickup(choice)) return;
  ctx.syncUiToGameState();
}

export function renderPickup(game: Game): string {
  const pickup = game.state.pendingJournalPickup;
  const step = pickupStep(game);
  if (!pickup || !step) return "";
  const page = (lineId: Id) => journalPageOf(lineId)?.title.toUpperCase() ?? "";
  const subject = (lineId: Id) => getJournalLine(lineId)?.subject ?? "";
  const theirs = (lineId: Id) => {
    const entry = pickup.merged[lineId]!;
    const label = labelOf(lineId, entry.directionId);
    return entry.writerClassId && entry.run !== undefined
      ? t("ui.journalTheirs", { writer: getClass(entry.writerClassId).name, run: entry.run, label })
      : t("ui.journalTheirsPlain", { label });
  };
  switch (step.kind) {
    case "intro": {
      const [first, last] = pickup.classIds.map((id) => getClass(id).name) as [string, string];
      const found = first === last ? t("ui.journalPickupFoundOneHand", { first }) : t("ui.journalPickupFound", { first, last });
      return [t("ui.journalPickupTitle", { depth: game.state.floor.depth }), found].join("\n");
    }
    case "copyPage": {
      const pageTitle = JOURNAL_PAGES.find((p) => p.id === step.pageId)?.title.toUpperCase() ?? "";
      const rows = step.lineIds.flatMap((id) => wrapped(t("ui.journalTheirLine", { subject: subject(id), label: labelOf(id, pickup.merged[id]!.directionId) }), INDENT));
      return [t("ui.journalInTheirHand", { page: pageTitle }), ...rows, `${INDENT}[1] ${t("ui.journalCopyThemIn")}`, `${INDENT}[2] ${t("ui.journalLeaveThemOut")}`].join("\n");
    }
    case "conflict":
      return [
        t("ui.journalTitle", { page: page(step.lineId), subject: subject(step.lineId) }),
        ...wrapped(theirs(step.lineId), INDENT),
        ...wrapped(t("ui.journalOurs", { label: labelOf(step.lineId, game.journal.lines[step.lineId]?.directionId) }), INDENT),
        `${INDENT}[1] ${t("ui.journalKeepOurs")}`,
        `${INDENT}[2] ${t("ui.journalTakeTheirs")}`,
        `${INDENT}[3] ${t("ui.journalLeaveBoth")}`,
      ].join("\n");
    case "cannotTake":
      return [
        t("ui.journalTitle", { page: page(step.lineId), subject: subject(step.lineId) }),
        ...wrapped(theirs(step.lineId), INDENT),
        INDENT + t("ui.journalDoesNotFollow"),
      ].join("\n");
  }
}

export function renderPickupFooter(game: Game): string {
  const step = pickupStep(game);
  if (step?.kind === "copyPage") return digitHint("ui.footerChoose", 2);
  if (step?.kind === "conflict") return digitHint("ui.footerChoose", 3);
  return t(step?.kind === "intro" ? "ui.footerJournalReadIt" : "ui.footerJournalContinue");
}

/** The ending's echoes, each under the reading it agrees with. */
export function renderLastPage(game: Game): string {
  const rows = [t("ui.journalLastPageTitle"), ""];
  for (const id of game.state.journalEndingEchoIds) {
    const echo = getJournalEcho(id);
    const held = echo?.echoes.find((x) => game.journal.lines[x.lineId]?.directionId === x.directionId);
    if (!echo || !held) continue;
    const line = getJournalLine(held.lineId)!;
    rows.push(t("ui.journalLastPageLine", { page: journalPageOf(line.id)?.title ?? "", subject: line.subject }));
    rows.push(...wrapped(labelOf(line.id, held.directionId), INDENT), ...wrapped(echo.text, INDENT), "");
  }
  return rows.join("\n").trimEnd();
}

export function renderLastPageFooter(): string {
  return t("ui.footerJournalLastPage");
}

export function renderMain(ui: JournalUiState, page: number): string {
  return (ui.pages[page] ?? []).join("\n");
}

export function renderFooter(): string {
  return t("ui.footerJournal");
}

