import { describe, test, expect } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { showPartySelect } from "../src/ui/partySelect";
import { CLASSES } from "../src/data/classes";
import { ABILITIES } from "../src/data/abilities";
import { BALANCE } from "../src/data/balanceConfig";
import { loadProfile, saveProfile, unlockAbility } from "../src/engine/profile";

async function openScreen() {
  const harness = await createTestRenderer({ width: 120, height: 40 });
  const picked = showPartySelect(harness.renderer, CLASSES);
  await harness.renderOnce();
  const press = async (key: string) => {
    if (key === "LEFT" || key === "RIGHT") harness.mockInput.pressArrow(key === "LEFT" ? "left" : "right");
    else if (key === "ESCAPE") {
      harness.mockInput.pressEscape();
      // A lone Esc reaches the handler only once the parser stops waiting for an escape sequence.
      await new Promise((resolve) => setTimeout(resolve, 50));
    } else harness.mockInput.pressKey(key);
    await harness.renderOnce();
  };
  return { ...harness, picked, press, frame: () => harness.captureCharFrame() };
}

describe("party select", () => {
  test("shows one class at a time with its stats, passive and first two skills", async () => {
    const { frame, press, renderer } = await openScreen();
    const first = CLASSES[0]!;
    expect(frame()).toContain(first.name.toUpperCase());
    expect(frame()).toContain(first.passiveSkill.name);
    for (const slot of [1, 2]) expect(frame()).toContain(first.skills.find((s) => s.slot === slot)!.name);
    expect(frame()).not.toContain(first.skills.find((s) => s.slot === 3)!.name);
    expect(frame()).not.toContain("[Esc] Undo");

    await press("RIGHT");
    expect(frame()).toContain(CLASSES[1]!.name.toUpperCase());
    await press("LEFT");
    await press("LEFT");
    expect(frame()).toContain(CLASSES[CLASSES.length - 1]!.name.toUpperCase());
    renderer.destroy();
  });

  test("every class's page fits at the minimum supported size", async () => {
    const { frame, press, renderer } = await openScreen();
    for (const cls of CLASSES) {
      const shown = frame();
      expect(shown, cls.id).toContain("Choose your party (0/4)");
      expect(shown, cls.id).toContain(cls.skills.find((s) => s.slot === 2)!.name);
      expect(shown, cls.id).toContain("[Enter] Pick");
      await press("RIGHT");
    }
    renderer.destroy();
  });

  test("the class block keeps the same size and place for every class", async () => {
    const { frame, press, renderer } = await openScreen();
    const corners = (shown: string) => {
      const rows = shown.split("\n");
      const top = rows.findIndex((r) => r.includes("┌"));
      const bottom = rows.findIndex((r) => r.includes("└"));
      return { top, bottom, left: rows[top]!.indexOf("┌"), right: rows[top]!.indexOf("┐") };
    };
    const first = corners(frame());
    expect(first.top).toBeGreaterThanOrEqual(0);
    for (const cls of CLASSES) {
      expect(corners(frame()), cls.id).toEqual(first);
      await press("RIGHT");
    }
    renderer.destroy();
  });

  test("the ability block keeps its size on every page, with every ability unlocked", async () => {
    const profile = loadProfile();
    const before = [...profile.unlockedAbilityIds];
    for (const a of ABILITIES) unlockAbility(profile, a.id);
    saveProfile(profile);
    try {
      const { frame, press, renderer } = await openScreen();
      await press("RETURN");
      const corners = (shown: string) => {
        const rows = shown.split("\n");
        const top = rows.findIndex((r) => r.includes("┌"));
        return { top, bottom: rows.findIndex((r) => r.includes("└")), left: rows[top]!.indexOf("┌") };
      };
      const first = corners(frame());
      const seen = new Set<string>();
      let page = 1;
      while (!seen.has(frame())) {
        seen.add(frame());
        expect(corners(frame()), `page ${page}`).toEqual(first);
        expect(frame(), `page ${page}`).toContain("[Esc] Back");
        await press("RIGHT");
        page++;
      }
      for (const a of ABILITIES) expect([...seen].some((shown) => shown.includes(a.name)), a.id).toBe(true);
      renderer.destroy();
    } finally {
      profile.unlockedAbilityIds = before;
      saveProfile(profile);
    }
  });

  test("a pick goes to the ability list, then the class leaves the browse list", async () => {
    const { frame, press, renderer } = await openScreen();
    await press("RETURN");
    expect(frame()).toContain("[0] Skip");
    expect(frame()).toContain("[Esc] Back");
    await press("1");
    expect(frame()).toContain("Choose your party (1/4)");
    expect(frame()).toContain("[Esc] Undo");
    expect(frame()).toContain(`of ${CLASSES.length - 1}`);
    for (let i = 0; i < CLASSES.length; i++) {
      expect(frame()).not.toContain(` ${CLASSES[0]!.name.toUpperCase()}`);
      await press("RIGHT");
    }
    renderer.destroy();
  });

  test("four picks return four different classes, each with a distinct ability or none", async () => {
    const { press, picked } = await openScreen();
    await press("RETURN");
    await press("1");
    await press("RETURN");
    await press("1");
    await press("RIGHT");
    await press("RETURN");
    await press("0");
    await press("RETURN");
    await press("1");
    const party = await picked;
    expect(party.length).toBe(BALANCE.party.size);
    expect(new Set(party.map((p) => p.classId)).size).toBe(party.length);
    const abilities = party.map((p) => p.abilityId).filter((id) => id !== null);
    expect(new Set(abilities).size).toBe(abilities.length);
    expect(party[2]!.abilityId).toBeNull();
    for (const id of abilities) expect(ABILITIES.some((a) => a.id === id)).toBe(true);
  });

  test("Esc backs out of the ability list, and from browsing undoes the last pick", async () => {
    const { press, frame, picked } = await openScreen();
    await press("RETURN");
    await press("ESCAPE");
    expect(frame()).toContain("Choose your party (0/4)");
    expect(frame()).toContain(CLASSES[0]!.name.toUpperCase());

    await press("RETURN");
    await press("1");
    await press("ESCAPE");
    expect(frame()).toContain("Choose your party (0/4)");
    expect(frame()).toContain(CLASSES[0]!.name.toUpperCase());

    for (let i = 0; i < 4; i++) {
      await press("RETURN");
      await press("0");
    }
    const party = await picked;
    expect(party.map((p) => p.classId)).toEqual(CLASSES.slice(0, 4).map((c) => c.id));
  });
});
