import { describe, expect, test } from "bun:test";
import { FOCUS_COLOR, FOCUS_GLYPH, MARKER_COLOR, blankIconBand, buildSideSpriteArea, dimColor, dimSprite, fearDeltas, focusedUnit, tierFrameHeight, unitFocus, type FocusIcon } from "../src/ui/battlefieldFocus";
import { t } from "../src/data/strings";
import { ICON_BAND_ROWS, SLOT_GAP, SLOT_WIDTH, UNIT_BLOCK_HEIGHT } from "../src/ui/layout";
import { MAX_BOSS_HEIGHT, MAX_ELITE_HEIGHT, MAX_UNIT_HEIGHT, compositeSpriteRow, spriteSlotLayout, type Sprite } from "../src/ui/sprites";
import type { LogSession } from "../src/types";

function session(partial: Partial<LogSession>): LogSession {
  return { id: 1, actorId: null, attackedIds: [], debuffedIds: [], buffedIds: [], healedIds: [], missedIds: [], lifestealIds: [], tickDamageIds: [], buffLostIds: [], lostTurnIds: [], summonIds: [], affectedIds: [], fearChangedIds: [], ...partial };
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
  test("in the fear beat a character wears only the fear glyph and its gain, whatever else the session did", () => {
    const s = session({ actorId: "m1", attackedIds: ["p1"], fearChangedIds: ["p1"] });
    const before = unitFocus("p1", "party", s, -12, true);
    expect(glyphs(before.icons)).toEqual([FOCUS_GLYPH.shield]);
    expect(before.marker?.glyph).toBe("-12");
    const beat = unitFocus("p1", "party", s, -12, true, undefined, 1);
    expect(beat).toEqual({ dim: false, icons: [{ glyph: FOCUS_GLYPH.fear, color: FOCUS_COLOR.party }], marker: { glyph: "+1", color: MARKER_COLOR.fearUp } });
  });

  test("an end-of-round fear session lights its characters with the fear glyph before the impact", () => {
    const s = session({ cause: "fear", affectedIds: ["p1"], fearChangedIds: ["p1"] });
    expect(glyphs(unitFocus("p1", "party", s).icons)).toEqual([FOCUS_GLYPH.fear]);
    expect(unitFocus("p2", "party", s).dim).toBe(true);
  });

  test("a fear drop reads as a green minus, a decimal gain keeps its decimal", () => {
    const s = session({ actorId: "p2", healedIds: ["p1"], fearChangedIds: ["p1"] });
    expect(unitFocus("p1", "party", s, 20, true, undefined, -15).marker).toEqual({ glyph: "-15", color: MARKER_COLOR.fearDown });
    expect(unitFocus("p1", "party", s, 20, true, undefined, 2.1).marker).toEqual({ glyph: "+2.1", color: MARKER_COLOR.fearUp });
  });

  test("fearDeltas shows no change for a character fallen by the session's end", () => {
    const before = [{ id: "p1", hp: 10, maxHp: 10, isAlive: true, fear: 5 }];
    const after = [{ id: "p1", hp: 0, maxHp: 10, isAlive: false, fear: 6 }];
    expect(fearDeltas(before, after).size).toBe(0);
  });

  test("fearDeltas keeps rises and drops, rounded to one decimal", () => {
    const before = [{ id: "p1", hp: 10, maxHp: 10, isAlive: true, fear: 5.1 }, { id: "p2", hp: 10, maxHp: 10, isAlive: true, fear: 30.2 }, { id: "m1", hp: 10, maxHp: 10, isAlive: true }];
    const after = [{ id: "p1", hp: 10, maxHp: 10, isAlive: true, fear: 7.1 }, { id: "p2", hp: 10, maxHp: 10, isAlive: true, fear: 20.2 }, { id: "m1", hp: 4, maxHp: 10, isAlive: true }];
    expect([...fearDeltas(before, after)]).toEqual([["p1", 2], ["p2", -10]]);
  });

  test("no session: nothing is dimmed, no icons", () => {
    expect(unitFocus("a", "party", null)).toEqual({ dim: false, icons: [], marker: null });
  });

  test("the caster of a debuff that every target threw off still wears the sword", () => {
    const s = session({ actorId: "m1", missedIds: ["p1"], affectedIds: ["p1"] });
    expect(glyphs(unitFocus("m1", "monster", s).icons)).toEqual([FOCUS_GLYPH.sword]);
    expect(unitFocus("p1", "party", s).dim).toBe(false);
  });

  test("a bystander is dimmed and has no icons", () => {
    expect(unitFocus("z", "party", session({ actorId: "a", attackedIds: ["m1"] }))).toEqual({ dim: true, icons: [], marker: null });
  });

  test("attacker gets a sword in its own side's colour, target a shield in the target's side colour", () => {
    const s = session({ actorId: "p1", attackedIds: ["m1"] });
    expect(unitFocus("p1", "party", s)).toEqual({ dim: false, icons: [{ glyph: FOCUS_GLYPH.sword, color: FOCUS_COLOR.party }], marker: null });
    expect(unitFocus("m1", "monster", s)).toEqual({ dim: false, icons: [{ glyph: FOCUS_GLYPH.shield, color: FOCUS_COLOR.monster }], marker: null });
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

  test("an actor-less block with no cause lights its units without icons", () => {
    const s = session({ affectedIds: ["m1"] });
    expect(unitFocus("m1", "monster", s)).toEqual({ dim: false, icons: [], marker: null });
    expect(unitFocus("p1", "party", s).dim).toBe(true);
  });

  test("a unit that lost its turn wears the skip glyph in its own side's colour, and is lit", () => {
    const stunned = session({ actorId: "p1", lostTurnIds: ["p1"] });
    expect(unitFocus("p1", "party", stunned)).toEqual({ dim: false, icons: [{ glyph: FOCUS_GLYPH.skip, color: FOCUS_COLOR.party }], marker: null });
    const monster = session({ actorId: "m1", lostTurnIds: ["m1"] });
    expect(unitFocus("m1", "monster", monster).icons).toEqual([{ glyph: FOCUS_GLYPH.skip, color: FOCUS_COLOR.monster }]);
    expect(unitFocus("p2", "party", stunned).dim).toBe(true);
  });

  test("a monster whose turn an Overwatch shot cancelled wears the shield and the skip glyph", () => {
    const shot = session({ actorId: "p1", attackedIds: ["m1"], lostTurnIds: ["m1"] });
    expect(glyphs(unitFocus("m1", "monster", shot).icons)).toEqual([FOCUS_GLYPH.shield, FOCUS_GLYPH.skip]);
    expect(glyphs(unitFocus("p1", "party", shot).icons)).toEqual([FOCUS_GLYPH.sword]);
  });

  test("a unit that lost a buff wears the debuff glyph and is lit, with or without another role", () => {
    const lost = session({ affectedIds: ["p1"], buffLostIds: ["p1"] });
    expect(unitFocus("p1", "party", lost)).toEqual({ dim: false, icons: [{ glyph: FOCUS_GLYPH.debuff, color: FOCUS_COLOR.party }], marker: null });
    expect(unitFocus("p2", "party", lost).dim).toBe(true);
    const onMonster = session({ affectedIds: ["m1"], buffLostIds: ["m1"] });
    expect(unitFocus("m1", "monster", onMonster).icons).toEqual([{ glyph: FOCUS_GLYPH.debuff, color: FOCUS_COLOR.monster }]);
  });

  test("losing a buff alone does not make its bearer an attacker, and a unit already debuffed shows one glyph", () => {
    expect(glyphs(unitFocus("p1", "party", session({ actorId: "p1", buffLostIds: ["p1"] })).icons)).toEqual([FOCUS_GLYPH.debuff]);
    const both = session({ actorId: "p2", debuffedIds: ["m1"], buffLostIds: ["m1"] });
    expect(glyphs(unitFocus("m1", "monster", both).icons)).toEqual([FOCUS_GLYPH.debuff]);
  });

  test("a debuff glyph is not shown for a unit that was also attacked", () => {
    const s = session({ actorId: "p1", attackedIds: ["m1"], debuffedIds: ["m1"] });
    expect(glyphs(unitFocus("m1", "monster", s).icons)).toEqual([FOCUS_GLYPH.shield]);
  });
});

describe("a summon's HP change beside its owner", () => {
  const hit = session({ actorId: "m", attackedIds: ["a"], summonIds: ["a"] });

  test("alone, it reads like the owner's own number", () => {
    expect(unitFocus("a", "party", hit, 0, true, { delta: -12, beat: false }).marker).toEqual({ glyph: "-12", color: MARKER_COLOR.damage.party });
    expect(unitFocus("a", "party", hit, 0, true, { delta: 7, beat: true }).marker).toEqual({ glyph: "+7", color: MARKER_COLOR.heal.party });
  });

  test("with the owner's own change it comes a beat later, led by the summon icon, in place of the owner's number", () => {
    expect(unitFocus("a", "party", hit, -5, true, { delta: -12, beat: false }).marker).toEqual({ glyph: "-5", color: MARKER_COLOR.damage.party });
    expect(unitFocus("a", "party", hit, -5, true, { delta: -12, beat: true }).marker).toEqual({ glyph: `${FOCUS_GLYPH.summon}-12`, color: MARKER_COLOR.damage.party });
  });

  test("nothing shows before the impact, and the owner's number stays when its summon did not change", () => {
    expect(unitFocus("a", "party", hit, -5, false, { delta: -12, beat: true }).marker).toBeNull();
    expect(unitFocus("a", "party", hit, -5, true, { delta: 0, beat: true }).marker).toEqual({ glyph: "-5", color: MARKER_COLOR.damage.party });
  });

  test("a miss still reads as a miss when neither the owner nor its summon lost HP", () => {
    const missed = session({ actorId: "m", attackedIds: ["a"], missedIds: ["a"], summonIds: ["a"] });
    expect(unitFocus("a", "party", missed, 0, true, { delta: 0, beat: true }).marker?.glyph).toBe(t("ui.focusMiss"));
  });
});

describe("the summon icon", () => {
  test("a unit whose summon took part wears a pawn after its role icons, in its own side's colour", () => {
    const focus = unitFocus("a", "party", session({ actorId: "a", attackedIds: ["m"], summonIds: ["a"] }));
    expect(glyphs(focus.icons)).toEqual([FOCUS_GLYPH.sword, FOCUS_GLYPH.summon]);
    expect(focus.icons.at(-1)!.color).toBe(FOCUS_COLOR.party);
    expect(FOCUS_GLYPH.summon).toBe("♙");
  });

  test("a summon that is hit shows the shield and the pawn on its owner", () => {
    expect(glyphs(unitFocus("a", "party", session({ actorId: "m", attackedIds: ["a"], summonIds: ["a"] })).icons)).toEqual([FOCUS_GLYPH.shield, FOCUS_GLYPH.summon]);
  });

  test("without a summon in the session there is no pawn", () => {
    expect(glyphs(unitFocus("a", "party", session({ actorId: "a", attackedIds: ["m"] })).icons)).toEqual([FOCUS_GLYPH.sword]);
  });

  test("a bystander never wears it", () => {
    expect(unitFocus("b", "party", session({ actorId: "a", summonIds: ["a"] })).icons).toEqual([]);
  });
});

describe("outcome markers and cause icons", () => {
  const marker = (id: string, side: "party" | "monster", s: LogSession, delta: number) => unitFocus(id, side, s, delta, true).marker;

  test("no marker before the impact, even when the HP change is known", () => {
    const s = session({ actorId: "m1", attackedIds: ["p1"] });
    expect(unitFocus("p1", "party", s, -12, false).marker).toBeNull();
  });

  test("damage is signed, red on a character and white on a monster", () => {
    const s = session({ actorId: "m1", attackedIds: ["p1"] });
    expect(marker("p1", "party", s, -12)).toEqual({ glyph: "-12", color: MARKER_COLOR.damage.party });
    const hit = session({ actorId: "p1", attackedIds: ["m1"] });
    expect(marker("m1", "monster", hit, -15)).toEqual({ glyph: "-15", color: MARKER_COLOR.damage.monster });
  });

  test("a heal is signed and green: lighter on a character, deeper on a monster", () => {
    expect(marker("p2", "party", session({ actorId: "p1", healedIds: ["p2"] }), 8)).toEqual({ glyph: "+8", color: MARKER_COLOR.heal.party });
    expect(marker("m2", "monster", session({ actorId: "m1", healedIds: ["m2"] }), 8)).toEqual({ glyph: "+8", color: MARKER_COLOR.heal.monster });
    expect(MARKER_COLOR.heal.party).not.toBe(MARKER_COLOR.heal.monster);
  });

  test("a missed target with no HP change reads miss; an untouched unit has no marker", () => {
    const s = session({ actorId: "m1", attackedIds: ["p1"], missedIds: ["p1"] });
    expect(marker("p1", "party", s, 0)).toEqual({ glyph: t("ui.focusMiss"), color: MARKER_COLOR.miss });
    expect(marker("p1", "party", session({ actorId: "m1", attackedIds: ["p1"] }), 0)).toBeNull();
  });

  test("a DoT block: a damage tick wears the DoT glyph, a heal-over-time tick the heal glyph, a unit with both wears both", () => {
    const s = session({ affectedIds: ["m1", "p1", "p2"], tickDamageIds: ["m1", "p2"], healedIds: ["p1", "p2"], cause: "dot" });
    expect(glyphs(unitFocus("m1", "monster", s, -4).icons)).toEqual([FOCUS_GLYPH.dot]);
    expect(glyphs(unitFocus("p1", "party", s, 3).icons)).toEqual([FOCUS_GLYPH.heal]);
    expect(glyphs(unitFocus("p2", "party", s, -2).icons)).toEqual([FOCUS_GLYPH.dot, FOCUS_GLYPH.heal]);
  });

  test("a heal that exactly cancels the damage still shows both glyphs, whatever the net change", () => {
    const s = session({ affectedIds: ["p2"], tickDamageIds: ["p2"], healedIds: ["p2"], cause: "dot" });
    const focus = unitFocus("p2", "party", s, 0);
    expect(glyphs(focus.icons)).toEqual([FOCUS_GLYPH.dot, FOCUS_GLYPH.heal]);
    expect(focus.dim).toBe(false);
  });

  test("Dying marks each character; artifact auto-damage marks the bearer, its target is attacked", () => {
    expect(glyphs(unitFocus("p1", "party", session({ affectedIds: ["p1"], cause: "dying" }), -5).icons)).toEqual([FOCUS_GLYPH.dying]);
    const artifact = session({ affectedIds: ["p1"], attackedIds: ["m1"], cause: "artifact" });
    expect(glyphs(unitFocus("p1", "party", artifact).icons)).toEqual([FOCUS_GLYPH.artifact]);
    expect(glyphs(unitFocus("m1", "monster", artifact, -8).icons)).toEqual([FOCUS_GLYPH.shield]);
  });

  test("only the engine's lifesteal record gives the lifesteal glyph, not any HP gain", () => {
    const drained = session({ actorId: "p1", attackedIds: ["m1"], lifestealIds: ["p1"] });
    expect(glyphs(unitFocus("p1", "party", drained, 6).icons)).toEqual([FOCUS_GLYPH.sword, FOCUS_GLYPH.lifesteal]);
    const healOnKill = session({ actorId: "p1", attackedIds: ["m1"] });
    expect(glyphs(unitFocus("p1", "party", healOnKill, 25).icons)).toEqual([FOCUS_GLYPH.sword]);
    expect(unitFocus("p1", "party", healOnKill, 25, true).marker?.glyph).toBe("+25");
    const selfHeal = session({ actorId: "p1", healedIds: ["p1"] });
    expect(glyphs(unitFocus("p1", "party", selfHeal, 6).icons)).toEqual([FOCUS_GLYPH.support, FOCUS_GLYPH.heal]);
  });

  test("a unit whose HP changed is never greyed", () => {
    const s = session({ actorId: "p1", attackedIds: ["m1"] });
    expect(unitFocus("m2", "monster", s, -3).dim).toBe(false);
  });
});

describe("focusedUnit", () => {
  const unit = { sprite: { rows: ["A"], palette: { A: "#ff0000" } }, label: "VG", labelColor: "#5b7fa6", statusText: "10/10", statusColor: "#5fa85f", frameHeight: MAX_UNIT_HEIGHT };
  test("a lit unit keeps its colours and gains its icons", () => {
    const icons = [{ glyph: FOCUS_GLYPH.sword, color: FOCUS_COLOR.party }];
    expect(focusedUnit(unit, { dim: false, icons, marker: null })).toEqual({ ...unit, icons, marker: null });
  });
  test("a dimmed unit has grey sprite, label and status", () => {
    const dimmed = focusedUnit(unit, { dim: true, icons: [], marker: null });
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
  const area = (sprites: Sprite[], icons: FocusIcon[][], frameHeights = sprites.map(() => unit), markers: (FocusIcon | null)[] = []) =>
    buildSideSpriteArea(
      sprites.map((sprite, i) => ({ sprite, icons: icons[i] ?? [], marker: markers[i] ?? null, frameHeight: frameHeights[i]! })),
      SLOT_WIDTH,
      SLOT_GAP
    ).map(textOf);
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

  test("icons are centred on even and odd sprite widths, a spare column going to their left", () => {
    for (const width of [12, 13, 14]) {
      const sprite = { rows: ["A".repeat(width)], palette: { A: "#ff0000" } };
      const { starts } = spriteSlotLayout([sprite], SLOT_WIDTH, SLOT_GAP);
      for (let n = 1; n <= 3; n++) {
        const lines = area([sprite], [Array.from({ length: n }, () => sword)]);
        const left = lines[iconRow(lines)]!.indexOf(FOCUS_GLYPH.sword) - starts[0]!;
        const right = width - n - left;
        expect([width, n, left - right]).toEqual([width, n, (width - n) % 2]);
      }
    }
  });

  test("the marker follows the icons after a space, and the whole label is centred on the sprite", () => {
    const shield: FocusIcon = { glyph: FOCUS_GLYPH.shield, color: FOCUS_COLOR.party };
    const lines = area([normal], [[shield]], [unit], [{ glyph: "-12", color: MARKER_COLOR.damage.party }]);
    const line = lines[iconRow(lines)]!;
    expect(line.trim()).toBe(`${FOCUS_GLYPH.shield} -12`);
    expect(line.indexOf(FOCUS_GLYPH.shield)).toBe(6 - 2);
  });

  test("a marker with no icon stands alone", () => {
    const lines = area([normal], [[]], [unit], [{ glyph: "-4", color: MARKER_COLOR.damage.monster }]);
    expect(lines[iconRow(lines)]!.trim()).toBe("-4");
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
