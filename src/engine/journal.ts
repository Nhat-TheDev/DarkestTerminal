import type { Character, DroppedJournal, EventDefinition, GameState, Id, JournalCondition, JournalDirection, JournalEcho, JournalFragmentSource, JournalLine, JournalLineState, JournalMergeStep, JournalRequires, JournalVoice, Room, SlotJournal } from "../types";
import { BALANCE } from "../data/balanceConfig";
import { getClass } from "../data/classes";
import { JOURNAL_ECHOES, JOURNAL_FRAGMENTS, JOURNAL_LINES, JOURNAL_PAGES, getJournalLine, isMirroredLine } from "../data/journal";
import { pickEventText } from "./dungeon";

/** Pure journal rules. Never import `./game`, `./save` or `./profile` here; the caller loads and saves the slot journal. */

export type JournalTrigger = { kind: "eventResolved"; eventId: Id; outcome: string | undefined; baseTextShown: boolean } | { kind: "omen"; omenId: Id };

export type JournalOption =
  | { kind: "write"; direction: JournalDirection }
  | { kind: "leaveBlank" }
  | { kind: "keep" }
  | { kind: "strikeAndWrite"; direction: JournalDirection }
  | { kind: "strikeLeaveBlank" };

export function emptySlotJournal(): SlotJournal {
  return { fragments: [], lines: {}, echoes: [] };
}

function holdsFragment(journal: SlotJournal, id: Id): boolean {
  return journal.fragments.some((f) => f.id === id);
}

export function conditionMet(c: JournalCondition, journal: SlotJournal, state: GameState): boolean {
  if ("fragmentId" in c) return holdsFragment(journal, c.fragmentId);
  if ("lineId" in c) return journal.lines[c.lineId]?.directionId === c.directionId;
  return state.eventOutcomes[c.eventId] === c.outcome;
}

export function requiresMet(requires: JournalRequires | undefined, journal: SlotJournal, state: GameState): boolean {
  if (!requires) return true;
  const met = (c: JournalCondition) => conditionMet(c, journal, state);
  return requires.match === "all" ? requires.when.every(met) : requires.when.some(met);
}

export function availableDirections(line: JournalLine, journal: SlotJournal, state: GameState): JournalDirection[] {
  const struck = journal.lines[line.id]?.struck ?? [];
  return line.directions.filter((d) => !struck.includes(d.id) && requiresMet(d.requires, journal, state));
}

/** A depth gate only holds a line back from its first offer; a written line stays open. */
function lineOpen(line: JournalLine, journal: SlotJournal, state: GameState): boolean {
  if (journal.lines[line.id]?.split) return true;
  if (!requiresMet(line.requires, journal, state)) return false;
  if (journal.lines[line.id]?.directionId) return true;
  if (line.minDepth !== undefined) return state.floor.depth >= (BALANCE.journal as unknown as Record<string, number>)[line.minDepth]!;
  return true;
}

/** A blank line needs two readings to choose between; a written one needs one reading other than its own. */
export function isChoosable(lineId: Id, journal: SlotJournal, state: GameState): boolean {
  const line = getJournalLine(lineId);
  if (!line || !lineOpen(line, journal, state)) return false;
  if (journal.lines[lineId]?.split) return true;
  const current = journal.lines[lineId]?.directionId;
  const available = availableDirections(line, journal, state);
  return current ? available.some((d) => d.id !== current) : available.length >= 2;
}

export function deductionOptions(lineId: Id, journal: SlotJournal, state: GameState): JournalOption[] {
  const line = getJournalLine(lineId);
  if (!line) return [];
  const split = journal.lines[lineId]?.split;
  if (split) return line.directions.filter((d) => split.includes(d.id)).map((direction) => ({ kind: "write" as const, direction }));
  const current = journal.lines[lineId]?.directionId;
  const others = availableDirections(line, journal, state).filter((d) => d.id !== current);
  if (!current) return [...others.map((direction) => ({ kind: "write" as const, direction })), { kind: "leaveBlank" }];
  return [{ kind: "keep" }, ...others.map((direction) => ({ kind: "strikeAndWrite" as const, direction })), { kind: "strikeLeaveBlank" }];
}

