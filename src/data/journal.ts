import type { GameState, Id, JournalCondition, JournalEcho, JournalFragment, JournalLine, JournalPage, JournalRequires, JournalVoice } from "../types";
import journalJson from "../../data/journal.json";
import { EVENTS } from "./events";
import { FLOOR_MILESTONE_OMENS } from "./floorMilestones";
import { BALANCE } from "./balanceConfig";
import { CLASSES } from "./classes";

export interface JournalData {
  pages: JournalPage[];
  fragments: JournalFragment[];
  echoes: JournalEcho[];
}

const ENDINGS: readonly NonNullable<GameState["gameOver"]>[] = ["victory", "defeat", "stay", "letGo", "leaveAmbushed", "leaveEscaped"];

function isJournalDepthKey(key: string | undefined): boolean {
  return key === undefined || typeof (BALANCE.journal as Record<string, unknown>)[key] === "number";
}

const FILE = "data/journal.json";
export const JOURNAL_VOICES: readonly JournalVoice[] = ["plain", "grim", "faithful", "clinical"];

function conditionsOf(requires: JournalRequires | undefined): JournalCondition[] {
  return requires?.when ?? [];
}

/** Throws on the first shape or reference error, naming the record. */
export function validateJournal(data: JournalData): void {
  if (!Array.isArray(data.pages) || !Array.isArray(data.fragments) || !Array.isArray(data.echoes)) throw new Error(`${FILE}: needs "pages", "fragments" and "echoes" arrays`);
  const ids = new Set<Id>();
  const claim = (id: Id, what: string) => {
    if (typeof id !== "string" || id === "") throw new Error(`${FILE}: a ${what} has no id`);
    if (ids.has(id)) throw new Error(`${FILE}: "${id}" appears twice`);
    ids.add(id);
  };
  const lines = new Map<Id, JournalLine>();
  for (const page of data.pages) {
    claim(page.id, "page");
    if (!page.title) throw new Error(`${FILE}: page "${page.id}" has no title`);
    for (const line of page.lines) {
      claim(line.id, "line");
      lines.set(line.id, line);
      if (!line.subject) throw new Error(`${FILE}: line "${line.id}" has no subject`);
      if (!Array.isArray(line.directions) || line.directions.length < 2) throw new Error(`${FILE}: line "${line.id}" needs at least 2 directions`);
      if (!isJournalDepthKey(line.minDepth)) {
        throw new Error(`${FILE}: line "${line.id}" has a "minDepth" that is not a journal balance key`);
      }
      for (const direction of line.directions) {
        claim(direction.id, "direction");
        if (!direction.label || !direction.speech) throw new Error(`${FILE}: direction "${direction.id}" needs a label and a speech`);
        if (!JOURNAL_VOICES.includes(direction.voice)) throw new Error(`${FILE}: direction "${direction.id}" has an unknown voice "${direction.voice}"`);
      }
    }
  }
  const fragmentIds = new Set<Id>();
  for (const fragment of data.fragments) {
    claim(fragment.id, "fragment");
    fragmentIds.add(fragment.id);
    if (!fragment.text) throw new Error(`${FILE}: fragment "${fragment.id}" has no text`);
    if (!Array.isArray(fragment.sources) || fragment.sources.length === 0) throw new Error(`${FILE}: fragment "${fragment.id}" has no source, so nothing can grant it`);
    for (const lineId of fragment.lineIds) {
      if (!lines.has(lineId)) throw new Error(`${FILE}: fragment "${fragment.id}" names an unknown line "${lineId}"`);
    }
    for (const source of fragment.sources) {
      if (source.kind === "eventResolved" && !EVENTS.some((e) => e.id === source.eventId)) {
        throw new Error(`${FILE}: fragment "${fragment.id}" names an unknown event "${source.eventId}"`);
      }
      if (source.kind === "omen" && !FLOOR_MILESTONE_OMENS.some((o) => o.id === source.omenId)) {
        throw new Error(`${FILE}: fragment "${fragment.id}" names an unknown omen "${source.omenId}"`);
      }
    }
    if (fragment.remark && !JOURNAL_VOICES.includes(fragment.remark.voice)) throw new Error(`${FILE}: fragment "${fragment.id}" has a remark in an unknown voice`);
  }
  const directionLine = new Map<Id, Id>();
  for (const line of lines.values()) for (const d of line.directions) directionLine.set(d.id, line.id);
  const checkConditions = (owner: string, requires: JournalRequires | undefined) => {
    if (requires && requires.match !== "all" && requires.match !== "any") throw new Error(`${FILE}: ${owner} needs "match" of "all" or "any"`);
    for (const c of conditionsOf(requires)) {
      if ("fragmentId" in c && !fragmentIds.has(c.fragmentId)) throw new Error(`${FILE}: ${owner} names an unknown fragment "${c.fragmentId}"`);
      if ("lineId" in c && directionLine.get(c.directionId) !== c.lineId) throw new Error(`${FILE}: ${owner} names "${c.directionId}", which is not a direction of "${c.lineId}"`);
      if ("eventId" in c && !EVENTS.some((e) => e.id === c.eventId)) throw new Error(`${FILE}: ${owner} names an unknown event "${c.eventId}"`);
    }
  };
  for (const line of lines.values()) {
    checkConditions(`line "${line.id}"`, line.requires);
    for (const d of line.directions) {
      checkConditions(`direction "${d.id}"`, d.requires);
      if (conditionsOf(d.requires).some((c) => "lineId" in c && c.lineId === line.id)) throw new Error(`${FILE}: direction "${d.id}" is gated on its own line`);
    }
  }
  const gatesOf = (line: JournalLine) => [line.requires, ...line.directions.map((d) => d.requires)].flatMap(conditionsOf).flatMap((c) => ("lineId" in c ? [c.lineId] : []));
  const visit = (lineId: Id, path: Id[]) => {
    if (path.includes(lineId)) throw new Error(`${FILE}: line gates form a cycle: ${[...path, lineId].join(" -> ")}`);
    for (const next of gatesOf(lines.get(lineId)!)) visit(next, [...path, lineId]);
  };
  for (const lineId of lines.keys()) visit(lineId, []);
  // A line is one-sided when exactly one reading has an echo, mirrored when every reading has one; anything between would let a
  // settled line be solved by elimination, and a page of only one-sided lines could be read off as fully confirmed.
  const echoed = new Map<Id, Set<Id>>();
  for (const echo of data.echoes) {
    claim(echo.id, "echo");
    if (!echo.text) throw new Error(`${FILE}: echo "${echo.id}" has no text`);
    if (echo.on.kind === "eventVisit") {
      if (!EVENTS.some((e) => e.id === (echo.on as { eventId: Id }).eventId)) throw new Error(`${FILE}: echo "${echo.id}" names an unknown event`);
      if (!isJournalDepthKey(echo.on.minDepth)) throw new Error(`${FILE}: echo "${echo.id}" has a "minDepth" that is not a journal balance key`);
    } else if (echo.on.kind === "ending") {
      if (!Array.isArray(echo.on.endings) || echo.on.endings.length === 0 || echo.on.endings.some((e) => !ENDINGS.includes(e))) {
        throw new Error(`${FILE}: echo "${echo.id}" needs "endings" from ${ENDINGS.join(", ")}`);
      }
    } else {
      throw new Error(`${FILE}: echo "${echo.id}" has an unknown "on" kind`);
    }
    if (!Array.isArray(echo.echoes) || echo.echoes.length === 0) throw new Error(`${FILE}: echo "${echo.id}" echoes no reading`);
    for (const { lineId, directionId } of echo.echoes) {
      if (directionLine.get(directionId) !== lineId) throw new Error(`${FILE}: echo "${echo.id}" names "${directionId}", which is not a direction of "${lineId}"`);
      echoed.set(lineId, (echoed.get(lineId) ?? new Set()).add(directionId));
    }
  }
  const shapeOf = (line: JournalLine): "free" | "oneSided" | "mirrored" => {
    const count = echoed.get(line.id)?.size ?? 0;
    return count === 0 ? "free" : count === line.directions.length ? "mirrored" : "oneSided";
  };
  for (const line of lines.values()) {
    const count = echoed.get(line.id)?.size ?? 0;
    if (count > 1 && count < line.directions.length) throw new Error(`${FILE}: line "${line.id}" has echoes on some but not all of its readings`);
  }
  for (const page of data.pages) {
    if (page.lines.every((l) => shapeOf(l) === "oneSided")) throw new Error(`${FILE}: page "${page.id}" needs a line with no echo, or with an echo on every reading`);
  }
  for (const cls of CLASSES) {
    if (!JOURNAL_VOICES.includes(cls.journalVoice)) throw new Error(`data/classes.json: class "${cls.id}" needs a "journalVoice" of ${JOURNAL_VOICES.join(", ")}`);
  }
}

