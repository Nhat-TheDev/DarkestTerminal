import { describe, test, expect } from "bun:test";
import { APP_VERSION, ALLOWED_LEGACY_SAVE_VERSIONS, UNVERSIONED, isSaveVersionAllowed } from "../src/engine/save";

describe("Save version blocking", () => {
  test("current app version is always allowed", () => {
    expect(isSaveVersionAllowed(APP_VERSION)).toBe(true);
  });

  test("a version not in the allowlist is blocked", () => {
    expect(isSaveVersionAllowed("0.0.1-not-a-real-version")).toBe(false);
  });

  test("a save with no version field is blocked by default", () => {
    expect(ALLOWED_LEGACY_SAVE_VERSIONS.includes(UNVERSIONED)).toBe(false);
    expect(isSaveVersionAllowed(undefined)).toBe(false);
  });

  test("a version explicitly added to the allowlist is allowed", () => {
    const original = [...ALLOWED_LEGACY_SAVE_VERSIONS];
    expect(isSaveVersionAllowed("0.1.1")).toBe(false);
    ALLOWED_LEGACY_SAVE_VERSIONS.push("0.1.1");
    try {
      expect(isSaveVersionAllowed("0.1.1")).toBe(true);
    } finally {
      ALLOWED_LEGACY_SAVE_VERSIONS.length = 0;
      ALLOWED_LEGACY_SAVE_VERSIONS.push(...original);
    }
  });
});
