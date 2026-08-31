import { describe, test, expect } from "bun:test";
import { renderBigText, renderBigTextStacked } from "../src/ui/bigText";

describe("renderBigText", () => {
  test("every row has the same width", () => {
    for (const word of ["Darkest", "Terminal", "DIM SKIRT"]) {
      const rows = renderBigText(word);
      const width = rows[0]!.length;
      expect(width).toBeGreaterThan(0);
      for (const row of rows) expect(row.length).toBe(width);
    }
  });

  test("is case-insensitive", () => {
    expect(renderBigText("test")).toEqual(renderBigText("TEST"));
  });
});

describe("renderBigTextStacked", () => {
  test("every row shares the widest word's width", () => {
    const rows = renderBigTextStacked(["Darkest", "Terminal"]);
    const width = Math.max(...rows.map((r) => r.length));
    for (const row of rows) expect(row.length).toBe(width);
  });

  test("inserts 1 blank row between words", () => {
    const darkest = renderBigText("Darkest");
    const terminal = renderBigText("Terminal");
    const rows = renderBigTextStacked(["Darkest", "Terminal"]);
    expect(rows).toHaveLength(darkest.length + 1 + terminal.length);
    expect(rows[darkest.length]!.trim()).toBe("");
  });
});
