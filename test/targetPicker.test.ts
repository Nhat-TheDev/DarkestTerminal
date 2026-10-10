import { describe, test, expect } from "bun:test";
import type { TextChunk } from "@opentui/core";
import type { CombatantRef, SkillEffect } from "../src/types";
import type { Actor } from "../src/engine/resolver";
import { getSkill } from "../src/data/classes";
import { getItem } from "../src/data/items";
import { PALETTE, colorChunk } from "../src/ui/theme";
import { allyTargetInfo, mostHurtIndex, targetChoiceLines, type TargetCandidate } from "../src/ui/targetPicker";

const text = (line: TextChunk[]) => line.map((c) => c.text).join("");
const colorOf = (line: TextChunk[], fragment: string) => line.find((c) => c.text.includes(fragment))?.fg;
const fgOf = (color: string) => colorChunk("x", color).fg;

function ally(name: string, hp: number, maxHp: number, stats: Record<string, number> = {}): TargetCandidate {
  return { ref: { kind: "character", id: name } as CombatantRef, actor: { name, hp, maxHp, attack: 10, defense: 5, speed: 7, magicPower: 3, aggro: 1, ...stats } as unknown as Actor };
}
function enemy(name: string, hp: number, maxHp: number): TargetCandidate {
  return { ref: { kind: "monster", id: name } as CombatantRef, actor: { name, hp, maxHp } as unknown as Actor };
}

const heal = getSkill("heal").effects as SkillEffect[];
const slash = getSkill("slash").effects as SkillEffect[];
const whetstone = getItem("whetstone").effects;

describe("effects with a target of their own", () => {
  test("a rider resolved on the caster does not turn an attack into a buff list or hide the enemy flag", () => {
    const withRider: SkillEffect[] = [...slash, { kind: "modifyCombatStat", combatStat: "attack", amount: 5, target: "self" }];
    expect(allyTargetInfo(withRider)).toEqual({ kind: "plain" });
    const rows = targetChoiceLines([enemy("Goblin", 10, 100), enemy("Rat", 90, 100)], withRider, false);
    expect(rows.map(text)).toEqual(["  [1] Goblin (10/100 HP) *", "  [2] Rat (90/100 HP)"]);
  });
});

describe("what a target list shows", () => {
  test("a heal, a healing item and a heal-over-time status all read as healing", () => {
    expect(allyTargetInfo(heal)).toEqual({ kind: "heal" });
    expect(allyTargetInfo(getItem("bandage-roll").effects)).toEqual({ kind: "heal" });
    expect(allyTargetInfo(getSkill("healing-draught").effects as SkillEffect[])).toEqual({ kind: "heal" });
  });

  test("a stat buff reads as the stats it raises", () => {
    expect(allyTargetInfo(whetstone)).toEqual({ kind: "stats", stats: ["attack"] });
    expect(allyTargetInfo(getItem("temporary-ward").effects)).toEqual({ kind: "stats", stats: ["defense"] });
    expect(allyTargetInfo(getSkill("prayer").effects as SkillEffect[])).toEqual({ kind: "stats", stats: ["defense"] });
  });

  test("a cure, a debuff and an attack show plain HP", () => {
    expect(allyTargetInfo(getItem("antidote").effects)).toEqual({ kind: "plain" });
    expect(allyTargetInfo(getItem("repelling-smoke-powder").effects)).toEqual({ kind: "plain" });
    expect(allyTargetInfo(slash)).toEqual({ kind: "plain" });
  });

  test("an effect that only applies to enemies does not make an ally's row a buff row", () => {
    expect(allyTargetInfo([{ kind: "modifyCombatStat", combatStat: "attack", amount: 5, appliesToRelation: "enemy" }])).toEqual({ kind: "plain" });
  });
});

describe("which target is flagged as most hurt", () => {
  test("the lowest share of max HP, and only under half", () => {
    expect(mostHurtIndex([{ hp: 90, maxHp: 100 }, { hp: 40, maxHp: 100 }, { hp: 15, maxHp: 50 }])).toBe(2);
    expect(mostHurtIndex([{ hp: 90, maxHp: 100 }, { hp: 50, maxHp: 100 }])).toBe(-1);
    expect(mostHurtIndex([{ hp: 49, maxHp: 100 }])).toBe(0);
  });

  test("the first of equally hurt targets", () => {
    expect(mostHurtIndex([{ hp: 10, maxHp: 100 }, { hp: 10, maxHp: 100 }])).toBe(0);
  });

  test("a minimum number of units can be required", () => {
    expect(mostHurtIndex([{ hp: 10, maxHp: 100 }], 2)).toBe(-1);
  });
});

