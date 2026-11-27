import type { TextChunk } from "@opentui/core";
import type { Floor, Id, Room, RoomType } from "../types";
import { FloorGraph } from "../engine/floorGraph";
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
const ROOM_ICON: Record<RoomType, string> = { combat: "·", event: "○", rest: "△", boss: "☠", temple: "†" };
const UNKNOWN_COLOR = PALETTE.hpMid;
const ROOM_COLOR: Record<RoomType, string> = { combat: PALETTE.text, event: PALETTE.passive, rest: PALETTE.hpHigh, boss: PALETTE.hpLow, temple: PALETTE.title };
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

/** A chain of rooms drawn on one row, each the first next room of the one before. */
interface Track {
  last: Id;
  start: number;
  /** Where the track's line begins and ends on its row. */
  fromX: number;
  toX: number;
  row: number;
  children: Track[];
  /** Orders tracks that end at the same x: the column they leave from, then the order of the choices there. */
  spawnKey: [number, number];
}

class MapCanvas {
  private readonly columns: Map<Id, number>;
  private readonly trackOf = new Map<Id, Track>();
  private readonly occupied = new Map<number, [number, number][]>();
  private readonly lines = new Map<string, LineMark>();
  private readonly rooms: { id: Id; x: number; y: number }[] = [];
  width = 0;
  height = 0;

