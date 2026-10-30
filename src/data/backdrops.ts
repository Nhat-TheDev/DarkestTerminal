import backdropsJson from "../../data/backdrops.json";
import { allRoomNameEntries, backdropIdForRoomName, type RoomNameEntry } from "./roomNames";
import { EVENTS } from "./events";

export interface PixelGrid {
  rows: string[];
  palette: Record<string, string>;
}
export interface BackdropLight {
  radius: number;
  color: string;
  strength: number;
}
export interface BackdropProp extends PixelGrid {
  light?: BackdropLight;
}
export interface BackdropBase {
  wall: PixelGrid;
  floor: PixelGrid;
  baseboard: string;
}
export interface UnitShadow {
  enabled: boolean;
  reachCols: number;
  reachRows: number;
  darkness: number;
}
export interface BackdropRender {
  floorRow: number;
  brightness: number;
  jitter: number;
  edgeFade: { cols: number; floor: number };
  topFade: number[];
  dimFactor: number;
  unitShadow: UnitShadow;
}
export interface BackdropScene {
  base: string;
  /** From content column `x` to the panel's right edge, `base` replaces the scene's base. */
  rightBase?: { x: number; base: string };
  props: { prop: string; x: number; y: number }[];
  render?: Partial<Omit<BackdropRender, "edgeFade" | "unitShadow">> & {
    edgeFade?: Partial<BackdropRender["edgeFade"]>;
    unitShadow?: Partial<UnitShadow>;
  };
}
export interface BackdropsFile {
  render: BackdropRender;
  bases: Record<string, BackdropBase>;
  props: Record<string, BackdropProp>;
  scenes: Record<string, BackdropScene>;
}
export interface ResolvedScene {
  base: BackdropBase;
  rightBase: { x: number; base: BackdropBase } | null;
  props: { prop: BackdropProp; x: number; y: number }[];
  render: BackdropRender;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_FLOOR_ROW = 17;

function fail(msg: string): never {
  throw new Error(`data/backdrops.json: ${msg}`);
}

function checkUnit(value: unknown, what: string): void {
  if (typeof value !== "number" || !(value >= 0 && value <= 1)) fail(`${what} must be a number from 0 to 1`);
}

function checkColor(value: unknown, what: string): void {
  if (typeof value !== "string" || !HEX.test(value)) fail(`${what} must be a #rrggbb colour`);
}

function checkGrid(grid: PixelGrid, what: string): void {
  if (!Array.isArray(grid?.rows) || grid.rows.length === 0 || grid.rows.some((r) => typeof r !== "string")) {
    fail(`${what} needs a non-empty list of rows`);
  }
  const width = grid.rows[0]!.length;
  if (width === 0 || grid.rows.some((r) => r.length !== width)) fail(`${what} rows must all have the same non-zero length`);
  const palette = grid.palette ?? {};
  for (const [key, color] of Object.entries(palette)) checkColor(color, `${what} palette "${key}"`);
  for (const row of grid.rows) {
    for (const ch of row) {
      if (ch !== "." && !(ch in palette)) fail(`${what} uses "${ch}" with no palette colour`);
    }
  }
}

function checkRender(r: Partial<BackdropRender>, what: string, full: boolean): void {
  const need = (key: string) => full && r[key as keyof BackdropRender] === undefined && fail(`${what}.${key} is missing`);
  for (const key of ["floorRow", "brightness", "jitter", "edgeFade", "topFade", "dimFactor", "unitShadow"]) need(key);
  if (r.floorRow !== undefined && !(Number.isInteger(r.floorRow) && r.floorRow >= 0 && r.floorRow <= MAX_FLOOR_ROW)) {
    fail(`${what}.floorRow must be an integer from 0 to ${MAX_FLOOR_ROW}`);
  }
  for (const key of ["brightness", "jitter"] as const) {
    if (r[key] !== undefined && (typeof r[key] !== "number" || r[key]! < 0)) fail(`${what}.${key} must be a non-negative number`);
  }
  if (r.dimFactor !== undefined) checkUnit(r.dimFactor, `${what}.dimFactor`);
  if (r.topFade !== undefined) {
    if (!Array.isArray(r.topFade)) fail(`${what}.topFade must be a list of numbers from 0 to 1`);
    if (r.topFade.length > MAX_FLOOR_ROW + 1) fail(`${what}.topFade has more than ${MAX_FLOOR_ROW + 1} rows`);
    r.topFade.forEach((v, i) => checkUnit(v, `${what}.topFade[${i}]`));
  }
  if (r.edgeFade?.cols !== undefined && !(Number.isInteger(r.edgeFade.cols) && r.edgeFade.cols >= 0)) {
    fail(`${what}.edgeFade.cols must be a non-negative integer`);
  }
  if (r.edgeFade?.floor !== undefined) checkUnit(r.edgeFade.floor, `${what}.edgeFade.floor`);
  const u = r.unitShadow;
  if (u?.enabled !== undefined && typeof u.enabled !== "boolean") fail(`${what}.unitShadow.enabled must be a boolean`);
  if (u?.darkness !== undefined) checkUnit(u.darkness, `${what}.unitShadow.darkness`);
  for (const key of ["reachCols", "reachRows"] as const) {
    if (u?.[key] !== undefined && !(Number.isInteger(u[key]) && u[key]! >= 0)) fail(`${what}.unitShadow.${key} must be a non-negative integer`);
  }
  if (full) {
    const e = r.edgeFade!;
    const s = r.unitShadow!;
    if (e.cols === undefined || e.floor === undefined) fail(`${what}.edgeFade needs cols and floor`);
    if (s.enabled === undefined || s.reachCols === undefined || s.reachRows === undefined || s.darkness === undefined) {
      fail(`${what}.unitShadow needs enabled, reachCols, reachRows and darkness`);
    }
  }
}

export function parseBackdrops(raw: unknown, roomEntries: RoomNameEntry[], events: { id: string; backdrop?: string }[] = []): BackdropsFile {
  const file = raw as BackdropsFile;
  if (!file || typeof file !== "object" || !file.render || !file.bases || !file.props || !file.scenes) {
    fail("needs render, bases, props and scenes");
  }
  checkRender(file.render, "render", true);
  for (const [id, base] of Object.entries(file.bases)) {
    checkGrid(base.wall, `base "${id}" wall`);
    checkGrid(base.floor, `base "${id}" floor`);
    checkColor(base.baseboard, `base "${id}" baseboard`);
  }
  for (const [id, prop] of Object.entries(file.props)) {
    checkGrid(prop, `prop "${id}"`);
    if (prop.light) {
      checkColor(prop.light.color, `prop "${id}" light color`);
      checkUnit(prop.light.strength, `prop "${id}" light strength`);
      if (typeof prop.light.radius !== "number" || prop.light.radius < 0) fail(`prop "${id}" light radius must be a non-negative number`);
    }
  }
  for (const [id, scene] of Object.entries(file.scenes)) {
    if (!(scene.base in file.bases)) fail(`scene "${id}" uses unknown base "${scene.base}"`);
    if (scene.rightBase) {
      if (!(scene.rightBase.base in file.bases)) fail(`scene "${id}" rightBase uses unknown base "${scene.rightBase.base}"`);
      if (!Number.isInteger(scene.rightBase.x)) fail(`scene "${id}" rightBase x must be an integer`);
    }
    if (!Array.isArray(scene.props)) fail(`scene "${id}" needs a list of props`);
    for (const p of scene.props) {
      if (!(p.prop in file.props)) fail(`scene "${id}" uses unknown prop "${p.prop}"`);
      if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) fail(`scene "${id}" places "${p.prop}" at a non-integer position`);
    }
    if (scene.render) checkRender(scene.render as Partial<BackdropRender>, `scene "${id}" render`, false);
  }
  for (const entry of roomEntries) {
    if (!(entry.backdrop in file.scenes)) fail(`room "${entry.name}" points at unknown scene "${entry.backdrop}"`);
  }
  for (const event of events) {
    if (event.backdrop !== undefined && !(event.backdrop in file.scenes)) fail(`event "${event.id}" points at unknown scene "${event.backdrop}"`);
  }
  return file;
}

export function resolveScene(file: BackdropsFile, sceneId: string): ResolvedScene {
  const scene = file.scenes[sceneId];
  if (!scene) fail(`unknown scene "${sceneId}"`);
  const { edgeFade, unitShadow, ...rest } = scene.render ?? {};
  return {
    base: file.bases[scene.base]!,
    rightBase: scene.rightBase ? { x: scene.rightBase.x, base: file.bases[scene.rightBase.base]! } : null,
    props: scene.props.map((p) => ({ prop: file.props[p.prop]!, x: p.x, y: p.y })),
    render: {
      ...file.render,
      ...rest,
      edgeFade: { ...file.render.edgeFade, ...edgeFade },
      unitShadow: { ...file.render.unitShadow, ...unitShadow },
    },
  };
}

export const BACKDROPS: BackdropsFile = parseBackdrops(backdropsJson, allRoomNameEntries(), EVENTS);

export function sceneById(id: string | null): ResolvedScene | null {
  return id === null ? null : resolveScene(BACKDROPS, id);
}

export function sceneForRoomName(name: string): ResolvedScene | null {
  return sceneById(backdropIdForRoomName(name));
}
