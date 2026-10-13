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
  session: LogSession | null;
  /** Ticks the group occupies, counting the tick that shows its first line. */
  span: number;
  /** The tick its fear change shows from, or null when no character's fear changed. */
  fearStart: number | null;
  /** Each unit's direct hits in the order they landed, as the HP each took and whether it crit. */
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
    else groups.push({ entries: [entry], session: entry.session ?? null, span: 0, fearStart: null, hits: new Map(), healCrits: new Set(), hitBeats: 0 });
  }
  for (const group of groups) {
    for (const { hit, healCritOf } of group.entries) {
      if (healCritOf) group.healCrits.add(healCritOf);
      if (!hit) continue;
      const taken = group.hits.get(hit.targetId) ?? [];
      taken.push({ amount: hit.amount, ...(hit.crit ? { crit: true as const } : {}) });
      group.hits.set(hit.targetId, taken);
      group.hitBeats = Math.max(group.hitBeats, taken.length - 1);
    }
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

  /** Each unit's direct hits in the lit session, in order, as the HP each took and whether it crit; empty when nothing is lit. */
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
    // A session shows its first line at once and the rest from its impact on; plain lines one per tick.
    const due = !this.current.session || this.shown === 0 || this.ticks >= IMPACT_TICKS;
    if (due && this.shown < this.current.entries.length) revealed.push(this.current.entries[this.shown++]!);
    this.ticks++;
    // Lines with no session have nothing to hold: the group ends with its last line.
    if (!this.current.session && this.shown >= this.current.entries.length) this.current = null;
    return revealed;
  }

  /** Skip: returns every line not yet revealed and leaves the queue idle. */
  flush(): LogEntry[] {
    const rest = [...(this.current ? this.current.entries.slice(this.shown) : []), ...this.groups.flatMap((g) => g.entries)];
    this.current = null;
    this.groups = [];
    this.shown = 0;
    this.ticks = 0;
    return rest;
  }
}
