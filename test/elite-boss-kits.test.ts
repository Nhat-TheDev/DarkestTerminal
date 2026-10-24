import { describe, test, expect } from "bun:test";
import { MONSTER_ARCHETYPES, getArchetype, getBossTelegraph, getMonsterSkill } from "../src/data/monsters";
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
    const byArchetype = { lich: "marked", "dark-knight": "challenged" } as const;
    for (const [archetypeId, tag] of Object.entries(byArchetype)) {
      const skill = getMonsterSkill(getBossTelegraph(getArchetype(archetypeId))!.skillId);
      expect(skill.aiCondition?.targetHasStatusId).toBe(tag);
      expect(skill.targetRules?.some((r) => r.if.targetLacksStatusId === tag && r.weightMultiplier === 0)).toBe(true);
    }
  });
  test("every boss-tier telegraph is driven by bossTelegraph and by no action weight", () => {
    const without: string[] = [];
    for (const a of GUARDS) {
      const telegraphs = a.skillIds.filter((id) => getMonsterSkill(id).telegraph);
      if (!a.bossTelegraph) {
        without.push(a.id);
        expect(telegraphs).toEqual([]);
        continue;
      }
      const own = [a.bossTelegraph.skillId, ...(a.bars ?? []).flatMap((b) => (b.bossTelegraph ? [b.bossTelegraph.skillId] : []))];
      expect(telegraphs.sort()).toEqual(own.sort());
      const weightKeys = [...Object.values(a.actionWeights ?? {}), ...(a.phases ?? []).map((p) => p.weights), ...(a.bars ?? []).flatMap((b) => (b.weights ? [b.weights] : []))].flatMap((w) => Object.keys(w));
      for (const id of own) expect(weightKeys).not.toContain(id);
    }
    expect(without.sort()).toEqual(["orc-chieftain", "void-amalgamation"]);
  });
  test("meter lengths are 3 to 5 and differ within a band", () => {
    const bands = [
      ["skeleton-guard", "giant-spider"],
      ["zombie-knight", "orc-chieftain", "vampire-lord"],
      ["dark-knight", "void-amalgamation", "lich"],
      ["ancient-golem", "dragon"],
      ["the-founder"],
    ];
    const length = (id: string) => getBossTelegraph(getArchetype(id))?.meterLength;
    for (const band of bands) {
      const lengths = band.map(length).filter((n) => n !== undefined);
      expect(new Set(lengths).size).toBe(lengths.length);
    }
    const lengths = Object.fromEntries(GUARDS.filter((a) => a.bossTelegraph).map((a) => [a.id, a.bossTelegraph!.meterLength]));
    for (const n of Object.values(lengths)) expect(Number.isInteger(n) && n >= 3 && n <= 5).toBe(true);
    expect(lengths).toEqual({
      "skeleton-guard": 5,
      "giant-spider": 4,
      "zombie-knight": 5,
      "vampire-lord": 4,
      "dark-knight": 3,
      lich: 5,
      "ancient-golem": 5,
      dragon: 4,
      "the-founder": 4,
    });
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
      for (const b of a.bars ?? []) {
        if (tier !== "boss") break;
        Object.keys(b.weights ?? {}).filter((k) => k !== "basicAttack").forEach((k) => keys.add(k));
        if (b.onEnterSkillId) keys.add(b.onEnterSkillId);
        if (b.bossTelegraph) keys.add(b.bossTelegraph.skillId);
      }
      if (tier === "boss" && a.bossTelegraph) keys.add(a.bossTelegraph.skillId);
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
      "the-founder": [null, 8],
    };
    for (const [id, [elite, boss]] of Object.entries(expected)) {
      if (elite !== null) expect(size(id, "elite")).toBe(elite);
      expect(size(id, "boss")).toBe(boss);
    }
  });
});
