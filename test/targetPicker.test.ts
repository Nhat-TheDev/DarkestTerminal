import { describe, test, expect } from "bun:test";
import type { TextChunk } from "@opentui/core";
import type { CombatantRef, SkillEffect } from "../src/types";
import type { Actor } from "../src/engine/resolver";
import { getSkill } from "../src/data/classes";
import { getItem } from "../src/data/items";
import { PALETTE, colorChunk, fearColorFor } from "../src/ui/theme";
import { getFearTier } from "../src/engine/resolver";
import { allyTargetInfo, mostHurtIndex, targetChoiceLines, type AllyTargetInfo, type TargetCandidate } from "../src/ui/targetPicker";

const text = (line: TextChunk[]) => line.map((c) => c.text).join("");
const colorOf = (line: TextChunk[], fragment: string) => line.find((c) => c.text.includes(fragment))?.fg;
const fgOf = (color: string) => colorChunk("x", color).fg;

function ally(name: string, hp: number, maxHp: number, stats: Record<string, unknown> = {}): TargetCandidate {
  return { ref: { kind: "character", id: name } as CombatantRef, actor: { name, hp, maxHp, attack: 10, defense: 5, speed: 7, magicPower: 3, aggro: 1, ...stats } as unknown as Actor };
}
function hero(name: string, hp: number, maxHp: number, mp: number, maxMp: number, fear: number, stats: Record<string, unknown> = {}): TargetCandidate {
  return ally(name, hp, maxHp, { classId: "test", mp, maxMp, survival: { fear }, ...stats });
}
function enemy(name: string, hp: number, maxHp: number): TargetCandidate {
  return { ref: { kind: "monster", id: name } as CombatantRef, actor: { name, hp, maxHp } as unknown as Actor };
}

const heal = getSkill("heal").effects as SkillEffect[];
const slash = getSkill("slash").effects as SkillEffect[];
const whetstone = getItem("whetstone").effects;
const info = (over: Partial<AllyTargetInfo>): AllyTargetInfo => ({ hp: false, mp: false, fear: false, stats: [], ...over });

describe("effects with a target of their own", () => {
  test("a rider resolved on the caster does not turn an attack into a buff list or hide the enemy flag", () => {
    const withRider: SkillEffect[] = [...slash, { kind: "modifyCombatStat", combatStat: "attack", amount: 5, target: "self" }];
    expect(allyTargetInfo(withRider)).toEqual(info({}));
    const rows = targetChoiceLines([enemy("Goblin", 10, 100), enemy("Rat", 90, 100)], withRider, false);
    expect(rows.map(text)).toEqual(["  [1] Goblin (10/100 HP) *", "  [2] Rat (90/100 HP)"]);
  });
});

describe("what a target list shows", () => {
  test("a heal, a healing item and a heal-over-time status all read as healing", () => {
    expect(allyTargetInfo(getItem("bandage-roll").effects)).toEqual(info({ hp: true }));
    expect(allyTargetInfo(getSkill("healing-draught").effects as SkillEffect[])).toEqual(info({ hp: true }));
  });

  test("a stat buff reads as the stats it raises", () => {
    expect(allyTargetInfo(whetstone)).toEqual(info({ stats: ["attack"] }));
    expect(allyTargetInfo(getItem("temporary-ward").effects)).toEqual(info({ stats: ["defense"] }));
  });

  test("restoring MP, moving fear and resisting fear read as MP and fear", () => {
    expect(allyTargetInfo(getItem("small-mana-potion").effects)).toEqual(info({ mp: true }));
    expect(allyTargetInfo(getItem("calming-draught").effects)).toEqual(info({ fear: true }));
    expect(allyTargetInfo(heal)).toEqual(info({ hp: true, fear: true }));
  });

  test("an effect that touches two kinds of figure reads as both", () => {
    expect(allyTargetInfo(getSkill("prayer").effects as SkillEffect[])).toEqual(info({ fear: true, stats: ["defense"] }));
    expect(allyTargetInfo(getSkill("blood-pact").effects as SkillEffect[])).toEqual(info({ mp: true, stats: ["magicPower"] }));
  });

  test("a cure, a debuff and an attack show plain HP", () => {
    expect(allyTargetInfo(getItem("antidote").effects)).toEqual(info({}));
    expect(allyTargetInfo(getItem("repelling-smoke-powder").effects)).toEqual(info({}));
    expect(allyTargetInfo(slash)).toEqual(info({}));
  });

  test("an effect that only applies to enemies does not make an ally's row a buff row", () => {
    expect(allyTargetInfo([{ kind: "modifyCombatStat", combatStat: "attack", amount: 5, appliesToRelation: "enemy" }])).toEqual(info({}));
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
    const rows = targetChoiceLines([ally("Knight", 174, 185), ally("Mage", 60, 100), ally("Acolyte", 31, 124)], heal, false);
    expect(rows.map(text)).toEqual(["  [1] Knight (174/185 HP)", "  [2] Mage (60/100 HP)", "  [3] Acolyte (31/124 HP) *"]);
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
    const rows = targetChoiceLines([ally("Knight", 100, 100), ally("Mage", 50, 100)], heal, false);
    expect(rows.map(text).join("\n")).not.toContain("*");
  });

  test("a stat buff shows the raised stat instead of HP, and flags nobody", () => {
    const rows = targetChoiceLines([ally("Knight", 10, 185, { attack: 32 }), ally("Mage", 98, 98, { attack: 12 })], whetstone, false);
    expect(rows.map(text)).toEqual(["  [1] Knight (ATK 32)", "  [2] Mage (ATK 12)"]);
  });

  test("MP and fear show the character's current figures, coloured", () => {
    const mage = hero("Mage", 98, 98, 12, 40, 45.7);
    expect(text(targetChoiceLines([mage], getItem("small-mana-potion").effects, false)[0]!)).toBe("  [1] Mage (12/40 MP)");
    const calmed = targetChoiceLines([mage], getItem("calming-draught").effects, false)[0]!;
    expect(text(calmed)).toBe("  [1] Mage (Fear 45)");
    expect(colorOf(targetChoiceLines([mage], getItem("small-mana-potion").effects, false)[0]!, "12/40")).toEqual(fgOf(PALETTE.mp));
    expect(colorOf(calmed, "Fear 45")).toEqual(fgOf(fearColorFor(getFearTier(45.7))));
  });

  test("a skill that touches two kinds of figure shows both, HP then MP then fear then stats", () => {
    const knight = hero("Knight", 30, 130, 10, 30, 52, { defense: 11, magicPower: 3 });
    expect(text(targetChoiceLines([knight], getSkill("prayer").effects as SkillEffect[], false)[0]!)).toBe("  [1] Knight (Fear 52, DEF 11)");
    expect(text(targetChoiceLines([knight], getSkill("blood-pact").effects as SkillEffect[], false)[0]!)).toBe("  [1] Knight (10/30 MP, MAG 3)");
    expect(text(targetChoiceLines([knight], heal, false)[0]!)).toBe("  [1] Knight (30/130 HP, Fear 52) *");
  });

  test("an ally without MP or fear falls back to HP", () => {
    expect(text(targetChoiceLines([ally("Spirit", 20, 40)], getItem("small-mana-potion").effects, false)[0]!)).toBe("  [1] Spirit (20/40 HP)");
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
