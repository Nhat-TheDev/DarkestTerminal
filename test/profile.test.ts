import { describe, test, expect } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProfile, addRetiredCharacter, markRetiredCharacterEventShown, PROFILE_FILENAME } from "../src/engine/profile";

function resetProfile() {
  const path = join(process.env.DARKEST_TERMINAL_SAVE_DIR!, PROFILE_FILENAME);
  if (existsSync(path)) rmSync(path);
}

describe("profile.ts — Part F.2's cross-run persistence layer", () => {
  test("loadProfile returns an empty profile when no file exists yet", () => {
    resetProfile();
    const profile = loadProfile();
    expect(profile.retiredCharacters).toEqual([]);
    expect(profile.shownRetiredCharacterEvent).toBe(false);
  });

  test("addRetiredCharacter persists across separate loadProfile calls", () => {
    resetProfile();
    addRetiredCharacter("vanguard");
    expect(loadProfile().retiredCharacters).toEqual([{ classId: "vanguard" }]);
  });

  test("addRetiredCharacter appends, never overwrites — multiple retirements accumulate in order", () => {
    resetProfile();
    addRetiredCharacter("vanguard");
    addRetiredCharacter("rogue");
    addRetiredCharacter("mage");
    expect(loadProfile().retiredCharacters).toEqual([{ classId: "vanguard" }, { classId: "rogue" }, { classId: "mage" }]);
  });

  test("markRetiredCharacterEventShown persists independently of retiredCharacters", () => {
    resetProfile();
    addRetiredCharacter("viking");
    markRetiredCharacterEventShown();
    const profile = loadProfile();
    expect(profile.shownRetiredCharacterEvent).toBe(true);
    expect(profile.retiredCharacters).toEqual([{ classId: "viking" }]);
  });

  test("a corrupt profile file is treated as empty rather than throwing", () => {
    resetProfile();
    const path = join(process.env.DARKEST_TERMINAL_SAVE_DIR!, PROFILE_FILENAME);
    writeFileSync(path, "{ not valid json");
    expect(() => loadProfile()).not.toThrow();
    expect(loadProfile().retiredCharacters).toEqual([]);
  });
});
