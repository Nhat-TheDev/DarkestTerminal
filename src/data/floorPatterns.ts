import type { RoomType } from "../types";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";
import { FloorGraph, type GraphRoom } from "../engine/floorGraph";

export interface LayoutRoom extends GraphRoom {
  hidden: boolean;
}

const CONFIG = BALANCE.floorGeneration;

/** A cross branch leaves lane `lane` after its item `from` and merges into lane `lane + 1` at its item `to`. */
interface CrossBranch {
  lane: number;
  from: number;
  rooms: number;
  to: number;
}

type Shape = { kind: "room" } | { kind: "split"; lanes: Shape[][]; cross?: CrossBranch };

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/** How many lanes run side by side at the widest point of a sequence, cross branches included. */
function shapeWidth(seq: Shape[]): number {
  return Math.max(1, ...seq.map((item) => (item.kind === "room" ? 1 : item.lanes.reduce((sum, lane) => sum + shapeWidth(lane), 0) + (item.cross ? 1 : 0))));
}

/** `span` columns of rooms and splits. Inside a lane the first and last items are rooms, so the lane's own split and join stay apart from the outer ones. */
function shapeSeq(span: number, width: number, inLane: boolean, rng: Rng): Shape[] {
  const items: Shape[] = [];
  let col = 0;
  while (col < span) {
    const maxSplitSpan = span - col - (inLane ? 1 : 0);
    const canSplit = !(inLane && col === 0) && width >= 2 && maxSplitSpan >= CONFIG.minLaneRooms;
    if (canSplit && rng.chance(inLane ? CONFIG.nestedSplitChance : CONFIG.splitChance)) {
      const splitSpan = rng.int(CONFIG.minLaneRooms, maxSplitSpan);
      const laneCount = rng.int(2, Math.min(CONFIG.maxLanesPerSplit, width));
      let spareWidth = width - laneCount;
      const lanes: Shape[][] = [];
      for (let i = 0; i < laneCount; i++) {
        const extraWidth = i === laneCount - 1 ? spareWidth : rng.int(0, spareWidth);
        spareWidth -= extraWidth;
        const length = i === 0 ? splitSpan : rng.int(CONFIG.minLaneRooms, splitSpan);
        lanes.push(shapeSeq(length, 1 + extraWidth, true, rng));
      }
      shuffle(lanes, rng);
      const unusedWidth = width - lanes.reduce((sum, lane) => sum + shapeWidth(lane), 0);
      const cross = unusedWidth > 0 && rng.chance(CONFIG.crossMergeChance) ? pickCrossBranch(lanes, rng) : undefined;
      items.push({ kind: "split", lanes, ...(cross ? { cross } : {}) });
      col += splitSpan;
    } else {
      items.push({ kind: "room" });
      col += 1;
    }
  }
  return items;
}

/** A random adjacent pair of all-room lanes where the branch leaves each lane at least `minLaneRooms` rooms of its own. */
function pickCrossBranch(lanes: Shape[][], rng: Rng): CrossBranch | undefined {
  const min = CONFIG.minLaneRooms;
  const allRooms = (lane: Shape[]) => lane.every((item) => item.kind === "room");
  const pairs = lanes.slice(0, -1).flatMap((lane, i) => (allRooms(lane) && allRooms(lanes[i + 1]!) && lane.length >= min + 1 && lanes[i + 1]!.length > min ? [i] : []));
  if (pairs.length === 0) return undefined;
  const lane = rng.pick(pairs);
  return {
    lane,
    from: rng.int(0, lanes[lane]!.length - min - 1),
    rooms: rng.int(min, Math.max(min, CONFIG.maxCrossBranchRooms)),
    to: rng.int(min, lanes[lane + 1]!.length - 1),
  };
}

function newRoom(rooms: LayoutRoom[], byId: Map<string, LayoutRoom>): LayoutRoom {
  const room: LayoutRoom = { id: `r${rooms.length + 1}`, type: "combat", next: [], hidden: false };
  rooms.push(room);
  byId.set(room.id, room);
  return room;
}

