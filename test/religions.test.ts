import { describe, test, expect } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { RELIGIONS, getReligion, religionOf, livingReligionCounts, validateReligions } from "../src/data/religions";
import { CLASSES } from "../src/data/classes";
import { showPartySelect } from "../src/ui/partySelect";
import { createCharacter } from "../src/engine/party";
import { Game } from "../src/engine/game";
import { renderMain } from "../src/ui/screens/characterInfo";
import { TEMPLE_SPRITES } from "../src/ui/sprites";

describe("religions", () => {
  test("every class has a known religion", () => {
    for (const cls of CLASSES) expect(getReligion(cls.religionId).id, cls.id).toBe(cls.religionId);
  });

  test("four religions of three classes each", () => {
    expect(RELIGIONS.length).toBe(4);
    for (const religion of RELIGIONS) {
      expect(CLASSES.filter((c) => c.religionId === religion.id).length, religion.id).toBe(3);
    }
  });

  test("religionOf follows the character's class", () => {
    const knight = CLASSES.find((c) => c.id === "knight")!;
    expect(religionOf({ classId: knight.id }).id).toBe(knight.religionId);
  });

  test("living religion counts skip the dead", () => {
    const [first, second] = CLASSES.filter((c) => c.religionId === CLASSES[0]!.religionId);
    const alive = createCharacter("a", "A", first!);
    const dead = createCharacter("b", "B", second!);
    dead.isAlive = false;
    const counts = livingReligionCounts([alive, dead]);
    expect(counts.get(first!.religionId)).toBe(1);
  });

  test("the loader rejects an unknown class reference, a duplicate id and a bad emphasis", () => {
    const ok = { ...RELIGIONS[0]!, id: "a", name: "A", templeDescription: "A room.", style: { abbr: "AA", color: "#ffffff" }, boon: { emphasis: null, recoversHpMp: false } };
    expect(() => validateReligions([ok, { ...ok }], [])).toThrow(/twice/);
    expect(() => validateReligions([{ ...ok, boon: { emphasis: "luck" as never, recoversHpMp: false } }], [])).toThrow(/emphasis/);
    expect(() => validateReligions([ok], [{ id: "k", religionId: "nope" }])).toThrow(/unknown religion/);
    expect(() => validateReligions([{ ...ok, templeDescription: "" }], [])).toThrow(/templeDescription/);
  });

  test("each religion has a temple with its own silhouette", () => {
    const silhouettes = RELIGIONS.map((religion) => {
      const sprite = TEMPLE_SPRITES[religion.templeSpriteId];
      expect(sprite, religion.id).toBeDefined();
      return sprite!.rows.map((row) => row.replace(/[^.]/g, "#")).join("\n");
    });
    expect(new Set(silhouettes).size).toBe(RELIGIONS.length);
  });

  test("the loader rejects a missing or unknown temple sprite", () => {
    for (const templeSpriteId of ["", "missing-temple"]) {
      expect(() => validateReligions([{ ...RELIGIONS[0]!, templeSpriteId }], [])).toThrow(/templeSpriteId/);
    }
  });

  test("party select shows the religion", async () => {
    const harness = await createTestRenderer({ width: 150, height: 45 });
    const picked = showPartySelect(harness.renderer, CLASSES, "slot1");
    void picked;
    await harness.renderOnce();
    for (const cls of CLASSES) {
      expect(harness.captureCharFrame(), cls.id).toContain(getReligion(cls.religionId).name);
      harness.mockInput.pressArrow("right");
      await harness.renderOnce();
    }
    harness.renderer.destroy();
  });

  test("character info shows the religion in its color", () => {
    const game = new Game(7);
    const out = renderMain(game, { kind: "characterInfo", characterIndex: 0, previousUi: { kind: "room" } });
    const religion = religionOf(game.state.party[0]!);
    const chunks = typeof out === "string" ? [] : out.chunks;
    const line = chunks.find((ch) => ch.text.includes(religion.name));
    expect(line).toBeDefined();
    expect(line!.fg).toBeDefined();
  });
});


describe("temple choice narration catalog", () => {
  test("every religion has exactly the three action passages", () => {
    expect(() => validateReligions(RELIGIONS, CLASSES)).not.toThrow();
    for (const religion of RELIGIONS) {
      expect(Object.keys(religion.narration).sort(), religion.id).toEqual(["boon", "giveBlood", "leave"]);
      for (const key of ["giveBlood", "boon", "leave"]) {
        const narration = { ...religion.narration };
        delete narration[key];
        expect(() => validateReligions([{ ...religion, narration }], []), `${religion.id}: ${key}`).toThrow(/narration/);
      }
    }
  });

  test("missing maps, blank or non-text passages, unsupported cases and placeholders fail", () => {
    const religion = RELIGIONS[0]!;
    for (const narration of [undefined, null, [], {}, { ...religion.narration, giveBlood: "  " }, { ...religion.narration, giveBlood: 2 }, { ...religion.narration, invented: "A passage." }]) {
      expect(() => validateReligions([{ ...religion, narration: narration as never }], [])).toThrow(/narration/);
    }
    for (const placeholder of ["character", "artifact", "oldArtifact", "newArtifact", "coins"]) {
      expect(() => validateReligions([{ ...religion, narration: { ...religion.narration, boon: `{{${placeholder}}}` } }], [])).toThrow(/narration/);
    }
  });
});
