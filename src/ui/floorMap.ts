import type { TextChunk } from "@opentui/core";
import type { Floor, Id, Room, RoomType } from "../types";
import { FloorGraph, type LaneItem, type Span } from "../engine/floorGraph";
import { t } from "../data/strings";
import { PALETTE, boldColorChunk, colorChunk, plainChunk } from "./theme";

const CELL_WIDTH = 5;
const COLUMN_STEP = 7;

const LEFT = 1;
const RIGHT = 2;
const UP = 4;
const DOWN = 8;

const GLYPH: Record<number, string> = {
  [LEFT]: "━",
  [RIGHT]: "━",
  [LEFT | RIGHT]: "━",
  [UP]: "┃",
  [DOWN]: "┃",
  [UP | DOWN]: "┃",
  [LEFT | RIGHT | DOWN]: "┳",
  [LEFT | RIGHT | UP]: "┻",
  [UP | DOWN | RIGHT]: "┣",
  [UP | DOWN | LEFT]: "┫",
  [UP | RIGHT]: "┗",
  [UP | LEFT]: "┛",
  [DOWN | RIGHT]: "┏",
  [DOWN | LEFT]: "┓",
  [LEFT | RIGHT | UP | DOWN]: "╋",
};

const CURRENT_ICON = "■";
const UNKNOWN_ICON = "?";
const ROOM_ICON: Record<RoomType, string> = { combat: "·", event: "○", rest: "△", boss: "☠" };
const UNKNOWN_COLOR = PALETTE.hpMid;
const ROOM_COLOR: Record<RoomType, string> = { combat: PALETTE.text, event: PALETTE.passive, rest: PALETTE.hpHigh, boss: PALETTE.hpLow };
const LINE_COLOR = PALETTE.dim;
const PASSED_COLOR = PALETTE.disabled;
const LIST_GAP = "    ";

interface Cell {
  ch: string;
  color: string;
  emphasis?: boolean;
}

interface LineMark {
  dirs: number;
  live: boolean;
}

function chunkLength(chunks: TextChunk[]): number {
  return chunks.reduce((sum, c) => sum + Array.from(c.text).length, 0);
}

function rangeText(span: Span): string {
  return span.min === span.max ? String(span.min) : t("ui.floorMapRange", { min: span.min, max: span.max });
}

function roomsText(key: string, span: Span): string {
  return t(key, { range: rangeText(span), n: span.max });
}

function firstRoomIds(item: LaneItem): Id[] {
  return item.kind === "room" ? [item.id] : item.lanes.flatMap((lane) => firstRoomIds(lane[0]!));
}

class MapCanvas {
  private readonly columns: Map<Id, number>;
  private readonly heights = new Map<LaneItem[], number>();
  private readonly lines = new Map<string, LineMark>();
  private readonly rooms: { id: Id; x: number; y: number }[] = [];
  width = 0;
  height = 0;

  constructor(
    private readonly graph: FloorGraph,
    private readonly visited: ReadonlySet<Id>
  ) {
    this.columns = graph.columns();
    const tree = graph.laneTree();
    this.height = this.heightOf(tree) * 2 - 1;
    this.drawSeq(tree, 0);
  }