const DATA = journalJson as unknown as JournalData;
validateJournal(DATA);

export const JOURNAL_PAGES: readonly JournalPage[] = DATA.pages;
export const JOURNAL_FRAGMENTS: readonly JournalFragment[] = DATA.fragments;
export const JOURNAL_LINES: readonly JournalLine[] = DATA.pages.flatMap((p) => p.lines);
export const JOURNAL_ECHOES: readonly JournalEcho[] = DATA.echoes;

export function getJournalEcho(id: Id): JournalEcho | undefined {
  return JOURNAL_ECHOES.find((e) => e.id === id);
}

/** Every reading of the line has an echo, so an echo there agrees with whatever was written. */
export function isMirroredLine(lineId: Id): boolean {
  const line = getJournalLine(lineId);
  return !!line && line.directions.every((d) => JOURNAL_ECHOES.some((e) => e.echoes.some((x) => x.directionId === d.id)));
}

export function getJournalLine(id: Id): JournalLine | undefined {
  return JOURNAL_LINES.find((l) => l.id === id);
}

export function getJournalFragment(id: Id): JournalFragment | undefined {
  return JOURNAL_FRAGMENTS.find((f) => f.id === id);
}

export function journalPageOf(lineId: Id): JournalPage | undefined {
  return JOURNAL_PAGES.find((p) => p.lines.some((l) => l.id === lineId));
}

export function isKnownJournalId(id: Id): boolean {
  return getJournalFragment(id) !== undefined || getJournalLine(id) !== undefined || JOURNAL_LINES.some((l) => l.directions.some((d) => d.id === id));
}
