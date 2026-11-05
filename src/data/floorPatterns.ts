import type { RoomType } from "../types";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";
import { FloorGraph, laneWidth, type GraphRoom, type LaneItem } from "../engine/floorGraph";

export interface LayoutRoom extends GraphRoom {
  hidden: boolean;
}

const CONFIG = BALANCE.floorGeneration;

type Shape = { kind: "room" } | { kind: "split"; lanes: Shape[][] };

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
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
      const laneCount = rng.int(2, width);
      let spareWidth = width - laneCount;
      const lanes: Shape[][] = [];
      for (let i = 0; i < laneCount; i++) {
        const extraWidth = i === laneCount - 1 ? spareWidth : rng.int(0, spareWidth);
        spareWidth -= extraWidth;
        const length = i === 0 ? splitSpan : rng.int(CONFIG.minLaneRooms, splitSpan);
        lanes.push(shapeSeq(length, 1 + extraWidth, true, rng));
      }
      items.push({ kind: "split", lanes: shuffle(lanes, rng) });
      col += splitSpan;
    } else {
      items.push({ kind: "room" });
      col += 1;
    }
  }
  return items;
}

function flatten(seq: Shape[], rooms: LayoutRoom[]): { first: string[]; last: string[] } {
  let first: string[] | null = null;
  let prevLast: string[] = [];
  for (const item of seq) {
    let itemFirst: string[];
    let itemLast: string[];
    if (item.kind === "room") {
      const id = `r${rooms.length + 1}`;
      rooms.push({ id, type: "combat", next: [], hidden: false });
      itemFirst = itemLast = [id];
    } else {
      const parts = item.lanes.map((lane) => flatten(lane, rooms));
      itemFirst = parts.flatMap((p) => p.first);
      itemLast = parts.flatMap((p) => p.last);
    }
    for (const id of prevLast) rooms.find((r) => r.id === id)!.next.push(...itemFirst);
    first ??= itemFirst;
    prevLast = itemLast;
  }
  return { first: first ?? [], last: prevLast };
}

function buildShape(rng: Rng): LayoutRoom[] {
  const routeRooms = rng.int(CONFIG.minRouteRooms, CONFIG.maxRouteRooms);
  const rooms: LayoutRoom[] = [];
  flatten([{ kind: "room" }, ...shapeSeq(routeRooms - 2, CONFIG.maxParallelLanes, false, rng), { kind: "room" }], rooms);
  return rooms;
}

function predecessors(rooms: LayoutRoom[]): Map<string, LayoutRoom[]> {
  const preds = new Map<string, LayoutRoom[]>(rooms.map((r) => [r.id, []]));
  for (const r of rooms) for (const n of r.next) preds.get(n)!.push(r);
  return preds;
}

/** Rooms are in walking order, so every room's predecessors already have their type. */
function assignTypes(rooms: LayoutRoom[], rng: Rng): void {
  const preds = predecessors(rooms);
  rooms.forEach((room, i) => {
    if (i === 0) room.type = "combat";
    else if (i === rooms.length - 1) room.type = "boss";
    else {
      const before = preds.get(room.id)!;
      const options: [RoomType, number][] = [["combat", 1 - CONFIG.eventRoomWeight - CONFIG.restRoomWeight]];
      if (before.every((p) => p.type !== "event")) options.push(["event", CONFIG.eventRoomWeight]);
      if (before.every((p) => p.type !== "rest")) options.push(["rest", CONFIG.restRoomWeight]);
      room.type = rng.weightedPick(options, ([, w]) => w)[0];
    }
  });
}

const TYPE_ATTEMPTS_PER_SHAPE = 20;

function routeRuleError(rooms: LayoutRoom[], maxEvents: number): string | null {
  const bounds = new FloorGraph(rooms, rooms[0]!.id).routeBounds(rooms[0]!.id);
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
    const bounds = new FloorGraph(rooms, rooms[0]!.id).routeBounds(rooms[0]!.id);
    if (bounds.rooms.min < CONFIG.minRouteRooms || bounds.rooms.max > CONFIG.maxRouteRooms) continue;
    for (let t = 0; t < TYPE_ATTEMPTS_PER_SHAPE; t++) {
      assignTypes(rooms, rng);
      if (routeRuleError(rooms, maxEvents) === null) {
        layout = rooms;
        break;
      }
    }
  }
  layout ??= fallbackLayout();
  hideRooms(layout, depth, rng);
  return layout;
}

function laneRuleError(seq: LaneItem[], graph: FloorGraph): string | null {
  for (const item of seq) {
    if (item.kind === "room") continue;
    for (const lane of item.lanes) {
      const first = lane[0];
      const last = lane.at(-1);
      if (first?.kind !== "room" || last?.kind !== "room") return "a lane must start and end with a room";
      const rooms = graph.routeBounds(first.id, new Set([last.id])).rooms.min;
      if (rooms < CONFIG.minLaneRooms) return `a lane holds ${rooms} rooms before it joins, need >= ${CONFIG.minLaneRooms}`;
      const inner = laneRuleError(lane, graph);
      if (inner) return inner;
    }
  }
  return null;
}

/** Checks every rule over the room graph rather than listing routes, since nested splits multiply them. */
export function validateFloorLayout(rooms: LayoutRoom[]): void {
  if (new Set(rooms.map((r) => r.id)).size !== rooms.length) throw new Error("room ids must be unique within the layout");
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

  const ruleError = routeRuleError(rooms, CONFIG.maxEventRoomsPerRoute);
  if (ruleError) throw new Error(ruleError);

  const graph = new FloorGraph(rooms, entry.id);
  const tree = graph.laneTree();
  const width = laneWidth(tree);
  if (width > CONFIG.maxParallelLanes) throw new Error(`${width} lanes run side by side, max allowed is ${CONFIG.maxParallelLanes}`);
  const laneError = laneRuleError(tree, graph);
  if (laneError) throw new Error(laneError);
}