/** `ids[i]` is the room made for `seq[i]`, or null for a split. */
function flatten(seq: Shape[], rooms: LayoutRoom[], byId: Map<string, LayoutRoom>): { first: string[]; last: string[]; ids: (string | null)[] } {
  let first: string[] | null = null;
  let prevLast: string[] = [];
  const ids: (string | null)[] = [];
  for (const item of seq) {
    let itemFirst: string[];
    let itemLast: string[];
    if (item.kind === "room") {
      const id = newRoom(rooms, byId).id;
      itemFirst = itemLast = [id];
      ids.push(id);
    } else {
      const parts = item.lanes.map((lane) => flatten(lane, rooms, byId));
      itemFirst = parts.flatMap((p) => p.first);
      itemLast = parts.flatMap((p) => p.last);
      ids.push(null);
      if (item.cross) {
        const { lane, from, to } = item.cross;
        const branch = Array.from({ length: item.cross.rooms }, () => newRoom(rooms, byId));
        branch.forEach((room, i) => room.next.push(branch[i + 1]?.id ?? parts[lane + 1]!.ids[to]!));
        byId.get(parts[lane]!.ids[from]!)!.next.push(branch[0]!.id);
      }
    }
    for (const id of prevLast) byId.get(id)!.next.push(...itemFirst);
    first ??= itemFirst;
    prevLast = itemLast;
  }
  return { first: first ?? [], last: prevLast, ids };
}

function buildShape(rng: Rng): LayoutRoom[] {
  const routeRooms = rng.int(CONFIG.minRouteRooms, CONFIG.maxRouteRooms);
  const rooms: LayoutRoom[] = [];
  flatten([{ kind: "room" }, ...shapeSeq(routeRooms - 2, CONFIG.maxParallelLanes, false, rng), { kind: "room" }], rooms, new Map());
  return rooms;
}

function predecessors(rooms: LayoutRoom[]): Map<string, LayoutRoom[]> {
  const preds = new Map<string, LayoutRoom[]>(rooms.map((r) => [r.id, []]));
  for (const r of rooms) for (const n of r.next) preds.get(n)!.push(r);
  return preds;
}

/** Every room after all the rooms leading into it; a cross branch is made after the room it merges into. */
function walkingOrder(rooms: LayoutRoom[]): LayoutRoom[] {
  const preds = predecessors(rooms);
  const left = new Map(rooms.map((r) => [r.id, preds.get(r.id)!.length]));
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const order: LayoutRoom[] = [];
  const ready = [rooms[0]!];
  while (ready.length > 0) {
    const room = ready.shift()!;
    order.push(room);
    for (const n of room.next) {
      left.set(n, left.get(n)! - 1);
      if (left.get(n) === 0) ready.push(byId.get(n)!);
    }
  }
  return order;
}

/** Draws each room's type in `order`, the shape's walking order. */
function assignTypes(order: LayoutRoom[], preds: Map<string, LayoutRoom[]>, rng: Rng): void {
  order.forEach((room, i) => {
    if (room.next.length === 0) room.type = "boss";
    else if (i === 0) room.type = "combat";
    else {
      const before = preds.get(room.id)!;
      const options: [RoomType, number][] = [["combat", 1 - CONFIG.eventRoomWeight - CONFIG.restRoomWeight]];
      if (before.every((p) => p.type !== "event")) options.push(["event", CONFIG.eventRoomWeight]);
      if (before.every((p) => p.type !== "rest")) options.push(["rest", CONFIG.restRoomWeight]);
      room.type = rng.weightedPick(options, ([, w]) => w)[0];
    }
  });
}

/** The graph holds the rooms themselves, so it reads their current types without being rebuilt. */
function routeRuleError(graph: FloorGraph, maxEvents: number): string | null {
  const bounds = graph.routeBounds(graph.entryId);
  if (bounds.rooms.min < CONFIG.minRouteRooms || bounds.rooms.max > CONFIG.maxRouteRooms) {
    return `routes hold ${bounds.rooms.min}-${bounds.rooms.max} rooms, expected ${CONFIG.minRouteRooms}-${CONFIG.maxRouteRooms}`;
  }
  if (bounds.rest.min < CONFIG.minRestRoomsPerRoute || bounds.rest.max > CONFIG.maxRestRoomsPerRoute) {
    return `routes hold ${bounds.rest.min}-${bounds.rest.max} rest rooms, expected ${CONFIG.minRestRoomsPerRoute}-${CONFIG.maxRestRoomsPerRoute}`;
  }
  if (bounds.event.min < CONFIG.minEventRoomsPerRoute || bounds.event.max > maxEvents) {
    return `routes hold ${bounds.event.min}-${bounds.event.max} event rooms, expected ${CONFIG.minEventRoomsPerRoute}-${maxEvents}`;
  }
  return null;
}