/** Each voice goes to the first living member, in party order, whose class speaks it and hasn't spoken yet; `null` is an unvoiced margin note. */
export function assignSpeakers(voices: JournalVoice[], party: Character[]): (Id | null)[] {
  const used = new Set<Id>();
  return voices.map((voice) => {
    const speaker = party.find((c) => c.isAlive && !used.has(c.id) && getClass(c.classId).journalVoice === voice);
    if (!speaker) return null;
    used.add(speaker.id);
    return speaker.classId;
  });
}

/** True when the event shows its own description or a variant of it, not a chain text that replaces it. */
export function showsBaseText(state: GameState, room: Room, event: EventDefinition): boolean {
  const shown = pickEventText(state, room, event);
  const chainTexts = [
    event.chainEscalatedDescription,
    event.chainEscalated2Description,
    event.chainEscalated3Description,
    event.chainBuildupDescription,
    event.chainForcedDescription,
    event.chainForced2Description,
    event.chainForced3Description,
  ];
  return !chainTexts.includes(shown);
}

function sourceMatches(source: JournalFragmentSource, trigger: JournalTrigger, state: GameState): boolean {
  if (source.kind === "omen") return trigger.kind === "omen" && trigger.omenId === source.omenId;
  if (trigger.kind !== "eventResolved" || trigger.eventId !== source.eventId) return false;
  if (source.outcome !== undefined && source.outcome !== trigger.outcome) return false;
  if (source.requiresBaseText && !trigger.baseTextShown) return false;
  return source.repeatInRun ? (state.journalEventVisits[source.eventId] ?? 0) >= 2 : true;
}

function enqueue(state: GameState, lineId: Id, fragmentId: Id | null): void {
  if (state.pendingJournal?.lineId === lineId || state.journalQueue.some((q) => q.lineId === lineId)) return;
  if (!state.pendingJournal) state.pendingJournal = { lineId, fragmentId };
  else state.journalQueue.push({ lineId, fragmentId });
}

/** Copies the fragments the trigger grants (in authoring order, no RNG) and queues the lines they open or reopen. Returns the ids seen. */
export function grantFragments(trigger: JournalTrigger, journal: SlotJournal, state: GameState, run: number): Id[] {
  if (trigger.kind === "eventResolved") state.journalEventVisits[trigger.eventId] = (state.journalEventVisits[trigger.eventId] ?? 0) + 1;
  const granted = JOURNAL_FRAGMENTS.filter((f) => !state.journalFragmentsSeen.includes(f.id) && f.sources.some((s) => sourceMatches(s, trigger, state))).slice(
    0,
    BALANCE.journal.maxFragmentsPerRoom
  );
  for (const fragment of granted) {
    state.journalFragmentsSeen.push(fragment.id);
    if (!holdsFragment(journal, fragment.id)) journal.fragments.push({ id: fragment.id, run, depth: state.floor.depth });
    for (const lineId of fragment.lineIds) {
      state.journalLeftBlank = state.journalLeftBlank.filter((id) => id !== lineId);
      if (isChoosable(lineId, journal, state)) enqueue(state, lineId, fragment.id);
    }
  }
  return granted.map((f) => f.id);
}

/** The most recently copied fragment that names the line, shown with a scene the floor clear opened. */
function latestFragmentFor(lineId: Id, journal: SlotJournal): Id | null {
  for (let i = journal.fragments.length - 1; i >= 0; i--) {
    const id = journal.fragments[i]!.id;
    if (JOURNAL_FRAGMENTS.find((f) => f.id === id)?.lineIds.includes(lineId)) return id;
  }
  return null;
}

/** At a floor clear: queue every blank line that has become choosable and wasn't left blank this run, then open one scene. */
export function drainAtFloorClear(journal: SlotJournal, state: GameState): void {
  for (const line of JOURNAL_LINES) {
    if (journal.lines[line.id]?.directionId || state.journalLeftBlank.includes(line.id)) continue;
    if (isChoosable(line.id, journal, state)) enqueue(state, line.id, latestFragmentFor(line.id, journal));
  }
  if (!state.pendingJournal && state.journalQueue.length > 0) state.pendingJournal = state.journalQueue.shift()!;
}

/** Strikes any written reading whose own gate no longer holds, until nothing changes. */
export function applyAutoStrikes(journal: SlotJournal, state: GameState): void {
  for (let changed = true; changed; ) {
    changed = false;
    for (const [lineId, entry] of Object.entries(journal.lines)) {
      if (!entry.directionId) continue;
      const direction = getJournalLine(lineId)?.directions.find((d) => d.id === entry.directionId);
      if (direction && !requiresMet(direction.requires, journal, state)) {
        entry.struck.push(entry.directionId);
        entry.directionId = undefined;
        changed = true;
      }
    }
  }
}

