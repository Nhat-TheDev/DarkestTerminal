import { expect, test } from "bun:test";
import type { ResolvedScene } from "../src/data/backdrops";
import { BACKDROP_ROWS, paintBackdrop } from "../src/ui/backdrop";

function scene(over: Partial<ResolvedScene> = {}, render: Partial<ResolvedScene["render"]> = {}): ResolvedScene {
  return {
    base: {
      wall: { rows: ["AB", "BA"], palette: { A: "#102030", B: "#304050" } },
      floor: { rows: ["CD"], palette: { C: "#404040", D: "#808080" } },
      baseboard: "#202020",
    },
    rightBase: null,
    props: [],
    render: {
      floorRow: 4,
      brightness: 1,
      jitter: 0,
      edgeFade: { cols: 4, floor: 1 },
      topFade: [],
      dimFactor: 0.5,
      unitShadow: { enabled: false, reachCols: 0, reachRows: 0, darkness: 0 },
      ...render,
    },
    ...over,
  };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test("rightBase takes over from its content column to the panel's right edge", () => {
  const rock = { wall: { rows: ["R"], palette: { R: "#605040" } }, floor: { rows: ["G"], palette: { G: "#506030" } }, baseboard: "#101010" };
  const grid = paintBackdrop(scene({ rightBase: { x: 10, base: rock } }), 40, 5, false);
  expect(grid[0]![14]).not.toBe("#605040");
  for (const x of [15, 30, 39]) {
    expect(grid[0]![x]).toBe("#605040");
    expect(grid[4]![x]).toBe("#101010");
    expect(grid[5]![x]).toBe("#506030");
  }
});

test("wall above floorRow, baseboard on it, floor below, tiles anchored at contentLeft", () => {
  const s = scene();
  const grid = paintBackdrop(s, 20, 5, false);
  expect(grid.length).toBe(BACKDROP_ROWS);
  expect(grid[0]!.length).toBe(20);
  const wall = s.base.wall;
  for (const [x, y] of [[5, 0], [6, 1], [8, 3], [4, 2], [3, 1], [0, 0]] as const) {
    const w = wall.rows[0]!.length;
    const ch = wall.rows[y % wall.rows.length]![(((x - 5) % w) + w) % w]!;
    expect(grid[y]![x]).toBe(wall.palette[ch]!);
  }
  expect(grid[4]!.every((c) => c === "#202020")).toBe(true);
  expect(grid[5]![5]).toBe("#404040");
  expect(grid[5]![6]).toBe("#808080");
  expect(grid[5]![4]).toBe("#808080");
});

test("a prop's coloured cells replace the base at contentLeft + x, y; its '.' cells don't", () => {
  const prop = { rows: ["R.", ".R"], palette: { R: "#ff0000" } };
  const base = paintBackdrop(scene(), 20, 5, false);
  const grid = paintBackdrop(scene({ props: [{ prop, x: 2, y: 1 }] }), 20, 5, false);
  expect(grid[1]![7]).toBe("#ff0000");
  expect(grid[2]![8]).toBe("#ff0000");
  expect(grid[1]![8]).toBe(base[1]![8]!);
  expect(grid[2]![7]).toBe(base[2]![7]!);
});

test("a light makes cells near it warmer and leaves cells beyond its radius untouched", () => {
  const prop = { rows: ["R"], palette: { R: "#ff0000" }, light: { radius: 6, color: "#ffa000", strength: 0.8 } };
  const base = paintBackdrop(scene(), 40, 5, false);
  const grid = paintBackdrop(scene({ props: [{ prop, x: 10, y: 1 }] }), 40, 5, false);
  expect(grid[1]![17]).not.toBe(base[1]![17]!);
  expect(rgb(grid[1]![17]!)[0]!).toBeGreaterThan(rgb(base[1]![17]!)[0]!);
  expect(grid[1]![30]).toBe(base[1]![30]!);
});

test("dimmed multiplies every channel by dimFactor", () => {
  const s = scene();
  const a = paintBackdrop(s, 20, 5, false);
  const b = paintBackdrop(s, 20, 5, true);
  for (const [x, y] of [[5, 0], [9, 4], [7, 8]] as const) {
    expect(rgb(b[y]![x]!)).toEqual(rgb(a[y]![x]!).map((v) => Math.round(v * 0.5)));
  }
});

test("edge fade darkens the panel's outer columns, not the content's", () => {
  const s = scene({}, { edgeFade: { cols: 4, floor: 0.2 } });
  const grid = paintBackdrop(s, 200, 43, false);
  expect(rgb(grid[0]![0]!)[2]!).toBeLessThan(rgb(grid[0]![44]!)[2]!);
  expect(grid[0]![43]).toBe(paintBackdrop(scene(), 200, 43, false)[0]![43]!);
});

test("top fade scales rows by topFade and ignores missing indices", () => {
  const plain = paintBackdrop(scene(), 20, 5, false);
  const grid = paintBackdrop(scene({}, { topFade: [0.5] }), 20, 5, false);
  expect(rgb(grid[0]![8]!)).toEqual(rgb(plain[0]![8]!).map((v) => Math.round(v * 0.5)));
  expect(grid[1]).toEqual(plain[1]!);
});

test("jitter is deterministic and relative to contentLeft", () => {
  const s = scene({}, { jitter: 0.4 });
  const a = paintBackdrop(s, 60, 0, false);
  const b = paintBackdrop(s, 60, 20, false);
  expect(paintBackdrop(s, 60, 0, false)).toEqual(a);
  for (let c = 0; c < 30; c++) {
    expect(b[2]![c + 20]).toBe(a[2]![c]!);
    expect(b[9]![c + 20]).toBe(a[9]![c]!);
  }
  expect(new Set(a[2]!).size).toBeGreaterThan(2);
});
