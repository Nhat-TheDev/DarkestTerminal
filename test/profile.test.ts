import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProfile, addRetiredCharacter, markRetiredCharacterEventShown, profileFilename, corruptProfileFilename } from "../src/engine/profile";

const SLOT = "slot1";

function resetProfile() {
  const path = join(process.env.DARKEST_TERMINAL_SAVE_DIR!, profileFilename(SLOT));
  if (existsSync(path)) rmSync(path);
}

describe("profile.ts — Part F.2's cross-run persistence layer", () => {
  test("loadProfile returns an empty profile when no file exists yet", () => {
    resetProfile();
    const profile = loadProfile(SLOT);
    expect(profile.retiredCharacters).toEqual([]);
    expect(profile.shownRetiredCharacterEvent).toBe(false);
  });

  test("addRetiredCharacter persists across separate loadProfile calls", () => {
    resetProfile();
    addRetiredCharacter(SLOT, "knight");
    expect(loadProfile(SLOT).retiredCharacters).toEqual([{ classId: "knight" }]);
  });

  test("addRetiredCharacter appends, never overwrites — multiple retirements accumulate in order", () => {
    resetProfile();
    addRetiredCharacter(SLOT, "knight");
    addRetiredCharacter(SLOT, "rogue");
    addRetiredCharacter(SLOT, "mage");
    expect(loadProfile(SLOT).retiredCharacters).toEqual([{ classId: "knight" }, { classId: "rogue" }, { classId: "mage" }]);
  });

  test("markRetiredCharacterEventShown persists independently of retiredCharacters", () => {
    resetProfile();
    addRetiredCharacter(SLOT, "viking");
    markRetiredCharacterEventShown(SLOT);
    const profile = loadProfile(SLOT);
    expect(profile.shownRetiredCharacterEvent).toBe(true);
    expect(profile.retiredCharacters).toEqual([{ classId: "viking" }]);
  });

  test("a retired Vanguard from before 1.2.0 loads as a Knight", () => {
    resetProfile();
    const path = join(process.env.DARKEST_TERMINAL_SAVE_DIR!, profileFilename(SLOT));
    writeFileSync(path, JSON.stringify({ version: 1, unlockedAbilityIds: [], retiredCharacters: [{ classId: "vanguard" }, { classId: "mage" }], shownRetiredCharacterEvent: false }));
    expect(loadProfile(SLOT).retiredCharacters).toEqual([{ classId: "knight" }, { classId: "mage" }]);
  });

  test("a corrupt profile file is treated as empty rather than throwing", () => {
    resetProfile();
    const path = join(process.env.DARKEST_TERMINAL_SAVE_DIR!, profileFilename(SLOT));
    writeFileSync(path, "{ not valid json");
    expect(() => loadProfile(SLOT)).not.toThrow();
    expect(loadProfile(SLOT).retiredCharacters).toEqual([]);
  });

  test("a corrupt profile file is set aside, so the next write does not destroy it", () => {
    resetProfile();
    const dir = process.env.DARKEST_TERMINAL_SAVE_DIR!;
    writeFileSync(join(dir, profileFilename(SLOT)), "{ not valid json");
    addRetiredCharacter(SLOT, "knight");
    expect(readFileSync(join(dir, corruptProfileFilename(SLOT)), "utf8")).toBe("{ not valid json");
    expect(loadProfile(SLOT).retiredCharacters).toEqual([{ classId: "knight" }]);
  });

  test("a profile write leaves no temp file behind", () => {
    resetProfile();
    addRetiredCharacter(SLOT, "knight");
    expect(readdirSync(process.env.DARKEST_TERMINAL_SAVE_DIR!).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