/** Applies the chosen option to the pending line and closes the scene. `false` for no scene or an out-of-range choice. */
export function resolveDeduction(optionIndex: number, journal: SlotJournal, state: GameState, run: number): boolean {
  const pending = state.pendingJournal;
  if (!pending) return false;
  const options = deductionOptions(pending.lineId, journal, state);
  const option = options[optionIndex];
  if (!option) return false;
  const entry: JournalLineState = journal.lines[pending.lineId] ?? { struck: [] };
  const writer = (direction: JournalDirection) => assignSpeakers([direction.voice], state.party)[0] ?? undefined;
  switch (option.kind) {
    case "write":
      Object.assign(entry, { directionId: option.direction.id, writerClassId: writer(option.direction), run });
      delete entry.split;
      break;
    case "strikeAndWrite":
      entry.struck.push(entry.directionId!);
      Object.assign(entry, { directionId: option.direction.id, writerClassId: writer(option.direction), run });
      break;
    case "strikeLeaveBlank":
      entry.struck.push(entry.directionId!);
      entry.directionId = undefined;
      state.journalLeftBlank.push(pending.lineId);
      break;
    case "leaveBlank":
      state.journalLeftBlank.push(pending.lineId);
      break;
    case "keep":
      break;
  }
  journal.lines[pending.lineId] = entry;
  applyAutoStrikes(journal, state);
  state.pendingJournal = null;
  return true;
}

/** A wiped party's readings leave the slot's journal and lie at its death depth; its fragments stay. */
export function tearOut(journal: SlotJournal, dropped: DroppedJournal | null, party: Character[], run: number, depth: number): DroppedJournal | null {
  const lines = Object.fromEntries(Object.entries(journal.lines).filter(([, e]) => e.directionId || e.split || e.struck.length > 0));
  journal.lines = {};
  if (Object.keys(lines).length === 0) return dropped;
  const hand = { run, classIds: party.map((c) => c.classId), lines };
  return dropped ? { depth: Math.min(dropped.depth, depth), hands: [...dropped.hands, hand] } : { depth, hands: [hand] };
}

/** A run that died without reaching the dropped journal moves it up, never above `driftMinDepth`. */
export function driftDropped(dropped: DroppedJournal | null): DroppedJournal | null {
  if (!dropped) return null;
  return { ...dropped, depth: Math.max(BALANCE.journal.driftMinDepth, dropped.depth - BALANCE.journal.driftFloorsPerMissedRun) };
}

/** The bundle's readings as one hand: the newest hand wins each line, and every hand's struck readings are kept. */
export function mergedHands(dropped: DroppedJournal): Record<Id, JournalLineState> {
  const merged: Record<Id, JournalLineState> = {};
  for (const hand of [...dropped.hands].sort((a, b) => a.run - b.run)) {
    for (const [lineId, entry] of Object.entries(hand.lines)) {
      const struck = [...new Set([...(merged[lineId]?.struck ?? []), ...entry.struck])];
      merged[lineId] = entry.directionId || entry.split ? { ...entry, struck } : { ...merged[lineId], struck };
    }
  }
  return merged;
}

function takeable(lineId: Id, directionId: Id, journal: SlotJournal, state: GameState): boolean {
  const direction = getJournalLine(lineId)?.directions.find((d) => d.id === directionId);
  return !!direction && requiresMet(direction.requires, journal, state);
}

/**
 * The merge screens for a found journal, page by page: their readings on lines we left blank, then each line we read differently.
 * Past `maxMergeScreensPerFind`, blank lines take their reading and differing lines keep ours, silently.
 */
