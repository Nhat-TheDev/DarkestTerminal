import type { CombatEffectCue, CombatantSnapshot, HitMark, Id, LogEntry, LogSession } from "../types";
import { COMBAT_FX } from "../data/combatFx";

export interface AttackFrame {
  hit: NonNullable<LogEntry["hit"]>;
  progress: number;
  impactAge: number;
}

export interface SupportFrame {
  effect: CombatEffectCue;
  age: number;
}

function effectTicks(visual: string | undefined): number {
  const animation = visual ? COMBAT_FX.presets[visual] : undefined;
  return animation?.phase === "impact" ? animation.ticks ?? animation.frames.length : 0;
}

export const REVEAL_TICK_MS = 100;
export const SESSION_MIN_TICKS = 15;
/** Until a session's impact its HP/status changes stay hidden, so they are not mistaken for the previous session's. */
export const IMPACT_TICKS = 5;
export const FEAR_BEAT_TICKS = 5;
export const HIT_BEAT_TICKS = 5;

interface SlotBeat {
  id: Id;
  start: number;
  end: number;
}

interface Group {
  entries: LogEntry[];
  /** Cue-bearing sessions are ordered by scheduled effect time. */
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
  attacks: { hit: AttackFrame["hit"]; impact: number; step: number }[];
  supports: { effect: CombatEffectCue; start: number }[];
  slotBeats: Map<Id, SlotBeat[]>;
}

