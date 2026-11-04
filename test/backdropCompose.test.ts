import { expect, test } from "bun:test";
import { RGBA, type TextChunk } from "@opentui/core";
import type { UnitShadow } from "../src/data/backdrops";
import { BACKDROP_ROWS, composeBattlefield, sameContent } from "../src/ui/backdrop";
import { BATTLEFIELD_CONTENT_WIDTH } from "../src/ui/layout";

const W = BATTLEFIELD_CONTENT_WIDTH;
const chunk = (text: string, extra: Partial<TextChunk> = {}): TextChunk => ({ __isChunk: true, text, ...extra });
const hex = (h: string) => RGBA.fromHex(h);
const solid = (rows: number, width: number, color: string) =>
  Array.from({ length: rows }, () => Array.from({ length: width }, () => color));

function cells(row: TextChunk[]): { text: string; bg: string | undefined; fg: string | undefined }[] {
  return row.flatMap((c) =>
    Array.from(c.text).map(() => ({
      text: "",
      bg: c.bg ? c.bg.toInts().join(",") : undefined,
      fg: c.fg ? c.fg.toInts().join(",") : undefined,
    })),
  ).map((x, i) => ({ ...x, text: Array.from(row.map((c) => c.text).join(""))[i]! }));
}
const rgb = (h: string) => hex(h).toInts().join(",");

test("sprite cells keep their colour; transparent and text cells take the backdrop", () => {
  const content = [[chunk(" ", { bg: hex("#112233") }), chunk(" "), chunk("a", { fg: hex("#ff0000") })]];
  const out = composeBattlefield(content, solid(1, W, "#445566"), W, 0, null);
  const c = cells(out[0]!);
  expect(c[0]!.bg).toBe(rgb("#112233"));
  expect(c[1]!.bg).toBe(rgb("#445566"));
  expect(c[2]).toEqual({ text: "a", bg: rgb("#445566"), fg: rgb("#ff0000") });
  expect(out[0]!.map((x) => x.text).join("").length).toBe(W);
});

test("label rows (index >= BACKDROP_ROWS) get no background", () => {
  const content = Array.from({ length: BACKDROP_ROWS + 1 }, () => [chunk("x")]);
  const out = composeBattlefield(content, solid(BACKDROP_ROWS, W, "#445566"), W, 0, null);
  expect(cells(out[BACKDROP_ROWS - 1]!)[0]!.bg).toBe(rgb("#445566"));
  expect(cells(out[BACKDROP_ROWS]!).every((x) => x.bg === undefined)).toBe(true);
});

test("shadow off: no backdrop cell changes; shadow on: only cells within reach of a sprite cell darken by `darkness`", () => {
  const content = [[chunk(" "), chunk(" "), chunk(" "), chunk(" "), chunk(" ", { bg: hex("#112233") }), chunk(" "), chunk(" ")]];
  const backdrop = solid(1, W, "#646464");
  const shadow: UnitShadow = { enabled: true, reachCols: 1, reachRows: 0, darkness: 0.5 };
  const off = cells(composeBattlefield(content, backdrop, W, 0, { ...shadow, enabled: false })[0]!);
  expect(off.filter((x) => x.bg === rgb("#646464")).length).toBe(W - 1);
  const on = cells(composeBattlefield(content, backdrop, W, 0, shadow)[0]!);
  const dark = rgb("#323232");
  expect(on.map((x) => x.bg === dark)).toEqual(on.map((_, i) => i === 3 || i === 5));
  expect(on[4]!.bg).toBe(rgb("#112233"));
});

test("shadow darkens a backdrop cell once even with several sprite cells in reach", () => {
  const sprite = chunk(" ", { bg: hex("#112233") });
  const content = [[sprite, chunk(" "), sprite]];
  const shadow: UnitShadow = { enabled: true, reachCols: 1, reachRows: 0, darkness: 0.5 };
  const on = cells(composeBattlefield(content, solid(1, W, "#646464"), W, 0, shadow)[0]!);
  expect(on[1]!.bg).toBe(rgb("#323232"));
});

test("null backdrop pads rows to width with plain cells, content at contentLeft", () => {
  const out = composeBattlefield([[chunk("ab", { fg: hex("#ff0000") })]], null, 120, 5, null);
  const c = cells(out[0]!);
  expect(c.length).toBe(120);
  expect(c.every((x) => x.bg === undefined)).toBe(true);
  expect(c.slice(0, 5).every((x) => x.text === " ")).toBe(true);
  expect(c[5]!.text + c[6]!.text).toBe("ab");
  expect(c[5]!.fg).toBe(rgb("#ff0000"));
});

test("width narrower than the content: rows are BATTLEFIELD_CONTENT_WIDTH wide, content at column 0", () => {
  const out = composeBattlefield([[chunk("z")]], solid(1, 80, "#445566"), 80, 0, null);
  const c = cells(out[0]!);
  expect(c.length).toBe(W);
  expect(c[0]!.text).toBe("z");
  expect(c[0]!.bg).toBe(rgb("#445566"));
  expect(c[79]!.bg).toBe(rgb("#445566"));
  expect(c[80]!.bg).toBeUndefined();
});

test("glyphs '⚔', '⛨', '✦', '☠' each take one cell", () => {
  const out = composeBattlefield([[chunk("⚔⛨✦☠ab")]], null, W, 0, null);
  const c = cells(out[0]!);
  expect(c.slice(0, 6).map((x) => x.text).join("")).toBe("⚔⛨✦☠ab");
  expect(c.length).toBe(W);
});

test("equal adjacent cells merge into one chunk and inputs stay untouched", () => {
  const input = [chunk("abc")];
  const out = composeBattlefield([input], solid(1, W, "#445566"), W, 0, null);
  expect(out[0]!.length).toBe(1);
  expect(out[0]![0]!.text.length).toBe(W);
  expect(input[0]!.bg).toBeUndefined();
});

test("sameContent compares chunk text and colours, not object identity", () => {
  const a = [[chunk("ab", { fg: hex("#ff0000") }), chunk(" ", { bg: hex("#112233") })]];
  const b = [[chunk("ab", { fg: hex("#ff0000") }), chunk(" ", { bg: hex("#112233") })]];
  expect(sameContent(a, b)).toBe(true);
  expect(sameContent(a, [[chunk("ab", { fg: hex("#ff0001") }), chunk(" ", { bg: hex("#112233") })]])).toBe(false);
  expect(sameContent(a, [[chunk("ab", { fg: hex("#ff0000") })]])).toBe(false);
  expect(sameContent(a, [...b, []])).toBe(false);
});
