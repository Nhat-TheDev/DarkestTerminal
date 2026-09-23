import { describe, test, expect } from "bun:test";
import { formatPassiveEffect } from "../src/ui/screens/characterInfo";
import { CLASSES } from "../src/data/classes";

describe("formatPassiveEffect", () => {
  test("every class's rank-3 passive has a formatter line", () => {
    for (const cls of CLASSES) {
      const rank3 = cls.passiveSkill.ranks.find((r) => r.rank === 3)!;
      expect(formatPassiveEffect(cls.id, cls.passiveSkill, rank3)).not.toBe("");
    }
  });

  test("mechanic text reflects the rank's actual fields, not placeholders", () => {
    const vanguard = CLASSES.find((c) => c.id === "vanguard")!;
    const rank3 = vanguard.passiveSkill.ranks.find((r) => r.rank === 3)!;
    const text = formatPassiveEffect("vanguard", vanguard.passiveSkill, rank3);
    expect(text).toContain(`+${rank3.maxHpPercent}%`);
    expect(text).toContain(`+${rank3.defensePercent}%`);
    expect(text).toContain(`+${rank3.aggroFlat} aggro`);
  });

  test("Viking and Ninja text reflects the passive's own top-level fields, not a hand-typed number", () => {
    const viking = CLASSES.find((c) => c.id === "viking")!;
    const vikingRank1 = viking.passiveSkill.ranks.find((r) => r.rank === 1)!;
    expect(formatPassiveEffect("viking", viking.passiveSkill, vikingRank1)).toContain(`costs ${viking.passiveSkill.selfDamagePercent}%`);

    const ninja = CLASSES.find((c) => c.id === "ninja")!;
    const ninjaRank1 = ninja.passiveSkill.ranks.find((r) => r.rank === 1)!;
    expect(formatPassiveEffect("ninja", ninja.passiveSkill, ninjaRank1)).toContain(`max ${ninja.passiveSkill.maxClones}`);
  });
});
