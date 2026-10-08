import { describe, expect, test } from "bun:test";
import { FOCUS_COLOR, FOCUS_GLYPH, blankIconBand, buildSideSpriteArea, dimColor, dimSprite, focusedUnit, tierFrameHeight, unitFocus, type FocusIcon } from "../src/ui/battlefieldFocus";
import { ICON_BAND_ROWS, SLOT_GAP, SLOT_WIDTH, UNIT_BLOCK_HEIGHT } from "../src/ui/layout";
import { MAX_BOSS_HEIGHT, MAX_ELITE_HEIGHT, MAX_UNIT_HEIGHT, compositeSpriteRow, spriteSlotLayout, type Sprite } from "../src/ui/sprites";
import type { LogSession } from "../src/types";

function session(partial: Partial<LogSession>): LogSession {
  return { id: 1, actorId: null, attackedIds: [], debuffedIds: [], buffedIds: [], healedIds: [], affectedIds: [], ...partial };
}
const glyphs = (icons: { glyph: string }[]) => icons.map((i) => i.glyph);
const textOf = (line: { text: string }[]) => line.map((c) => c.text).join("");

describe("dimColor", () => {
  test("turns a colour into a darker grey", () => {
    const grey = dimColor("#c0392b");
    expect(grey).toMatch(/^#([0-9a-f]{2})\1\1$/);
    expect(parseInt(grey.slice(1, 3), 16)).toBeLessThan(0xc0);
  });
  test("leaves anything that is not #rrggbb alone", () => {
    expect(dimColor("transparent")).toBe("transparent");
  });
});

describe("dimSprite", () => {
  test("greys every palette entry and keeps the rows", () => {
    const sprite = { rows: ["AB"], palette: { A: "#ff0000", B: "#00ff00" } };
    const dimmed = dimSprite(sprite);
    expect(dimmed.rows).toEqual(sprite.rows);
    for (const color of Object.values(dimmed.palette)) expect(color).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });
});

describe("unitFocus", () => {
  test("no session: nothing is dimmed, no icons", () => {
    expect(unitFocus("a", "party", null)).toEqual({ dim: false, icons: [] });
  });

  test("a bystander is dimmed and has no icons", () => {
    expect(unitFocus("z", "party", session({ actorId: "a", attackedIds: ["m1"] }))).toEqual({ dim: true, icons: [] });
  });

  test("attacker gets a sword in its own side's colour, target a shield in the target's side colour", () => {
    const s = session({ actorId: "p1", attackedIds: ["m1"] });
    expect(unitFocus("p1", "party", s)).toEqual({ dim: false, icons: [{ glyph: FOCUS_GLYPH.sword, color: FOCUS_COLOR.party }] });
    expect(unitFocus("m1", "monster", s)).toEqual({ dim: false, icons: [{ glyph: FOCUS_GLYPH.shield, color: FOCUS_COLOR.monster }] });
  });

  test("a monster attacking the party: red sword, blue shields", () => {
    const s = session({ actorId: "m1", attackedIds: ["p1", "p2"] });
    expect(unitFocus("m1", "monster", s).icons[0]).toEqual({ glyph: FOCUS_GLYPH.sword, color: FOCUS_COLOR.monster });
    expect(unitFocus("p2", "party", s).icons[0]).toEqual({ glyph: FOCUS_GLYPH.shield, color: FOCUS_COLOR.party });
  });

  test("debuff-only: caster has a sword, target the debuff glyph instead of a shield", () => {
    const s = session({ actorId: "p1", debuffedIds: ["m1"] });
    expect(glyphs(unitFocus("p1", "party", s).icons)).toEqual([FOCUS_GLYPH.sword]);
    expect(glyphs(unitFocus("m1", "monster", s).icons)).toEqual([FOCUS_GLYPH.debuff]);
  });

  test("buff and heal glyphs take the colour of the side wearing them", () => {
    const s = session({ actorId: "m1", buffedIds: ["m2"] });
    expect(unitFocus("m2", "monster", s).icons).toEqual([{ glyph: FOCUS_GLYPH.buff, color: FOCUS_COLOR.monster }]);
    expect(unitFocus("m1", "monster", s).icons).toEqual([{ glyph: FOCUS_GLYPH.support, color: FOCUS_COLOR.monster }]);
  });

  test("buff and heal: caster has the support glyph, targets the buff / heal glyph", () => {
    const s = session({ actorId: "p1", buffedIds: ["p2"], healedIds: ["p3"] });
    expect(glyphs(unitFocus("p1", "party", s).icons)).toEqual([FOCUS_GLYPH.support]);
    expect(glyphs(unitFocus("p2", "party", s).icons)).toEqual([FOCUS_GLYPH.buff]);
    expect(glyphs(unitFocus("p3", "party", s).icons)).toEqual([FOCUS_GLYPH.heal]);
  });

  test("a unit with several roles shows every glyph, caster glyphs first", () => {
    const selfBuff = session({ actorId: "p1", buffedIds: ["p1"] });
    expect(glyphs(unitFocus("p1", "party", selfBuff).icons)).toEqual([FOCUS_GLYPH.support, FOCUS_GLYPH.buff]);
    const hitAndBuff = session({ actorId: "p1", attackedIds: ["m1"], buffedIds: ["p1"] });
    expect(glyphs(unitFocus("p1", "party", hitAndBuff).icons)).toEqual([FOCUS_GLYPH.sword, FOCUS_GLYPH.support, FOCUS_GLYPH.buff]);
  });

  test("an actor-less tick lights its units without icons", () => {
    const s = session({ affectedIds: ["m1"] });
    expect(unitFocus("m1", "monster", s)).toEqual({ dim: false, icons: [] });
    expect(unitFocus("p1", "party", s).dim).toBe(true);
  });

  test("a debuff glyph is not shown for a unit that was also attacked", () => {
    const s = session({ actorId: "p1", attackedIds: ["m1"], debuffedIds: ["m1"] });
    expect(glyphs(unitFocus("m1", "monster", s).icons)).toEqual([FOCUS_GLYPH.shield]);
  });
});

describe("focusedUnit", () => {
  const unit = { sprite: { rows: ["A"], palette: { A: "#ff0000" } }, label: "VG", labelColor: "#5b7fa6", statusText: "10/10", statusColor: "#5fa85f", frameHeight: MAX_UNIT_HEIGHT };
  test("a lit unit keeps its colours and gains its icons", () => {
    const icons = [{ glyph: FOCUS_GLYPH.sword, color: FOCUS_COLOR.party }];
    expect(focusedUnit(unit, { dim: false, icons })).toEqual({ ...unit, icons });
  });
  test("a dimmed unit has grey sprite, label and status", () => {
    const dimmed = focusedUnit(unit, { dim: true, icons: [] });
    expect(dimmed.labelColor).toBe(dimColor(unit.labelColor));
    expect(dimmed.statusColor).toBe(dimColor(unit.statusColor));
    expect(dimmed.sprite.palette["A"]).toBe(dimColor("#ff0000"));
  });
});

describe("spriteSlotLayout", () => {
  const wide = { rows: ["A".repeat(14)], palette: { A: "#ff0000" } };
  const normal = { rows: ["A".repeat(13)], palette: { A: "#ff0000" } };

  test("matches where compositeSpriteRow really draws each sprite", () => {
    const { starts, canvasWidth } = spriteSlotLayout([wide, normal], SLOT_WIDTH, SLOT_GAP);
    expect(starts).toEqual([0, 16]); // the 14-wide first sprite pushes the whole row right by 1
    const row = compositeSpriteRow([wide, normal], SLOT_WIDTH, 1, SLOT_GAP)[0]!;
    expect(row).toHaveLength(canvasWidth);
  });
});

describe("icons above the sprites", () => {
  const sword: FocusIcon = { glyph: FOCUS_GLYPH.sword, color: FOCUS_COLOR.party };
  const wide = { rows: ["A".repeat(14)], palette: { A: "#ff0000" } };
  const normal = { rows: ["A".repeat(13)], palette: { A: "#ff0000" } };
  const unit = tierFrameHeight("party");
  const area = (sprites: Sprite[], icons: FocusIcon[][], frameHeights = sprites.map(() => unit)) =>
    buildSideSpriteArea(sprites, icons, frameHeights, SLOT_WIDTH, SLOT_GAP).map(textOf);
  const iconRow = (lines: string[]) => lines.findIndex((line) => line.trim() !== "");

  test("tier heights are the max sprite heights: characters and normal monsters, elites, bosses", () => {
    expect(tierFrameHeight("party")).toBe(MAX_UNIT_HEIGHT);
    expect(tierFrameHeight("normal")).toBe(MAX_UNIT_HEIGHT);
    expect(tierFrameHeight("elite")).toBe(MAX_ELITE_HEIGHT);
    expect(tierFrameHeight("boss")).toBe(MAX_BOSS_HEIGHT);
  });

  test("covers the icon band plus the sprite frame, as wide as the sprite canvas", () => {
    const lines = area([normal, normal], [[sword], []]);
    const { canvasWidth } = spriteSlotLayout([normal, normal], SLOT_WIDTH, SLOT_GAP);
    expect(lines).toHaveLength(ICON_BAND_ROWS + MAX_BOSS_HEIGHT);
    for (const line of lines) expect(line).toHaveLength(canvasWidth);
  });

  test("an icon sits one blank row above the tallest sprite of its tier", () => {
    const total = ICON_BAND_ROWS + MAX_BOSS_HEIGHT;
    for (const tier of ["party", "elite", "boss"] as const) {
      const height = tierFrameHeight(tier);
      const lines = area([normal], [[sword]], [height]);
      const row = iconRow(lines);
      expect(row).toBe(total - height - 2);
      expect(lines[row + 1]!.trim()).toBe("");
    }
  });

  test("units of one tier wear their icons on the same row", () => {
    const lines = area([normal, normal], [[sword], [sword]]);
    const row = iconRow(lines);
    expect(lines[row]!.split(FOCUS_GLYPH.sword)).toHaveLength(3);
  });

  test("icons sit over the middle of each sprite, also for a sprite wider than its slot", () => {
    const { starts } = spriteSlotLayout([wide, normal], SLOT_WIDTH, SLOT_GAP);
    const lines = area([wide, normal], [[sword], [sword]]);
    const line = lines[iconRow(lines)]!;
    expect(line.indexOf(FOCUS_GLYPH.sword)).toBe(starts[0]! + 7);
    expect(line.lastIndexOf(FOCUS_GLYPH.sword)).toBe(starts[1]! + 6);
  });

  test("several icons stay centred on the sprite", () => {
    const icons = [FOCUS_GLYPH.support, FOCUS_GLYPH.buff, FOCUS_GLYPH.heal].map((glyph) => ({ glyph, color: FOCUS_COLOR.party }));
    const lines = area([normal], [icons]);
    const line = lines[iconRow(lines)]!;
    expect(line.trim()).toBe(`${FOCUS_GLYPH.support}${FOCUS_GLYPH.buff}${FOCUS_GLYPH.heal}`);
    expect(line.indexOf(FOCUS_GLYPH.buff)).toBe(6);
  });

  test("blankIconBand pads a block that has no units", () => {
    const band = blankIconBand(30);
    expect(band).toHaveLength(ICON_BAND_ROWS);
    expect(band.every((line) => textOf(line) === " ".repeat(30))).toBe(true);
  });
});

describe("layout", () => {
  test("the unit block makes room for the icon band", () => {
    expect(ICON_BAND_ROWS).toBe(2);
    expect(UNIT_BLOCK_HEIGHT).toBe(ICON_BAND_ROWS + MAX_BOSS_HEIGHT + 3);
  });
});