/** A single lane with the fewest events and rests spaced out: always valid when the config is. */
export function fallbackLayout(): LayoutRoom[] {
  const queue: RoomType[] = [...Array(CONFIG.minEventRoomsPerRoute).fill("event"), ...Array(CONFIG.minRestRoomsPerRoute).fill("rest")];
  const count = CONFIG.minRouteRooms;
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i + 1}`,
    type: i === count - 1 ? "boss" : i % 2 === 0 ? "combat" : (queue.shift() ?? "combat"),
    next: i === count - 1 ? [] : [`r${i + 2}`],
    hidden: false,
  }));
}

export function unknownRoomsMean(depth: number): number {
  const growthFloors = Math.min(depth, CONFIG.unknownRoomsMeanCapDepth) - 1;
  return Math.max(0, CONFIG.unknownRoomsMeanAtFirstFloor + CONFIG.unknownRoomsMeanGrowthPerFloor * growthFloors);
}

/** Each pick goes to the least-crowded column, never beside another unknown room; it places fewer when nothing is left. */
function hideRooms(rooms: LayoutRoom[], depth: number, rng: Rng): void {
  const target = Math.max(0, Math.round(unknownRoomsMean(depth) + (rng.next() * 2 - 1) * CONFIG.unknownRoomsSpread));
  const graph = new FloorGraph(rooms, rooms[0]!.id);
  const columns = graph.columns();
  const preds = predecessors(rooms);
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const perColumn = new Map<number, number>();
  const interior = rooms.slice(1, -1);
  for (let placed = 0; placed < target; placed++) {
    const open = interior.filter(
      (r) => !r.hidden && preds.get(r.id)!.every((p) => !p.hidden) && r.next.every((n) => !byId.get(n)!.hidden)
    );
    if (open.length === 0) return;
    const load = (r: LayoutRoom) => perColumn.get(columns.get(r.id)!) ?? 0;
    const least = Math.min(...open.map(load));
    const pick = rng.pick(open.filter((r) => load(r) === least));
    pick.hidden = true;
    const col = columns.get(pick.id)!;
    perColumn.set(col, (perColumn.get(col) ?? 0) + 1);
  }
}

export function generateFloorLayout(rng: Rng, depth = 1): LayoutRoom[] {
  const maxEvents = rng.chance(CONFIG.manyEventsFloorChance) ? CONFIG.maxEventRoomsPerRoute : CONFIG.commonMaxEventRoomsPerRoute;
  let layout: LayoutRoom[] | null = null;
  for (let attempt = 0; attempt < CONFIG.generationAttempts && !layout; attempt++) {
    const rooms = buildShape(rng);
    const graph = new FloorGraph(rooms, rooms[0]!.id);
    const bounds = graph.routeBounds(graph.entryId);
    if (bounds.rooms.min < CONFIG.minRouteRooms || bounds.rooms.max > CONFIG.maxRouteRooms) continue;
    const order = walkingOrder(rooms);
    const preds = predecessors(rooms);
    for (let t = 0; t < CONFIG.typeAttemptsPerShape; t++) {
      assignTypes(order, preds, rng);
      if (routeRuleError(graph, maxEvents) === null) {
        layout = rooms;
        break;
      }
    }
  }
  layout ??= fallbackLayout();
  hideRooms(layout, depth, rng);
  return layout;
}

/** Lanes side by side at a column: its rooms, plus every room whose line runs across it to a later column. */
function lanesAtColumns(rooms: LayoutRoom[], columns: Map<string, number>): number[] {
  const lanes: number[] = [];
  for (const room of rooms) {
    const col = columns.get(room.id)!;
    lanes[col] = (lanes[col] ?? 0) + 1;
    const skipped = new Set<number>();
    for (const n of room.next) for (let c = col + 1; c < columns.get(n)!; c++) skipped.add(c);
    for (const c of skipped) lanes[c] = (lanes[c] ?? 0) + 1;
  }
  return lanes.map((n) => n ?? 0);
}

export function lanesSideBySide(rooms: LayoutRoom[]): number {
  return Math.max(...lanesAtColumns(rooms, new FloorGraph(rooms, rooms[0]!.id).columns()));
}

/** The fewest rooms on a lane from `startId` before it reaches a room more than one route leads into. */
function laneRooms(startId: string, byId: Map<string, LayoutRoom>, incoming: Map<string, number>): number {
  const memo = new Map<string, number>();
  const visit = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const next = byId.get(id)!.next;
    const rest = next.length === 0 ? 0 : Math.min(...next.map((n) => (incoming.get(n)! > 1 ? 0 : visit(n))));
    memo.set(id, 1 + rest);
    return 1 + rest;
  };
  return visit(startId);
}

/** Checks every rule over the room graph rather than listing routes, since nested splits multiply them. */
export function validateFloorLayout(layout: LayoutRoom[]): void {
  if (new Set(layout.map((r) => r.id)).size !== layout.length) throw new Error("room ids must be unique within the layout");
  const rooms = layout[0]?.type === "temple" ? layout.slice(1) : layout;
  if (rooms !== layout) {
    const temple = layout[0]!;
    const next = rooms[0];
    if (temple.hidden || temple.next.length !== 1 || temple.next[0] !== next?.id || next?.type !== "combat" || next?.hidden) {
      throw new Error("a temple entry must be visible and lead only to the visible combat entrance");
    }
  }
  const entry = rooms[0]!;
  if (entry.type !== "combat" || entry.hidden) throw new Error("the entrance must be a visible combat room");
  const ends = rooms.filter((r) => r.next.length === 0);
  if (ends.length !== 1 || ends[0]!.type !== "boss" || ends[0]!.hidden) throw new Error("the floor must end in exactly 1 visible boss room (no dead ends)");
  if (rooms.filter((r) => r.type === "boss").length !== 1) throw new Error("the floor must hold exactly 1 boss room");

  const byId = new Map(rooms.map((r) => [r.id, r]));
  const reached = new Set<string>([entry.id]);
  const queue = [entry.id];
  while (queue.length > 0) {
    for (const n of byId.get(queue.shift()!)?.next ?? []) {
      if (!byId.has(n)) throw new Error(`room links to unknown room ${n}`);
      if (!reached.has(n)) {
        reached.add(n);
        queue.push(n);
      }
    }
  }
  if (reached.size !== rooms.length) throw new Error("every room must be reachable from the entrance");

  for (const room of rooms) {
    for (const n of room.next) {
      const next = byId.get(n)!;
      if (room.type === "event" && next.type === "event") throw new Error(`event rooms ${room.id} and ${n} are adjacent`);
      if (room.type === "rest" && next.type === "rest") throw new Error(`rest rooms ${room.id} and ${n} are adjacent`);
      if (room.hidden && next.hidden) throw new Error(`unknown rooms ${room.id} and ${n} are adjacent`);
    }
  }

  const ruleError = routeRuleError(new FloorGraph(rooms, entry.id), CONFIG.maxEventRoomsPerRoute);
  if (ruleError) throw new Error(ruleError);

  const width = lanesSideBySide(rooms);
  if (width > CONFIG.maxParallelLanes) throw new Error(`${width} lanes run side by side, max allowed is ${CONFIG.maxParallelLanes}`);
  const incoming = new Map(rooms.map((r) => [r.id, 0]));
  for (const room of rooms) for (const n of room.next) incoming.set(n, incoming.get(n)! + 1);
  for (const room of rooms) {
    if (room.next.length > CONFIG.maxLanesPerSplit) throw new Error(`room ${room.id} splits into ${room.next.length} lanes, max allowed is ${CONFIG.maxLanesPerSplit}`);
    if (room.next.length < 2) continue;
    for (const n of room.next) {
      const held = laneRooms(n, byId, incoming);
      if (held < CONFIG.minLaneRooms) throw new Error(`a lane holds ${held} rooms before it joins, need >= ${CONFIG.minLaneRooms}`);
    }
  }
}