export function buildMergeSteps(merged: Record<Id, JournalLineState>, journal: SlotJournal, state: GameState): JournalMergeStep[] {
  const steps: JournalMergeStep[] = [];
  for (const page of JOURNAL_PAGES) {
    const blank: Id[] = [];
    const differing: JournalMergeStep[] = [];
    for (const line of page.lines) {
      const theirs = merged[line.id]?.directionId;
      if (!theirs) continue;
      const ours = journal.lines[line.id];
      if (ours?.directionId === theirs) continue;
      if (!takeable(line.id, theirs, journal, state)) differing.push({ kind: "cannotTake", lineId: line.id });
      else if (!ours?.directionId && !ours?.split) blank.push(line.id);
      else if (ours.directionId) differing.push({ kind: "conflict", lineId: line.id });
    }
    if (blank.length > 0) steps.push({ kind: "copyPage", pageId: page.id, lineIds: blank });
    steps.push(...differing);
  }
  for (const overflow of steps.splice(BALANCE.journal.maxMergeScreensPerFind)) {
    if (overflow.kind === "copyPage") applyMergeChoice(overflow, 0, merged, journal, state);
  }
  return [{ kind: "intro" }, ...steps];
}

/** Choice indexes: copyPage 0 copy / 1 leave out; conflict 0 keep ours / 1 take theirs / 2 keep both as a split line. */
export function applyMergeChoice(step: JournalMergeStep, choice: number, merged: Record<Id, JournalLineState>, journal: SlotJournal, state: GameState): void {
  const copy = (lineId: Id) => {
    const theirs = merged[lineId]!;
    const ours = journal.lines[lineId];
    journal.lines[lineId] = { directionId: theirs.directionId, struck: [...new Set([...(ours?.struck ?? []), ...theirs.struck])], writerClassId: theirs.writerClassId, run: theirs.run };
  };
  if (step.kind === "copyPage" && choice === 0) step.lineIds.forEach(copy);
  if (step.kind === "conflict") {
    const ours = journal.lines[step.lineId]!;
    const theirs = merged[step.lineId]!.directionId!;
    if (choice === 1) {
      const struckOurs = ours.directionId!;
      copy(step.lineId);
      journal.lines[step.lineId]!.struck.push(struckOurs);
    } else if (choice === 2) {
      journal.lines[step.lineId] = { ...ours, split: [ours.directionId!, theirs], directionId: undefined };
    }
  }
  applyAutoStrikes(journal, state);
}

/** After the last screen: their struck readings join ours on every line they touched. */
export function finishMerge(merged: Record<Id, JournalLineState>, journal: SlotJournal, state: GameState): void {
  for (const [lineId, theirs] of Object.entries(merged)) {
    const ours = journal.lines[lineId];
    if (!ours || theirs.struck.length === 0) continue;
    ours.struck = [...new Set([...ours.struck, ...theirs.struck])].filter((id) => id !== ours.directionId);
  }
  applyAutoStrikes(journal, state);
}

function holdsReading(echo: JournalEcho, journal: SlotJournal): boolean {
  return echo.echoes.some(({ lineId, directionId }) => journal.lines[lineId]?.directionId === directionId);
}

function depthReached(key: string | undefined, state: GameState): boolean {
  return key === undefined || state.floor.depth >= (BALANCE.journal as unknown as Record<string, number>)[key]!;
}

/** The first echo, in authoring order, an event visit can show: once per run, and only while the journal holds its reading. */
export function eventEcho(eventId: Id, journal: SlotJournal, state: GameState): JournalEcho | undefined {
  return JOURNAL_ECHOES.find(
    (e) => e.on.kind === "eventVisit" && e.on.eventId === eventId && depthReached(e.on.minDepth, state) && !state.journalEchoesFired.includes(e.id) && holdsReading(e, journal)
  );
}

/** An ending's echoes: one-sided lines first, then at most one mirrored line, up to `maxEndingEchoes`. */
export function endingEchoes(ending: NonNullable<GameState["gameOver"]>, journal: SlotJournal): JournalEcho[] {
  const held = JOURNAL_ECHOES.filter((e) => e.on.kind === "ending" && e.on.endings.includes(ending) && holdsReading(e, journal));
  const mirrored = (e: JournalEcho) => e.echoes.some((x) => isMirroredLine(x.lineId));
  return [...held.filter((e) => !mirrored(e)), ...held.filter(mirrored).slice(0, 1)].slice(0, BALANCE.journal.maxEndingEchoes);
}

export function recordEcho(echo: JournalEcho, journal: SlotJournal, state: GameState, run: number): void {
  if (!state.journalEchoesFired.includes(echo.id)) state.journalEchoesFired.push(echo.id);
  if (!journal.echoes.some((e) => e.id === echo.id)) journal.echoes.push({ id: echo.id, run, depth: state.floor.depth });
}
