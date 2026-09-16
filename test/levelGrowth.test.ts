import { describe, expect, test } from "bun:test";
import { monsterDepthBuffPercent, MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS } from "../src/data/levelGrowth";

describe("monsterDepthBuffPercent", () => {
  test("floor 1-10 is 0%", () => {
    expect(monsterDepthBuffPercent(1)).toBe(0);
    expect(monsterDepthBuffPercent(10)).toBe(0);
  });

  test("floor 11 jumps to 10%, not interpolated from floor 10's 0%", () => {
    expect(monsterDepthBuffPercent(11)).toBe(10);
    expect(monsterDepthBuffPercent(20)).toBe(10);
  });

  test("bracket boundaries match the design spec's cumulative table exactly", () => {
    expect(monsterDepthBuffPercent(21)).toBe(18);
    expect(monsterDepthBuffPercent(31)).toBe(25);
    expect(monsterDepthBuffPercent(41)).toBe(31);
    expect(monsterDepthBuffPercent(51)).toBe(36);
    expect(monsterDepthBuffPercent(61)).toBe(40.25);
    expect(monsterDepthBuffPercent(71)).toBe(43.75);
    expect(monsterDepthBuffPercent(81)).toBe(46.75);
    expect(monsterDepthBuffPercent(91)).toBe(49.25);
    expect(monsterDepthBuffPercent(101)).toBe(51.25);
    expect(monsterDepthBuffPercent(111)).toBe(53.25);
  });

  test("plateau: floor 120 and any depth beyond it stays at 53.25%, never extrapolates further", () => {
    expect(monsterDepthBuffPercent(120)).toBe(53.25);
    expect(monsterDepthBuffPercent(200)).toBe(53.25);
    expect(monsterDepthBuffPercent(999)).toBe(53.25);
  });

  test("per-stat coefficients match the design spec exactly", () => {
    expect(MONSTER_DEPTH_BUFF_STAT_COEFFICIENTS).toEqual({ maxHp: 1.5, attack: 1, defense: 0.75 });
  });
});
