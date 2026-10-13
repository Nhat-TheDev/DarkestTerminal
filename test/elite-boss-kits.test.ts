import { describe, test, expect } from "bun:test";
import { MONSTER_ARCHETYPES, getMonsterSkill } from "../src/data/monsters";
import type { SkillEffect } from "../src/types";

const GUARDS = MONSTER_ARCHETYPES.filter((a) => a.roles.includes("boss"));
const SUMMON_ALLOWED = new Set(["summonMonster"]);

function mechanicsOf(skillIds: string[]): Set<string> {
  const out = new Set<string>();
  const add = (e: SkillEffect) => {
    if (e.kind === "applyStatusEffect") [e.statusEffectId!, ...(e.alsoApplyStatusEffectIds ?? [])].forEach((id) => out.add(`status:${id}`));
    if (e.kind === "summonMonster") out.add("summonMonster");
    if (e.kind === "modifyStat" && e.stat === "fear") out.add("fear");
    if (e.kind === "removeStatusEffect") out.add("removeStatus");
    if (e.lifestealPercent) out.add("lifesteal");
    if (e.hitCountRange) out.add("multiHit");
    if (e.ignoreDefensePercent) out.add("ignoreDefense");
    if (e.critChance) out.add("crit");
    if (e.scalesWithStatusStacks) out.add("stackScaling");
  };
  for (const id of skillIds) {
    const s = getMonsterSkill(id);
    [...(s.effects ?? []), ...(s.chargeEffects ?? [])].forEach(add);
    if (s.executeBonus) out.add("executeBonus");
  }
  return out;
}

describe("elite/boss kits", () => {
  test("no mechanic appears in more than 2 archetypes (summonMonster allow-listed)", () => {
    const users = new Map<string, string[]>();
    for (const a of GUARDS) for (const m of mechanicsOf(a.skillIds)) users.set(m, [...(users.get(m) ?? []), a.id]);
    const over = [...users].filter(([m, ids]) => ids.length > 2 && !SUMMON_ALLOWED.has(m));
    expect(over).toEqual([]);
  });
  test("every elite skill is in the boss kit, and no telegraph or phase is reachable at elite tier", () => {
    for (const a of GUARDS.filter((g) => g.roles.includes("elite"))) {
      const elite = Object.keys(a.actionWeights!.elite!).filter((k) => k !== "basicAttack");
      const boss = new Set(Object.keys(a.actionWeights!.boss!));
      for (const id of elite) expect(boss.has(id)).toBe(true);
      for (const id of elite) expect(getMonsterSkill(id).telegraph ?? false).toBe(false);
      for (const phase of a.phases ?? []) expect(phase.tier).toBe("boss");
    }
  });
  test("a telegraph aimed by a status tag is aimed only at the tagged", () => {
    for (const [skillId, tag] of [["name-struck-out", "marked"], ["abyssal-judgment", "challenged"]] as const) {
      const skill = getMonsterSkill(skillId);
      expect(skill.aiCondition?.targetHasStatusId).toBe(tag);
      expect(skill.targetRules?.some((r) => r.if.targetLacksStatusId === tag && r.weightMultiplier === 0)).toBe(true);
    }
  });
  test("no two telegraphs share a cadence, and only Orc Chieftain and Void Amalgamation have none", () => {
    const cadences = new Map<string, string>();
    const without: string[] = [];
    for (const a of GUARDS) {
      const telegraphs = a.skillIds.map(getMonsterSkill).filter((s) => s.telegraph);
      if (telegraphs.length === 0) without.push(a.id);
      for (const s of telegraphs) {
        const key = `${s.cooldownTurns}/${s.initialCooldownTurns ?? 0}`;
        expect(cadences.get(key)).toBeUndefined();
        cadences.set(key, a.id);
      }
    }
    expect(without.sort()).toEqual(["orc-chieftain", "void-amalgamation"]);
  });
  test("Orc Chieftain's phase summon always has room under the cap", () => {
    const call = getMonsterSkill("call-the-warband");
    expect(call.aiCondition?.alliesFewerThan).toBe(1);
  });
  test("no old shared-kit skill remains", () => {
    for (const a of GUARDS) for (const id of a.skillIds) expect(id).not.toMatch(/^(elite-strike|elite-cleave|boss-debuff|boss-execute)-/);
  });
  test("kit sizes match the spec", () => {
    const size = (id: string, tier: "elite" | "boss") => {
      const a = MONSTER_ARCHETYPES.find((x) => x.id === id)!;
      const keys = new Set(Object.keys(a.actionWeights![tier]!).filter((k) => k !== "basicAttack"));
      for (const p of a.phases ?? []) {
        if (p.tier !== tier) continue;
        Object.keys(p.weights).filter((k) => k !== "basicAttack").forEach((k) => keys.add(k));
        if (p.onEnterSkillId) keys.add(p.onEnterSkillId);
      }
      return keys.size;
    };
    const expected: Record<string, [number | null, number]> = {
      "skeleton-guard": [2, 4],
      "giant-spider": [2, 5],
      dragon: [2, 5],
      "zombie-knight": [2, 4],
      "dark-knight": [2, 6],
      "orc-chieftain": [2, 5],
      "vampire-lord": [2, 4],
      "void-amalgamation": [2, 4],
      "ancient-golem": [2, 4],
      lich: [2, 5],
      "the-founder": [null, 6],
    };
    for (const [id, [elite, boss]] of Object.entries(expected)) {
      if (elite !== null) expect(size(id, "elite")).toBe(elite);
      expect(size(id, "boss")).toBe(boss);
    }
  });
});
