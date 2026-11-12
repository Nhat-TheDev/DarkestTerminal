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

/** A floor's rooms as a directed graph from the entrance to the guard. */
export class FloorGraph {
  readonly byId: Map<string, GraphRoom>;
  readonly preds = new Map<string, string[]>();
  private columnMemo: Map<string, number> | null = null;

  constructor(
    rooms: GraphRoom[],
    readonly entryId: string
  ) {
    this.byId = new Map(rooms.map((r) => [r.id, r]));
    for (const r of rooms) this.preds.set(r.id, []);
    for (const r of rooms) for (const n of r.next) this.preds.get(n)?.push(r.id);
  }

  room(id: string): GraphRoom {
    const room = this.byId.get(id);
    if (!room) throw new Error(`Unknown room: ${id}`);
    return room;
  }

  /** Rooms on the routes from `fromId` (included) to the guard, counted without listing the routes. */
  routeBounds(fromId: string): RouteBounds {
    const memo = new Map<string, RouteBounds>();
    const visit = (id: string): RouteBounds => {
      const known = memo.get(id);
      if (known) return known;
      const room = this.room(id);
      const self = { rooms: 1, event: room.type === "event" ? 1 : 0, rest: room.type === "rest" ? 1 : 0 };
      const children = room.next.map(visit);
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
      const preds = id === this.entryId ? [] : (this.preds.get(id) ?? []);
      const col = preds.length === 0 ? 0 : Math.max(...preds.map(visit)) + 1;
      memo.set(id, col);
      return col;
    };
    for (const id of this.byId.keys()) visit(id);
    this.columnMemo = memo;
    return memo;
  }
}
