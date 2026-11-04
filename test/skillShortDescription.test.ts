import { describe, test, expect } from "bun:test";
import { CLASSES, SKILLS_PER_CLASS, getEffectiveSkill } from "../src/data/classes";
import { MIN_TERMINAL_WIDTH, PARTY_PANEL_WIDTH, SIDE_PANEL_WIDTH } from "../src/ui/layout";
import { skillMenuHead } from "../src/ui/screens/combat";

/** Columns inside the Dungeon panel at the smallest supported terminal: past them a menu row wraps and pushes the last option towards the panel's edge. */
const MENU_WIDTH = MIN_TERMINAL_WIDTH - PARTY_PANEL_WIDTH - SIDE_PANEL_WIDTH - 2;

describe("skill menu rows", () => {
  test("every skill's row fits one line at the smallest terminal, at its dearest rank", () => {
    for (const cls of CLASSES) {
      for (const skill of cls.skills) {
        const levels = skill.ranks?.map((r) => r.unlockLevel) ?? [1];
        const heads = levels.map((level) => skillMenuHead(SKILLS_PER_CLASS, getEffectiveSkill(skill, level)));
        const longestHead = Math.max(...heads.map((head) => head.length));
        const text = skill.shortDescription ?? skill.description;
        const budget = MENU_WIDTH - longestHead - " — ".length;
        expect(text.length, `${skill.id}: "${text}" has ${text.length} characters, its menu row leaves ${budget}`).toBeLessThanOrEqual(budget);
      }
    }
  });
});
