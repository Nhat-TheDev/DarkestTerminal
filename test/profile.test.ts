import { describe, test, expect } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProfile, addRetiredCharacter, markRetiredCharacterEventShown, profileFilename } from "../src/engine/profile";

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
});