describe("the rows of a target list", () => {
  test("a heal colours each HP figure by its share and flags the most hurt ally", () => {
    const rows = targetChoiceLines([ally("Vanguard", 174, 185), ally("Mage", 60, 100), ally("Acolyte", 31, 124)], heal, false);
    expect(rows.map(text)).toEqual(["  [1] Vanguard (174/185 HP)", "  [2] Mage (60/100 HP)", "  [3] Acolyte (31/124 HP) *"]);
    expect(colorOf(rows[0]!, "174/185")).toEqual(fgOf(PALETTE.hpHigh));
    expect(colorOf(rows[1]!, "60/100")).toEqual(fgOf(PALETTE.hpMid));
    expect(colorOf(rows[2]!, "31/124")).toEqual(fgOf(PALETTE.hpLow));
  });

  test("names stay uncoloured", () => {
    const rows = targetChoiceLines([ally("Acolyte", 31, 124)], heal, false);
    expect(rows[0]![0]!.text).toBe("  [1] Acolyte");
    expect(colorOf(rows[0]!, "Acolyte")).not.toEqual(fgOf(PALETTE.hpLow));
  });

  test("no ally is flagged while everyone is at half HP or better", () => {
    const rows = targetChoiceLines([ally("Vanguard", 100, 100), ally("Mage", 50, 100)], heal, false);
    expect(rows.map(text).join("\n")).not.toContain("*");
  });

  test("a stat buff shows the raised stat instead of HP, and flags nobody", () => {
    const rows = targetChoiceLines([ally("Vanguard", 10, 185, { attack: 32 }), ally("Mage", 98, 98, { attack: 12 })], whetstone, false);
    expect(rows.map(text)).toEqual(["  [1] Vanguard (ATK 32)", "  [2] Mage (ATK 12)"]);
  });

  test("an attack colours enemy HP and flags the most hurt enemy when there are two or more", () => {
    const rows = targetChoiceLines([enemy("Goblin", 20, 55), enemy("Skeleton", 90, 90), enemy("Lizard", 30, 40)], slash, false);
    expect(rows.map(text)).toEqual(["  [1] Goblin (20/55 HP) *", "  [2] Skeleton (90/90 HP)", "  [3] Lizard (30/40 HP)"]);
    expect(colorOf(rows[1]!, "90/90")).toEqual(fgOf(PALETTE.hpHigh));
  });

  test("a lone enemy is never flagged", () => {
    const rows = targetChoiceLines([enemy("Goblin", 5, 55)], slash, false);
    expect(text(rows[0]!)).toBe("  [1] Goblin (5/55 HP)");
  });

  test("an attack never flags an ally, and a heal or a stat buff never flags an enemy", () => {
    const mixed = [ally("Mage", 10, 100), enemy("Goblin", 10, 100), enemy("Rat", 90, 100)];
    expect(targetChoiceLines(mixed, heal, false).map(text)).toEqual(["  [1] Mage (10/100 HP) *", "  [2] Goblin (10/100 HP)", "  [3] Rat (90/100 HP)"]);
    expect(targetChoiceLines(mixed, whetstone, false).map(text)).toEqual(["  [1] Mage (ATK 10)", "  [2] Goblin (10/100 HP)", "  [3] Rat (90/100 HP)"]);
    expect(targetChoiceLines(mixed, slash, false).map(text)).toEqual(["  [1] Mage (10/100 HP)", "  [2] Goblin (10/100 HP) *", "  [3] Rat (90/100 HP)"]);
  });

  test("a skill that cures an ally and smites an enemy flags only the most hurt enemy", () => {
    const mixed = [ally("Mage", 10, 100), enemy("Goblin", 10, 100), enemy("Rat", 90, 100)];
    expect(targetChoiceLines(mixed, getSkill("purify").effects as SkillEffect[], true).map(text)).toEqual([
      "  [1] [Ally] Mage (10/100 HP)",
      "  [2] [Enemy] Goblin (10/100 HP) *",
      "  [3] [Enemy] Rat (90/100 HP)",
    ]);
  });

  test("a cure shows coloured HP without a flag", () => {
    const rows = targetChoiceLines([ally("Mage", 10, 100)], getItem("antidote").effects, false);
    expect(text(rows[0]!)).toBe("  [1] Mage (10/100 HP)");
    expect(colorOf(rows[0]!, "10/100")).toEqual(fgOf(PALETTE.hpLow));
  });

  test("a list that mixes both sides keeps the side prefix", () => {
    const rows = targetChoiceLines([ally("Mage", 98, 98), enemy("Goblin", 55, 55)], getSkill("purify").effects as SkillEffect[], true);
    expect(rows.map(text)).toEqual(["  [1] [Ally] Mage (98/98 HP)", "  [2] [Enemy] Goblin (55/55 HP)"]);
  });
});