  constructor(
    private readonly graph: FloorGraph,
    private readonly visited: ReadonlySet<Id>
  ) {
    this.columns = graph.columns();
    const root = this.buildTracks();
    this.claim(0, root.fromX, root.toX);
    this.placeChildren(root);
    for (const room of graph.byId.values()) {
      const x = this.x(room.id);
      const y = this.y(room.id);
      this.rooms.push({ id: room.id, x, y });
      this.width = Math.max(this.width, x + CELL_WIDTH);
      this.height = Math.max(this.height, y + 1);
      for (const next of room.next) this.drawEdge(room.id, next);
    }
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

  private x(id: Id): number {
    return this.columns.get(id)! * COLUMN_STEP;
  }

  private y(id: Id): number {
    return this.trackOf.get(id)!.row * 2;
  }

  /** A room joins the track of a room it is the first choice of, the one that started furthest left; otherwise it starts a track. */
  private buildTracks(): Track {
    const order = [...this.graph.byId.keys()].sort((a, b) => this.columns.get(a)! - this.columns.get(b)!);
    let root: Track | null = null;
    for (const id of order) {
      const col = this.columns.get(id)!;
      const preds = this.graph.preds.get(id) ?? [];
      const leftmost = (ids: Id[]) => ids.reduce((best, p) => (this.trackOf.get(p)!.start < this.trackOf.get(best)!.start ? p : best));
      const leading = preds.filter((p) => this.graph.room(p).next[0] === id);
      if (leading.length > 0) {
        const track = this.trackOf.get(leftmost(leading))!;
        track.last = id;
        this.trackOf.set(id, track);
        continue;
      }
      const parentRoom = preds.length > 0 ? leftmost(preds) : null;
      const track: Track = {
        last: id,
        start: col,
        fromX: parentRoom === null ? 0 : col * COLUMN_STEP - 2,
        toX: 0,
        row: 0,
        children: [],
        spawnKey: parentRoom === null ? [0, 0] : [this.columns.get(parentRoom)!, this.graph.room(parentRoom).next.indexOf(id)],
      };
      if (parentRoom === null) root = track;
      else this.trackOf.get(parentRoom)!.children.push(track);
      this.trackOf.set(id, track);
    }
    for (const track of new Set(this.trackOf.values())) {
      const last = this.graph.room(track.last);
      track.toX =
        last.next.length === 0 ? this.x(last.id) + CELL_WIDTH - 1 : Math.min(...last.next.map((n) => this.x(n) - 2));
    }
    return root!;
  }

  private claim(row: number, fromX: number, toX: number): void {
    const spans = this.occupied.get(row) ?? [];
    spans.push([fromX, toX]);
    this.occupied.set(row, spans);
  }

  private isFree(row: number, fromX: number, toX: number): boolean {
    return (this.occupied.get(row) ?? []).every(([a, b]) => b < fromX || a > toX);
  }

  /** Tracks that end sooner sit closer to their parent, and each track's own children stack right under it. */
  private placeChildren(parent: Track): void {
    const children = [...parent.children].sort((a, b) => a.toX - b.toX || a.spawnKey[0] - b.spawnKey[0] || a.spawnKey[1] - b.spawnKey[1]);
    for (const child of children) {
      let row = parent.row + 1;
      while (!this.isFree(row, child.fromX, child.toX)) row++;
      child.row = row;
      this.claim(row, child.fromX, child.toX);
      this.placeChildren(child);
    }
  }

  private passed(fromId: Id, toId: Id): boolean {
    return this.visited.has(fromId) && this.visited.has(toId);
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

  /** Along the source's row to the gap before the target, up or down there, then into the target. */
  private drawEdge(fromId: Id, toId: Id): void {
    const passed = this.passed(fromId, toId);
    const startX = this.x(fromId) + CELL_WIDTH;
    const turnX = this.x(toId) - 2;
    const fromY = this.y(fromId);
    const toY = this.y(toId);
    if (fromY === toY) {
      this.hline(startX, this.x(toId), fromY, passed);
      return;
    }
    this.hline(startX, turnX, fromY, passed);
    this.mark(turnX, fromY, LEFT | (toY > fromY ? DOWN : UP), passed);
    for (let y = Math.min(fromY, toY) + 1; y < Math.max(fromY, toY); y++) this.mark(turnX, y, UP | DOWN, passed);
    this.mark(turnX, toY, RIGHT | (toY > fromY ? UP : DOWN), passed);
    this.mark(turnX + 1, toY, LEFT | RIGHT, passed);
  }
}

function legendLine(): TextChunk[] {
  const entries: [string, string, string][] = [
    [CURRENT_ICON, PALETTE.title, "ui.floorMapLegendYou"],
    [ROOM_ICON.combat, ROOM_COLOR.combat, "ui.floorMapLegendFight"],
    [ROOM_ICON.event, ROOM_COLOR.event, "ui.floorMapLegendEvent"],
    [ROOM_ICON.rest, ROOM_COLOR.rest, "ui.floorMapLegendRest"],
    [ROOM_ICON.temple, ROOM_COLOR.temple, "ui.floorMapLegendTemple"],
    [UNKNOWN_ICON, UNKNOWN_COLOR, "ui.floorMapLegendUnknown"],
    [ROOM_ICON.boss, ROOM_COLOR.boss, "ui.floorMapLegendGuard"],
  ];
  return entries.flatMap(([icon, color, key], i) => [
    ...(i > 0 ? [plainChunk(LIST_GAP)] : []),
    colorChunk(icon, color),
    colorChunk(` ${t(key)}`, PALETTE.dim),
  ]);
}

/** The whole floor as a block of rows sharing one left edge: title, map, legend. Exits carry their digit only where pressing it moves the party. */
export function renderFloorMap(floor: Floor, roomPath: Id[], currentRoomId: Id, exitKeys = true): { rows: TextChunk[][]; width: number } {
  const graph = new FloorGraph(
    floor.rooms.map((r) => ({ id: r.id, type: r.type, next: r.connectedRoomIds })),
    floor.entryRoomId
  );
  const byId = new Map(floor.rooms.map((r) => [r.id, r]));
  const current = byId.get(currentRoomId)!;
  const keys = new Map(exitKeys ? current.connectedRoomIds.map((id, i) => [id, i + 1]) : []);
  const canvas = new MapCanvas(graph, new Set(roomPath));

  const rows: TextChunk[][] = [
    [colorChunk(t("ui.floorMapTitle", { depth: floor.depth }), PALETTE.title)],
    [],
    ...canvas.render(currentRoomId, keys, byId),
    [],
    legendLine(),
  ];
  return { rows, width: Math.max(...rows.map(chunkLength)) };
}
