import type { CombatantSnapshot, HitMark, Id, LogEntry, LogSession } from "../types";

export const REVEAL_TICK_MS = 100;
export const SESSION_MIN_TICKS = 15;
/** Until a session's impact its HP/status changes stay hidden, so they are not mistaken for the previous session's. */
export const IMPACT_TICKS = 5;
/** Ticks after the impact and the last hit beat before a summon's HP change replaces its owner's number. */
export const SUMMON_BEAT_TICKS = 5;
export const FEAR_BEAT_TICKS = 5;
export const HIT_BEAT_TICKS = 5;

interface Group {
  entries: LogEntry[];
  /** `entries`, except that a session with a unit hit more than once is reordered beat by beat. */
  order: LogEntry[];
  /** Tick each line of `order` is due; null for the plain pace. */
  dueAt: number[] | null;
  session: LogSession | null;
  /** Counts the tick that shows the first line. */
  span: number;
  fearStart: number | null;
  hits: Map<Id, HitMark[]>;
  healCrits: Set<Id>;
  hitBeats: number;
}

function toGroups(entries: LogEntry[]): Group[] {
  const groups: Group[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.session?.id === entry.session?.id) last.entries.push(entry);
    else groups.push({ entries: [entry], order: [], dueAt: null, session: entry.session ?? null, span: 0, fearStart: null, hits: new Map(), healCrits: new Set(), hitBeats: 0 });
  }
  for (const group of groups) {
    for (const { hit, healCritOf } of group.entries) {
      if (healCritOf) group.healCrits.add(healCritOf);
      if (!hit) continue;
      const taken = group.hits.get(hit.targetId) ?? [];
      taken.push({ amount: hit.amount, ...(hit.overkill ? { overkill: hit.overkill } : {}), ...(hit.crit ? { crit: true as const } : {}) });
      group.hits.set(hit.targetId, taken);
      group.hitBeats = Math.max(group.hitBeats, taken.length - 1);
    }
    group.order = group.entries;
    if (group.session && group.hitBeats > 0) paceByBeat(group);
    if (!group.session) {
      group.span = group.entries.length;
      continue;
    }
    // Party-wide fear (end of round, victory) has nothing else to show, so it starts at the impact; otherwise it follows the session's own hold.
    const hold = group.session.cause === "fear" ? IMPACT_TICKS : Math.max(SESSION_MIN_TICKS, IMPACT_TICKS + group.entries.length - 1) + group.hitBeats * HIT_BEAT_TICKS;
    group.fearStart = group.session.fearChangedIds.length > 0 ? hold : null;
    group.span = group.fearStart === null ? hold : group.fearStart + FEAR_BEAT_TICKS;
  }
  return groups;
}

/** A hit line and the lines after it are due at the beat of its place among that unit's hits. */
function paceByBeat(group: Group): void {
  const units: { beat: number; lines: LogEntry[] }[] = [];
  const rank = new Map<Id, number>();
  for (const entry of group.entries) {
    if (entry.hit) {
      const beat = rank.get(entry.hit.targetId) ?? 0;
      rank.set(entry.hit.targetId, beat + 1);
      units.push({ beat, lines: [entry] });
    } else if (units.length === 0) {
      units.push({ beat: 0, lines: [entry] });
    } else {
      units[units.length - 1]!.lines.push(entry);
    }
  }
  // Array.prototype.sort is stable: within a beat the lines keep the order they were logged in.
  units.sort((a, b) => a.beat - b.beat);
  const order: LogEntry[] = [];
  const dueAt: number[] = [];
  for (const unit of units) {
    unit.lines.forEach((line, place) => {
      const raw = IMPACT_TICKS + unit.beat * HIT_BEAT_TICKS + place;
      order.push(line);
      dueAt.push(dueAt.length === 0 ? 0 : Math.max(raw, dueAt[dueAt.length - 1]! + 1));
    });
  }
  group.order = order;
  group.dueAt = dueAt;
}

const NO_HITS: ReadonlyMap<Id, HitMark[]> = new Map();
const NO_HEAL_CRITS: ReadonlySet<Id> = new Set();

/** Read `tick()`'s result and `focus` in the same render, so the screen cannot drift from the log. */
export class RevealQueue {
  private groups: Group[] = [];
  private current: Group | null = null;
  private shown = 0;
  private ticks = 0;

  enqueue(entries: LogEntry[]): void {
    this.groups.push(...toGroups(entries));
  }

  get active(): boolean {
    return this.current !== null || this.groups.length > 0;
  }

  get focus(): LogSession | null {
    return this.current?.session ?? null;
  }

  get focusSnapshot(): CombatantSnapshot[] | null {
    if (!this.current?.session) return null;
    return this.current.entries.at(-1)?.snapshot ?? null;
  }

  get holding(): boolean {
    return this.current?.session != null && this.ticks <= IMPACT_TICKS;
  }

  get summonBeat(): boolean {
    return this.current?.session != null && this.ticks > IMPACT_TICKS + SUMMON_BEAT_TICKS + this.current.hitBeats * HIT_BEAT_TICKS;
  }

  get focusHits(): ReadonlyMap<Id, HitMark[]> {
    return this.current?.session ? this.current.hits : NO_HITS;
  }

  get focusHealCrits(): ReadonlySet<Id> {
    return this.current?.session ? this.current.healCrits : NO_HEAL_CRITS;
  }

  get hitStep(): number {
    const group = this.current;
    if (!group?.session || this.ticks <= IMPACT_TICKS) return 0;
    return Math.min(group.hitBeats, Math.floor((this.ticks - IMPACT_TICKS - 1) / HIT_BEAT_TICKS));
  }

  get fearBeat(): boolean {
    const start = this.current?.fearStart;
    return start != null && this.ticks > start;
  }

  tick(): LogEntry[] {
    if (this.current && this.ticks >= this.current.span) this.current = null;
    if (!this.current) {
      const next = this.groups.shift();
      if (!next) return [];
      this.current = next;
      this.shown = 0;
      this.ticks = 0;
    }
    const revealed: LogEntry[] = [];
    const dueTick = this.current.dueAt?.[this.shown] ?? IMPACT_TICKS;
    const due = !this.current.session || this.shown === 0 || this.ticks >= dueTick;
    if (due && this.shown < this.current.order.length) revealed.push(this.current.order[this.shown++]!);
    this.ticks++;
    if (!this.current.session && this.shown >= this.current.order.length) this.current = null;
    return revealed;
  }

  flush(): LogEntry[] {
    const rest = [...(this.current ? this.current.order.slice(this.shown) : []), ...this.groups.flatMap((g) => g.order)];
    this.current = null;
    this.groups = [];
    this.shown = 0;
    this.ticks = 0;
    return rest;
  }
}