function toGroups(entries: LogEntry[], summonSlots: ReadonlyMap<Id, Id>, previousSnapshot: CombatantSnapshot[] | null): Group[] {
  const slotFor = new Map(summonSlots);
  for (const owner of summonSlots.values()) slotFor.set(owner, owner);
  const groups: Group[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.session?.id === entry.session?.id) last.entries.push(entry);
    else groups.push({ entries: [entry], order: [], dueAt: null, session: entry.session ?? null, span: 0, fearStart: null, hits: new Map(), healCrits: new Set(), hitBeats: 0, attacks: [], supports: [], slotBeats: new Map() });
  }
  for (const group of groups) {
    const before = previousSnapshot;
    const after = group.entries.at(-1)?.snapshot;
    previousSnapshot = after ?? before;
    for (const { hit, healCritOf } of group.entries) {
      if (healCritOf) group.healCrits.add(healCritOf);
      if (!hit) continue;
      const taken = group.hits.get(hit.targetId) ?? [];
      taken.push({ amount: hit.amount, ...(hit.overkill ? { overkill: hit.overkill } : {}), ...(hit.crit ? { crit: true as const } : {}) });
      group.hits.set(hit.targetId, taken);
      group.hitBeats = Math.max(group.hitBeats, taken.length - 1);
    }
    group.order = group.entries;
    if (!group.session) {
      group.span = group.entries.length;
      continue;
    }
    // Party-wide fear (end of round, victory) has nothing else to show, so it starts at the impact; otherwise it follows the session's own hold.
    let hold = group.session.cause === "fear" ? IMPACT_TICKS : Math.max(SESSION_MIN_TICKS, IMPACT_TICKS + group.entries.length - 1) + group.hitBeats * HIT_BEAT_TICKS;
    if (group.hits.size > 0) hold = Math.max(hold, IMPACT_TICKS + group.hitBeats * HIT_BEAT_TICKS + COMBAT_FX.flash.frames.length);
    const ranks = new Map<Id, number>(), ready = new Map<Id, number>(), impacts = new Map<Id, number>();
    const due = new Map<LogEntry, number>();
    const slotReady = (id: Id) => {
      const slot = slotFor.get(id);
      const previous = slot === undefined ? undefined : group.slotBeats.get(slot)?.at(-1);
      return previous && previous.id !== id ? previous.end : 0;
    };
    const occupy = (id: Id, start: number, end: number) => {
      const slot = slotFor.get(id);
      if (slot === undefined) return;
      const beats = group.slotBeats.get(slot) ?? [];
      const last = beats.at(-1);
      if (last?.id === id) last.end = Math.max(last.end, end);
      else beats.push({ id, start, end });
      group.slotBeats.set(slot, beats);
    };
    const { actorId, summonActorId } = group.session;
    const summonParticipantIds = group.entries[0]?.summonParticipantIds ?? group.session.summonParticipantIds ?? [];
    const cueSource = (sourceId: Id | undefined) => summonActorId !== undefined && sourceId === actorId ? summonActorId : sourceId;
    if (summonActorId !== undefined) occupy(summonActorId, 0, 0);
    if (actorId === null && before && after) {
      for (const id of summonParticipantIds) {
        const owner = summonSlots.get(id);
        if (owner === undefined || group.hits.has(owner) || group.entries.some(({ effect }) => effect?.targetId === owner)) continue;
        const priorHp = before.find((unit) => unit.id === owner)?.hp;
        const nextHp = after.find((unit) => unit.id === owner)?.hp;
        if (priorHp !== undefined && nextHp !== undefined && priorHp !== nextHp) occupy(owner, 0, IMPACT_TICKS + HIT_BEAT_TICKS);
      }
    }
    let delayed = false;
    let hitEnd = IMPACT_TICKS;
    for (const entry of group.entries) {
      const { hit, effect } = entry;
      if (hit) {
        const beat = ranks.get(hit.targetId) ?? 0;
        ranks.set(hit.targetId, beat + 1);
        const source = cueSource(hit.sourceId);
        const distinctSource = source !== undefined && slotFor.get(source) !== slotFor.get(hit.targetId);
        const ordinaryImpact = Math.max(IMPACT_TICKS + beat * HIT_BEAT_TICKS, (impacts.get(hit.targetId) ?? 0) + HIT_BEAT_TICKS, (ready.get(hit.targetId) ?? 0) + IMPACT_TICKS);
        const impact = Math.max(ordinaryImpact, slotReady(hit.targetId) + IMPACT_TICKS, distinctSource ? slotReady(source) + IMPACT_TICKS : 0);
        delayed ||= impact > ordinaryImpact;
        impacts.set(hit.targetId, impact);
        group.attacks.push({ hit: source === hit.sourceId ? hit : { ...hit, sourceId: source }, impact, step: beat });
        due.set(entry, impact);
        hitEnd = impact + Math.max(COMBAT_FX.flash.frames.length, effectTicks(hit.visual));
        occupy(hit.targetId, impact - IMPACT_TICKS, hitEnd);
        if (distinctSource) occupy(source, impact - IMPACT_TICKS, hitEnd);
        hold = Math.max(hold, hitEnd, impact + SESSION_MIN_TICKS - IMPACT_TICKS);
      }
      if (!effect) continue;
      const duration = effectTicks(effect.visual);
      if (duration === 0) continue;
      const source = cueSource(effect.sourceId);
      const distinctSource = source !== undefined && slotFor.get(source) !== slotFor.get(effect.targetId);
      const start = Math.max(hitEnd, ready.get(effect.targetId) ?? IMPACT_TICKS, slotReady(effect.targetId), distinctSource ? slotReady(source) : 0);
      occupy(effect.targetId, start, start + duration);
      if (distinctSource) occupy(source, start, start + duration);
      group.supports.push({ effect: source === effect.sourceId ? effect : { ...effect, sourceId: source }, start });
      due.set(entry, start);
      ready.set(effect.targetId, start + duration);
      hold = Math.max(hold, start + duration);
    }
    for (const id of summonParticipantIds) {
      const slot = summonSlots.get(id);
      if (slot === undefined) continue;
      const beats = group.slotBeats.get(slot);
      if (beats?.some((beat) => beat.id === id)) continue;
      const start = beats ? Math.max(IMPACT_TICKS, slotReady(id)) : 0;
      occupy(id, start, Math.max(IMPACT_TICKS, start) + HIT_BEAT_TICKS);
      hold = Math.max(hold, Math.max(IMPACT_TICKS, start) + HIT_BEAT_TICKS);
    }
    if (delayed || group.hitBeats > 0 || group.supports.length > 0) paceByEffect(group, due);
    hold = Math.max(hold, (group.dueAt?.at(-1) ?? 0) + 1);
    group.fearStart = group.session.fearChangedIds.length > 0 ? hold : null;
    group.span = group.fearStart === null ? hold : group.fearStart + FEAR_BEAT_TICKS;
  }
  return groups;
}

