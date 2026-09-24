import { describe, test, expect } from "bun:test";
import { formatPassiveEffect } from "../src/ui/screens/characterInfo";
import { CLASSES } from "../src/data/classes";

describe("formatPassiveEffect", () => {
  test("every class's rank-3 passive has a formatter line", () => {
    for (const cls of CLASSES) {
      const rank3 = cls.passiveSkill.ranks.find((r) => r.rank === 3)!;
      expect(formatPassiveEffect(cls.passiveSkill, rank3)).not.toBe("");
    }
  });

  test("mechanic text reflects the rank's actual fields, not placeholders", () => {
    const vanguard = CLASSES.find((c) => c.id === "vanguard")!;
    const rank3 = vanguard.passiveSkill.ranks.find((r) => r.rank === 3)!;
    const text = formatPassiveEffect(vanguard.passiveSkill, rank3);
    expect(text).toContain(`+${rank3.maxHpPercent}%`);
    expect(text).toContain(`+${rank3.defensePercent}%`);
    expect(text).toContain(`+${rank3.aggroFlat} aggro`);
  });

  test("Viking and Ninja text reflects the passive's own top-level fields, not a hand-typed number", () => {
    const viking = CLASSES.find((c) => c.id === "viking")!;
    const vikingRank1 = viking.passiveSkill.ranks.find((r) => r.rank === 1)!;
    expect(formatPassiveEffect(viking.passiveSkill, vikingRank1)).toContain(`costs ${viking.passiveSkill.selfDamagePerHitMaxHPPercent}%`);

    const ninja = CLASSES.find((c) => c.id === "ninja")!;
    const ninjaRank1 = ninja.passiveSkill.ranks.find((r) => r.rank === 1)!;
    expect(formatPassiveEffect(ninja.passiveSkill, ninjaRank1)).toContain(`max ${ninja.passiveSkill.maxClones}`);
  });

  test("only fires the template for fields the rank actually has, not every class's template", () => {
    const rogue = CLASSES.find((c) => c.id === "rogue")!;
    const rank1 = rogue.passiveSkill.ranks.find((r) => r.rank === 1)!;
    const text = formatPassiveEffect(rogue.passiveSkill, rank1);
    expect(text).toContain("poisoned target");
    expect(text).not.toContain("max HP");
    expect(text).not.toContain("dodge chance");
  });
});
