import type { RoomType } from "../types";

export interface GraphRoom {
  id: string;
  type: RoomType;
  next: string[];
}

export interface Span {
  min: number;
  max: number;
}

export interface RouteBounds {
  rooms: Span;
  event: Span;
  rest: Span;
}

export type LaneItem = { kind: "room"; id: string } | { kind: "split"; lanes: LaneItem[][] };

interface Junction {
  ins: string[];
  outs: string[];
}

const JUNCTION_PREFIX = "j:";

/**
 * A floor's rooms seen as a series-parallel graph. Where lanes split or join, a virtual junction sits between
 * the rooms: rooms that lead to the same set of next rooms share one, so a join that is also a split is a
 * single junction with several ins and several outs.
 */
export class FloorGraph {
  readonly byId: Map<string, GraphRoom>;
  readonly preds = new Map<string, string[]>();
  private readonly junctions = new Map<string, Junction>();
  private readonly roomJunction = new Map<string, string>();
  private readonly depthMemo = new Map<string, number>();
  private readonly reachMemo = new Map<string, Set<string>>();
  private columnMemo: Map<string, number> | null = null;

  constructor(
    rooms: GraphRoom[],
    readonly entryId: string
  ) {
    this.byId = new Map(rooms.map((r) => [r.id, r]));
    for (const r of rooms) this.preds.set(r.id, []);
    for (const r of rooms) for (const n of r.next) this.preds.get(n)?.push(r.id);
    for (const r of rooms) {
      if (r.next.length === 0) continue;
      if (r.next.length === 1 && this.preds.get(r.next[0]!)!.length === 1) continue;
      const key = JUNCTION_PREFIX + [...r.next].sort().join(",");
      const junction = this.junctions.get(key) ?? { ins: [], outs: [...r.next] };
      junction.ins.push(r.id);
      this.junctions.set(key, junction);
      this.roomJunction.set(r.id, key);
    }
  }

  room(id: string): GraphRoom {
    const room = this.byId.get(id);
    if (!room) throw new Error(`Unknown room: ${id}`);
    return room;
  }

  /** Rooms on the routes from `fromId` (included) to the guard, or to the first room in `stopIds` (included). */
  routeBounds(fromId: string, stopIds?: ReadonlySet<string>): RouteBounds {
    const memo = new Map<string, RouteBounds>();
    const visit = (id: string): RouteBounds => {
      const known = memo.get(id);
      if (known) return known;
      const room = this.room(id);
      const self = { rooms: 1, event: room.type === "event" ? 1 : 0, rest: room.type === "rest" ? 1 : 0 };
      const children = room.next.length === 0 || stopIds?.has(id) ? [] : room.next.map(visit);
      const span = (key: keyof RouteBounds): Span =>
        children.length === 0
          ? { min: self[key], max: self[key] }
          : { min: self[key] + Math.min(...children.map((c) => c[key].min)), max: self[key] + Math.max(...children.map((c) => c[key].max)) };
      const result = { rooms: span("rooms"), event: span("event"), rest: span("rest") };
      memo.set(id, result);
      return result;
    };
    return visit(fromId);
  }

  /** A room's position along the floor: the longest walk from the entrance to it. */
  columns(): Map<string, number> {
    if (this.columnMemo) return this.columnMemo;
    const memo = new Map<string, number>();
    const visit = (id: string): number => {
      const known = memo.get(id);
      if (known !== undefined) return known;
      const preds = id === this.entryId ? [] : this.preds.get(id) ?? [];
      const col = preds.length === 0 ? 0 : Math.max(...preds.map(visit)) + 1;
      memo.set(id, col);
      return col;
    };
    for (const id of this.byId.keys()) visit(id);
    this.columnMemo = memo;
    return memo;
  }

  /** The junction a room leads into, when it splits or joins. */
  junctionAfter(roomId: string): Junction | undefined {
    const key = this.roomJunction.get(roomId);
    return key ? this.junctions.get(key) : undefined;
  }

  /** Where the lanes leaving a split junction meet again. */
  joinAfter(roomId: string): Junction | undefined {
    const key = this.roomJunction.get(roomId);
    if (!key || this.junctions.get(key)!.outs.length < 2) return undefined;
    const joinKey = this.findJoin(key);
    return joinKey ? this.junctions.get(joinKey) : undefined;
  }

  laneTree(): LaneItem[] {
    return this.decodeSeq(this.entryId, null);
  }

  private successors(node: string): string[] {
    const junction = this.junctions.get(node);
    if (junction) return junction.outs;
    const key = this.roomJunction.get(node);
    if (key) return [key];
    return this.room(node).next;
  }

  private depth(node: string): number {
    const known = this.depthMemo.get(node);
    if (known !== undefined) return known;
    const junction = this.junctions.get(node);
    const preds = junction ? junction.ins : node === this.entryId ? [] : (this.preds.get(node) ?? []).map((p) => this.roomJunction.get(p) ?? p);
    const d = preds.length === 0 ? 0 : Math.max(...[...new Set(preds)].map((p) => this.depth(p))) + 1;
    this.depthMemo.set(node, d);
    return d;
  }

  private reach(node: string): Set<string> {
    const known = this.reachMemo.get(node);
    if (known) return known;
    const set = new Set<string>([node]);
    for (const s of this.successors(node)) for (const r of this.reach(s)) set.add(r);
    this.reachMemo.set(node, set);
    return set;
  }

  private findJoin(junctionKey: string): string | null {
    const outs = this.junctions.get(junctionKey)!.outs;
    const [first, ...rest] = outs.map((o) => this.reach(o));
    let best: string | null = null;
    for (const node of first!) {
      if (!this.junctions.has(node) || !rest.every((r) => r.has(node))) continue;
      if (best === null || this.depth(node) < this.depth(best)) best = node;
    }
    return best;
  }

  private decodeSeq(start: string, stop: string | null): LaneItem[] {
    const items: LaneItem[] = [];
    let cur: string | null = start;
    while (cur !== null && cur !== stop) {
      const junction = this.junctions.get(cur);
      if (!junction) {
        items.push({ kind: "room", id: cur });
        cur = this.successors(cur)[0] ?? null;
        continue;
      }
      if (junction.outs.length === 1) {
        cur = junction.outs[0]!;
        continue;
      }
      const join = this.findJoin(cur);
      items.push({ kind: "split", lanes: junction.outs.map((o) => this.decodeSeq(o, join)) });
      cur = join;
    }
    return items;
  }
}

/** How many lanes run side by side at the widest point of a lane sequence. */
export function laneWidth(seq: LaneItem[]): number {
  return Math.max(1, ...seq.map((item) => (item.kind === "room" ? 1 : item.lanes.reduce((sum, lane) => sum + laneWidth(lane), 0))));
}
