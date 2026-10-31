import { RGBA, type TextChunk } from "@opentui/core";
import type { BackdropsFile, PixelGrid, ResolvedScene, UnitShadow } from "../data/backdrops";
import { BATTLEFIELD_CONTENT_WIDTH, ICON_BAND_ROWS } from "./layout";
import { MAX_BOSS_HEIGHT } from "./sprites";

export const BACKDROP_ROWS = ICON_BAND_ROWS + MAX_BOSS_HEIGHT + 1;

type Rgb = [number, number, number];

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function parse(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function toHex(c: Rgb): string {
  return "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}

function scale(c: Rgb, f: number): Rgb {
  return [c[0] * f, c[1] * f, c[2] * f];
}

function tileColor(grid: PixelGrid, tx: number, ty: number): Rgb {
  const h = grid.rows.length;
  const w = grid.rows[0]!.length;
  const ch = grid.rows[((ty % h) + h) % h]![((tx % w) + w) % w]!;
  return parse(grid.palette[ch]!);
}

/** The first placed prop that pokes outside the Battlefield content or into the label rows, as a message. */
export function propBoundsError(file: BackdropsFile): string | null {
  for (const [id, scene] of Object.entries(file.scenes)) {
    for (const p of scene.props) {
      const prop = file.props[p.prop]!;
      if (p.x < 0 || p.y < 0 || p.x + prop.rows[0]!.length > BATTLEFIELD_CONTENT_WIDTH || p.y + prop.rows.length > BACKDROP_ROWS) {
        return `scene "${id}" places "${p.prop}" at ${p.x},${p.y}, outside the ${BATTLEFIELD_CONTENT_WIDTH}×${BACKDROP_ROWS} backdrop`;
      }
    }
  }
  return null;
}

export function paintBackdrop(scene: ResolvedScene, width: number, contentLeft: number, dimmed: boolean): string[][] {
  const { props, render, rightBase } = scene;
  const cells: Rgb[][] = [];
  for (let y = 0; y < BACKDROP_ROWS; y++) {
    const row: Rgb[] = [];
    for (let x = 0; x < width; x++) {
      const tx = x - contentLeft;
      const base = rightBase && tx >= rightBase.x ? rightBase.base : scene.base;
      const color =
        y < render.floorRow
          ? tileColor(base.wall, tx, y)
          : y === render.floorRow
            ? parse(base.baseboard)
            : tileColor(base.floor, tx, y - render.floorRow - 1);
      row.push(scale(color, render.brightness * (1 - render.jitter / 2 + render.jitter * hash(tx, y))));
    }
    cells.push(row);
  }

  for (const { prop, x, y } of props) {
    prop.rows.forEach((line, ry) => {
      const py = y + ry;
      if (py < 0 || py >= BACKDROP_ROWS) return;
      [...line].forEach((ch, rx) => {
        const px = contentLeft + x + rx;
        if (ch !== "." && px >= 0 && px < width) cells[py]![px] = parse(prop.palette[ch]!);
      });
    });
  }

  for (const { prop, x, y } of props) {
    const light = prop.light;
    if (!light) continue;
    const lx = contentLeft + x + Math.floor(prop.rows[0]!.length / 2);
    const target = parse(light.color);
    for (let cy = 0; cy < BACKDROP_ROWS; cy++) {
      for (let cx = 0; cx < width; cx++) {
        const d = Math.hypot((cx - lx) / 2, cy - y);
        if (d >= light.radius) continue;
        const t = light.strength * (1 - d / light.radius);
        const c = cells[cy]![cx]!;
        cells[cy]![cx] = [c[0] + (target[0] - c[0]) * t, c[1] + (target[1] - c[1]) * t, c[2] + (target[2] - c[2]) * t];
      }
    }
  }

  const { cols, floor } = render.edgeFade;
  return cells.map((row, y) =>
    row.map((c, x) => {
      const edge = cols > 0 ? Math.min(1, floor + ((1 - floor) * Math.min(x, width - 1 - x)) / cols) : 1;
      return toHex(scale(c, edge * (render.topFade[y] ?? 1) * (dimmed ? render.dimFactor : 1)));
    }),
  );
}

interface Cell {
  text: string;
  fg?: RGBA;
  bg?: RGBA;
  attributes?: number;
  sprite: boolean;
}

function sameColor(a: RGBA | undefined, b: RGBA | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && a.equals(b));
}

function nearSprite(sprites: boolean[][], x: number, y: number, shadow: UnitShadow): boolean {
  for (let dy = -shadow.reachRows; dy <= shadow.reachRows; dy++) {
    const row = sprites[y + dy];
    if (!row) continue;
    for (let dx = -shadow.reachCols; dx <= shadow.reachCols; dx++) if (row[x + dx]) return true;
  }
  return false;
}

export function sameContent(a: TextChunk[][], b: TextChunk[][]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, y) => {
    const other = b[y]!;
    return (
      row.length === other.length &&
      row.every((c, i) => {
        const d = other[i]!;
        return c.text === d.text && c.attributes === d.attributes && sameColor(c.fg, d.fg) && sameColor(c.bg, d.bg);
      })
    );
  });
}

export function composeBattlefield(
  content: TextChunk[][],
  backdrop: string[][] | null,
  width: number,
  contentLeft: number,
  shadow: UnitShadow | null,
): TextChunk[][] {
  const total = Math.max(width, BATTLEFIELD_CONTENT_WIDTH);
  const grid: Cell[][] = content.map((chunks) => {
    const row: Cell[] = Array.from({ length: total }, () => ({ text: " ", sprite: false }));
    let x = contentLeft;
    for (const c of chunks) {
      for (const ch of Array.from(c.text)) {
        if (x >= 0 && x < total) row[x] = { text: ch, fg: c.fg, bg: c.bg, attributes: c.attributes, sprite: c.bg !== undefined };
        x++;
      }
    }
    return row;
  });

  const sprites = grid.map((row) => row.map((c) => c.sprite));
  const shadowed = shadow?.enabled ? shadow : null;
  grid.forEach((row, y) => {
    const paint = backdrop?.[y];
    if (!paint) return;
    row.forEach((cell, x) => {
      const hex = paint[x];
      if (cell.sprite || hex === undefined) return;
      if (shadowed && nearSprite(sprites, x, y, shadowed)) {
        cell.bg = RGBA.fromHex(toHex(scale(parse(hex), shadowed.darkness)));
      } else {
        cell.bg = RGBA.fromHex(hex);
      }
    });
  });

  return grid.map((row) => {
    const out: TextChunk[] = [];
    let prev: Cell | null = null;
    for (const cell of row) {
      if (prev && sameColor(prev.fg, cell.fg) && sameColor(prev.bg, cell.bg) && prev.attributes === cell.attributes) {
        out[out.length - 1] = { ...out[out.length - 1]!, text: out[out.length - 1]!.text + cell.text };
      } else {
        const chunk: TextChunk = { __isChunk: true, text: cell.text };
        if (cell.fg) chunk.fg = cell.fg;
        if (cell.bg) chunk.bg = cell.bg;
        if (cell.attributes !== undefined) chunk.attributes = cell.attributes;
        out.push(chunk);
      }
      prev = cell;
    }
    return out;
  });
}
