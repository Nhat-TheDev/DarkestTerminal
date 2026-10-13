import type { CombatantSnapshot, HitMark, Id, LogEntry, LogSession } from "../types";

/** One reveal step. Every pacing number below is a multiple of it. */
export const REVEAL_TICK_MS = 100;
/** A session stays on screen at least this many ticks: 15 × 100 ms = 1.5 s. */
export const SESSION_MIN_TICKS = 15;
/**
 * Ticks between a session's first line and its impact: 5 × 100 ms = 0.5 s. Until then HP, statuses and
 * numbers stay as they were, so a change is never mistaken for part of the previous session; the
 * session's other lines start at the impact, one per tick.
 */
export const IMPACT_TICKS = 5;
/** Ticks after the impact before a summon's own HP change replaces its owner's number: 5 × 100 ms = 0.5 s. */
export const SUMMON_BEAT_TICKS = 5;
/** Ticks a fear change (`◉ +2.1`, `◉ -15`) stays up once it replaces a unit's other icons: 5 × 100 ms = 0.5 s. */
export const FEAR_BEAT_TICKS = 5;
/** Ticks each hit of a multi-hit action stays up as its own number before the next replaces it: 5 × 100 ms = 0.5 s. */
export const HIT_BEAT_TICKS = 5;

interface Group {
  entries: LogEntry[];
  /** The order the lines are revealed in: `entries`, except that a session with a unit hit more than once is revealed beat by beat. */
  order: LogEntry[];
  /** The tick each line of `order` is due, or null for the plain pace (the first line at once, the rest from the impact, one per tick). */
  dueAt: number[] | null;
  session: LogSession | null;
  /** Ticks the group occupies, counting the tick that shows its first line. */
  span: number;
  /** The tick its fear change shows from, or null when no character's fear changed. */
  fearStart: number | null;
  /** Each unit's direct hits in the order they landed, as each one's full damage, its overkill and whether it crit. */
  hits: Map<Id, HitMark[]>;
  /** Units a critical heal landed on. */
  healCrits: Set<Id>;
  /** Extra beats the session runs for its most-hit unit: its hits minus one. */
  hitBeats: number;
}

/** Consecutive entries with the same session id form one group; consecutive session-less entries form one too. */
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

/**
 * Reveals a session's lines in step with the battlefield's hit beats: a hit line, with the lines that
 * follow it ("is defeated"), is due at the beat of its place among that unit's hits, so the log names a
 * hit when its number is up. Units with several hits are interleaved by beat; the stored log is untouched.
 */
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

/**
 * The single clock behind the log reveal and the battlefield highlight. `tick()` is called once per
 * REVEAL_TICK_MS; what it returns is exactly what became visible in that step, and `focus` is the
 * session those lines belong to — read both in the same render and the screen cannot drift from the log.
 */
export class RevealQueue {
  private groups: Group[] = [];
  private current: Group | null = null;
  private shown = 0;
  private ticks = 0;

  enqueue(entries: LogEntry[]): void {
    this.groups.push(...toGroups(entries));
  }

  /** True from the first queued line until the last session's hold has run out. */
  get active(): boolean {
    return this.current !== null || this.groups.length > 0;
  }

  /** The session whose participants are lit right now, or null (nothing revealing, or session-less lines showing). */
  get focus(): LogSession | null {
    return this.current?.session ?? null;
  }

  /** The combatant state the lit session ends in — what its impact shows. */
  get focusSnapshot(): CombatantSnapshot[] | null {
    if (!this.current?.session) return null;
    return this.current.entries.at(-1)?.snapshot ?? null;
  }

  /** True while the lit session has not reached its impact: its changes must not be shown yet. */
  get holding(): boolean {
    return this.current?.session != null && this.ticks <= IMPACT_TICKS;
  }

  /** True once the lit session has run a beat past its impact and past its last hit: the owner's number gives way to its summon's. */
  get summonBeat(): boolean {
    return this.current?.session != null && this.ticks > IMPACT_TICKS + SUMMON_BEAT_TICKS + this.current.hitBeats * HIT_BEAT_TICKS;
  }

  /** Each unit's direct hits in the lit session, in order, as each one's full damage, its overkill and whether it crit; empty when nothing is lit. */
  get focusHits(): ReadonlyMap<Id, HitMark[]> {
    return this.current?.session ? this.current.hits : NO_HITS;
  }

  /** The units a critical heal landed on in the lit session; empty when nothing is lit. */
  get focusHealCrits(): ReadonlySet<Id> {
    return this.current?.session ? this.current.healCrits : NO_HEAL_CRITS;
  }

  /** Which of a unit's hits the battlefield shows: 0 from the impact, one more every HIT_BEAT_TICKS, held on the last. */
  get hitStep(): number {
    const group = this.current;
    if (!group?.session || this.ticks <= IMPACT_TICKS) return 0;
    return Math.min(group.hitBeats, Math.floor((this.ticks - IMPACT_TICKS - 1) / HIT_BEAT_TICKS));
  }

  /** True once the lit session's fear change replaces everything else its characters wear. */
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
    // A session shows its first line at once and the rest from its impact on, plain lines one per tick; a
    // session with a unit hit more than once shows each line at the beat of its hit.
    const dueTick = this.current.dueAt?.[this.shown] ?? IMPACT_TICKS;
    const due = !this.current.session || this.shown === 0 || this.ticks >= dueTick;
    if (due && this.shown < this.current.order.length) revealed.push(this.current.order[this.shown++]!);
    this.ticks++;
    // Lines with no session have nothing to hold: the group ends with its last line.
    if (!this.current.session && this.shown >= this.current.order.length) this.current = null;
    return revealed;
  }

  /** Skip: returns every line not yet revealed and leaves the queue idle. */
  flush(): LogEntry[] {
    const rest = [...(this.current ? this.current.order.slice(this.shown) : []), ...this.groups.flatMap((g) => g.order)];
    this.current = null;
    this.groups = [];
    this.shown = 0;
    this.ticks = 0;
    return rest;
  }
}
