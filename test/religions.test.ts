import { describe, test, expect } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { RELIGIONS, getReligion, religionOf, livingReligionCounts, validateReligions } from "../src/data/religions";
import { CLASSES } from "../src/data/classes";
import { showPartySelect } from "../src/ui/partySelect";
import { createCharacter } from "../src/engine/party";
import { Game } from "../src/engine/game";
import { renderMain } from "../src/ui/screens/characterInfo";

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
    const ok = { id: "a", name: "A", templeDescription: "A room.", style: { abbr: "AA", color: "#ffffff" }, boon: { emphasis: null, recoversHpMp: false } };
    expect(() => validateReligions([ok, { ...ok }], [])).toThrow(/twice/);
    expect(() => validateReligions([{ ...ok, boon: { emphasis: "luck" as never, recoversHpMp: false } }], [])).toThrow(/emphasis/);
    expect(() => validateReligions([ok], [{ id: "k", religionId: "nope" }])).toThrow(/unknown religion/);
    expect(() => validateReligions([{ ...ok, templeDescription: "" }], [])).toThrow(/templeDescription/);
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