  render(currentId: Id, keys: Map<Id, number>, byId: Map<Id, Room>): TextChunk[][] {
    const grid: (Cell | null)[][] = Array.from({ length: this.height }, () => Array<Cell | null>(this.width).fill(null));
    for (const [key, mark] of this.lines) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      grid[y]![x] = { ch: GLYPH[mark.dirs]!, color: mark.live ? LINE_COLOR : PASSED_COLOR };
    }
    for (const { id, x, y } of this.rooms) {
      const room = byId.get(id)!;
      const isCurrent = id === currentId;
      const icon = isCurrent ? CURRENT_ICON : room.hidden ? UNKNOWN_ICON : ROOM_ICON[room.type];
      const color = isCurrent ? PALETTE.title : this.visited.has(id) ? PASSED_COLOR : room.hidden ? UNKNOWN_COLOR : ROOM_COLOR[room.type];
      const key = keys.get(id);
      const iconCell: Cell = { ch: icon, color, emphasis: isCurrent };
      const cells: Cell[] =
        key === undefined
          ? [{ ch: "[", color }, { ch: " ", color }, iconCell, { ch: " ", color }, { ch: "]", color }]
          : [{ ch: "[", color }, { ch: String(key), color: PALETTE.title, emphasis: true }, { ch: " ", color }, iconCell, { ch: "]", color }];
      cells.forEach((cell, i) => (grid[y]![x + i] = cell));
    }
    return grid.map((row) => {
      const chunks: TextChunk[] = [];
      let run: Cell | null = null;
      let text = "";
      const flush = () => {
        if (!text) return;
        chunks.push(run ? (run.emphasis ? boldColorChunk(text, run.color) : colorChunk(text, run.color)) : plainChunk(text));
        text = "";
      };
      for (const cell of row) {
        const same = cell === null ? run === null : run !== null && run.color === cell.color && !!run.emphasis === !!cell.emphasis;
        if (!same) {
          flush();
          run = cell;
        }
        text += cell?.ch ?? " ";
      }
      flush();
      return chunks;
    });
  }

  private heightOf(seq: LaneItem[]): number {
    const known = this.heights.get(seq);
    if (known !== undefined) return known;
    const h = Math.max(1, ...seq.map((item) => (item.kind === "room" ? 1 : item.lanes.reduce((sum, lane) => sum + this.heightOf(lane), 0))));
    this.heights.set(seq, h);
    return h;
  }

  private passed(ids: Id[]): boolean {
    return ids.some((id) => this.visited.has(id));
  }

  private mark(x: number, y: number, dirs: number, passed: boolean): void {
    const key = `${x},${y}`;
    const mark = this.lines.get(key) ?? { dirs: 0, live: false };
    mark.dirs |= dirs;
    mark.live ||= !passed;
    this.lines.set(key, mark);
  }

  private hline(x0: number, x1: number, y: number, passed: boolean): void {
    for (let x = x0; x < x1; x++) this.mark(x, y, LEFT | RIGHT, passed);
  }

  private vline(x: number, y0: number, y1: number, passed: boolean): void {
    for (let y = y0; y <= y1; y++) this.mark(x, y, (y > y0 ? UP : 0) | (y < y1 ? DOWN : 0), passed);
  }

  private firstCol(item: LaneItem): number {
    return item.kind === "room" ? this.columns.get(item.id)! : this.firstCol(item.lanes[0]![0]!);
  }

  private lastCol(item: LaneItem): number {
    return item.kind === "room" ? this.columns.get(item.id)! : Math.max(...item.lanes.map((lane) => this.lastCol(lane.at(-1)!)));
  }

  private entryX(item: LaneItem): number {
    return this.firstCol(item) * COLUMN_STEP - (item.kind === "room" ? 0 : 2);
  }

  private joinX(split: LaneItem, next: LaneItem | undefined): number {
    return next ? this.firstCol(next) * COLUMN_STEP - 2 : this.lastCol(split) * COLUMN_STEP + CELL_WIDTH;
  }

  private exitX(item: LaneItem, next: LaneItem | undefined): number {
    return item.kind === "room" ? this.columns.get(item.id)! * COLUMN_STEP + CELL_WIDTH : this.joinX(item, next) + 1;
  }

  private drawSeq(seq: LaneItem[], row: number): void {
    seq.forEach((item, i) => {
      const next = seq[i + 1];
      if (item.kind === "room") {
        const x = this.columns.get(item.id)! * COLUMN_STEP;
        this.rooms.push({ id: item.id, x, y: row * 2 });
        this.width = Math.max(this.width, x + CELL_WIDTH);
      } else {
        this.drawSplit(item, row, next);
      }
      if (next) this.hline(this.exitX(item, next), this.entryX(next), row * 2, this.passed(firstRoomIds(next)));
    });
  }

  private drawSplit(split: Extract<LaneItem, { kind: "split" }>, row: number, next: LaneItem | undefined): void {
    const splitX = this.entryX(split);
    const joinX = this.joinX(split, next);
    const laneRows: number[] = [];
    let r = row;
    for (const lane of split.lanes) {
      laneRows.push(r);
      r += this.heightOf(lane);
    }
    const top = row * 2;
    const bottom = laneRows.at(-1)! * 2;
    const entered = this.passed(firstRoomIds(split));
    const left = next !== undefined && this.passed(firstRoomIds(next));
    this.mark(splitX, top, LEFT, entered);
    this.vline(splitX, top, bottom, entered);
    this.vline(joinX, top, bottom, left);
    if (next) this.mark(joinX, top, RIGHT, left);
    split.lanes.forEach((lane, i) => {
      const y = laneRows[i]! * 2;
      const lanePassed = this.passed(firstRoomIds(lane[0]!));
      this.mark(splitX, y, RIGHT, lanePassed);
      this.hline(splitX + 1, this.entryX(lane[0]!), y, lanePassed);
      this.drawSeq(lane, laneRows[i]!);
      this.hline(this.exitX(lane.at(-1)!, undefined), joinX, y, left);
      this.mark(joinX, y, LEFT, left);
    });
    this.width = Math.max(this.width, joinX + 1);
  }
}