/** Cue lines and their following text share the cue's scheduled time. */
function paceByEffect(group: Group, due: ReadonlyMap<LogEntry, number>): void {
  const units: { time: number; lines: LogEntry[] }[] = [];
  for (const entry of group.entries) {
    const time = due.get(entry);
    if (time !== undefined || units.length === 0) units.push({ time: time ?? IMPACT_TICKS, lines: [entry] });
    else units[units.length - 1]!.lines.push(entry);
  }
  units.sort((a, b) => a.time - b.time);
  const order: LogEntry[] = [];
  const dueAt: number[] = [];
  for (const unit of units) {
    unit.lines.forEach((line, place) => {
      const raw = unit.time + place;
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

  enqueue(entries: LogEntry[], summonSlots: ReadonlyMap<Id, Id> = new Map(), snapshot: CombatantSnapshot[] | null = null): void {
    let previous = this.current?.entries.at(-1)?.snapshot ?? snapshot;
    for (const queued of this.groups) previous = queued.entries.at(-1)?.snapshot ?? previous;
    this.groups.push(...toGroups(entries, summonSlots, previous));
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

  slotOccupant(ownerId: Id): Id {
    const beats = this.current?.slotBeats.get(ownerId);
    if (beats) {
      for (let i = beats.length - 1; i >= 0; i--) {
        const beat = beats[i]!;
        if (beat.start < this.ticks) return beat.id;
      }
    }
    return ownerId;
  }

  hasSlotReplay(ownerId: Id): boolean {
    return this.current?.slotBeats.get(ownerId)?.some((beat) => beat.id !== ownerId) ?? false;
  }

  hasImpacted(id: Id): boolean {
    if (!this.current?.session || this.holding) return false;
    const hit = this.current.attacks.find((attack) => attack.hit.targetId === id);
    const support = this.current.supports.find(({ effect }) => effect.targetId === id);
    return (hit === undefined && support === undefined)
      || this.ticks - 1 >= Math.min(hit?.impact ?? Infinity, support?.start ?? Infinity);
  }

  get focusHits(): ReadonlyMap<Id, HitMark[]> {
    return this.current?.session ? this.current.hits : NO_HITS;
  }

  get attackFrames(): AttackFrame[] {
    if (!this.current?.session) return [];
    const frames: AttackFrame[] = [];
    for (const { hit, impact } of this.current.attacks) {
      const impactAge = this.ticks - 1 - impact;
      if (impactAge < -IMPACT_TICKS || impactAge >= Math.max(COMBAT_FX.flash.frames.length, effectTicks(hit.visual))) continue;
      frames.push({ hit, progress: Math.min(1, (impactAge + IMPACT_TICKS) / (IMPACT_TICKS - 1)), impactAge });
    }
    return frames;
  }

  get receivingHitIds(): ReadonlySet<Id> {
    return new Set(this.current?.attacks.filter(({ hit, impact }) => hit.amount > (hit.overkill ?? 0) && this.ticks - 1 < impact + Math.max(COMBAT_FX.flash.frames.length, effectTicks(hit.visual))).map(({ hit }) => hit.targetId));
  }

  get receivingDamageIds(): ReadonlySet<Id> {
    const ids = new Set(this.receivingHitIds);
    const elapsed = this.ticks - 1;
    for (const { effect, start } of this.current?.supports ?? []) {
      if ((effect.damage ?? 0) > 0 && elapsed < start + effectTicks(effect.visual)) ids.add(effect.targetId);
    }
    return ids;
  }

  get supportFrames(): SupportFrame[] {
    if (!this.current?.session) return [];
    const elapsed = this.ticks - 1;
    return this.current.supports.flatMap(({ effect, start }) => {
      const age = elapsed - start;
      return age >= 0 && age < effectTicks(effect.visual) ? [{ effect, age }] : [];
    });
  }

  get focusHealCrits(): ReadonlySet<Id> {
    return this.current?.session ? this.current.healCrits : NO_HEAL_CRITS;
  }

  hitStepFor(targetId: Id): number {
    return (this.current?.attacks.filter(({ hit, impact }) => hit.targetId === targetId && this.ticks - 1 >= impact).length ?? 0) - 1;
  }

  get hitStep(): number {
    return this.current?.attacks.reduce((step, attack) => this.ticks - 1 >= attack.impact ? Math.max(step, attack.step) : step, 0) ?? 0;
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