function countsLine(graph: FloorGraph, current: Room, keys: Map<Id, number>): TextChunk[] {
  const choices = current.connectedRoomIds;
  if (choices.length === 0) return [];
  if (choices.length === 1) {
    const { rooms } = graph.routeBounds(current.id);
    return [colorChunk(roomsText("ui.floorMapToGuard", { min: rooms.min - 1, max: rooms.max - 1 }), PALETTE.text)];
  }
  const join = graph.joinAfter(current.id);
  if (!join) return [];
  const stops = new Set(join.ins);
  const chunks: TextChunk[] = [];
  for (const id of choices) {
    chunks.push(boldColorChunk(`[${keys.get(id)}]`, PALETTE.title), colorChunk(` ${roomsText("ui.floorMapLane", graph.routeBounds(id, stops).rooms)}${LIST_GAP}`, PALETTE.text));
  }
  const after = join.outs.map((id) => graph.routeBounds(id).rooms);
  const span = { min: Math.min(...after.map((s) => s.min)), max: Math.max(...after.map((s) => s.max)) };
  chunks.push(colorChunk(roomsText("ui.floorMapThen", span), PALETTE.text));
  return chunks;
}

function legendLine(): TextChunk[] {
  const entries: [string, string, string][] = [
    [CURRENT_ICON, PALETTE.title, "ui.floorMapLegendYou"],
    [ROOM_ICON.combat, ROOM_COLOR.combat, "ui.floorMapLegendFight"],
    [ROOM_ICON.event, ROOM_COLOR.event, "ui.floorMapLegendEvent"],
    [ROOM_ICON.rest, ROOM_COLOR.rest, "ui.floorMapLegendRest"],
    [UNKNOWN_ICON, UNKNOWN_COLOR, "ui.floorMapLegendUnknown"],
    [ROOM_ICON.boss, ROOM_COLOR.boss, "ui.floorMapLegendGuard"],
  ];
  return entries.flatMap(([icon, color, key], i) => [
    ...(i > 0 ? [plainChunk(LIST_GAP)] : []),
    colorChunk(icon, color),
    colorChunk(` ${t(key)}`, PALETTE.dim),
  ]);
}

/** The whole floor as a block of rows sharing one left edge: title, map, the counts for each choice, legend. */
export function renderFloorMap(floor: Floor, roomPath: Id[], currentRoomId: Id): { rows: TextChunk[][]; width: number } {
  const graph = new FloorGraph(
    floor.rooms.map((r) => ({ id: r.id, type: r.type, next: r.connectedRoomIds })),
    floor.entryRoomId
  );
  const byId = new Map(floor.rooms.map((r) => [r.id, r]));
  const current = byId.get(currentRoomId)!;
  const keys = new Map(current.connectedRoomIds.map((id, i) => [id, i + 1]));
  const canvas = new MapCanvas(graph, new Set(roomPath));

  const ahead = graph.routeBounds(currentRoomId).rooms;
  const title =
    current.connectedRoomIds.length === 0
      ? t("ui.floorMapTitleAtGuard", { depth: floor.depth })
      : t("ui.floorMapTitle", { depth: floor.depth, range: rangeText({ min: ahead.min - 1, max: ahead.max - 1 }), n: ahead.max - 1 });
  const counts = countsLine(graph, current, keys);
  const rows: TextChunk[][] = [
    [colorChunk(title, PALETTE.title)],
    [],
    ...canvas.render(currentRoomId, keys, byId),
    [],
    ...(counts.length > 0 ? [counts, []] : []),
    legendLine(),
  ];
  return { rows, width: Math.max(...rows.map(chunkLength)) };
}
