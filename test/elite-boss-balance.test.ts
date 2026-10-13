import { describe, test, expect } from "bun:test";
import { CLASSES } from "../src/data/classes";
import { MONSTER_ARCHETYPES, getMonsterSkill, spawnMonster } from "../src/data/monsters";
import { statsForLevel } from "../src/engine/party";
import { previewSkillDamage, monsterBalancePoints } from "../tools/game-editor/calc";
import type { MonsterTier, SkillDefinition } from "../src/types";
import { firstDepth, levelAt, mean, simulateRows, type Row } from "./balanceSim";

// The targets live here, not in the docs. Each band rises over the one before it in average damage taken
// per round (as a share of the party's total max HP) and in rounds the party needs to win; `telegraphCap`
// caps one telegraph hit as a share of the lowest-HP class's max HP. The ranges are wide inside a band
// because its members are different monsters (a glass cannon dies sooner than a wall); what the tests below
// pin is the order between bands and between tiers.
//
// The party is the harness's: class stats at the average level for the depth, no artifacts or abilities,
// restored to full between rounds. The deepest archetypes are marathons in it: monster defense and HP
// outgrow a level-capped party (06-level-system.md, 6.10), which is why their rounds are far above the rest.
const BANDS = [
  { ids: ["skeleton-guard", "giant-spider"], dpr: { elite: [2, 4], boss: [0.8, 3.2] }, rounds: { elite: [2.5, 4.8], boss: [2.5, 5.8] }, telegraphCap: 0.45 },
  { ids: ["zombie-knight", "orc-chieftain", "vampire-lord"], dpr: { elite: [2, 4], boss: [2.5, 4.5] }, rounds: { elite: [5, 8.5], boss: [7, 11] }, telegraphCap: 0.55 },
  { ids: ["dark-knight", "void-amalgamation", "lich"], dpr: { elite: [1.5, 5.5], boss: [1.5, 5.5] }, rounds: { elite: [5, 13.5], boss: [6, 18] }, telegraphCap: 0.65 },
  { ids: ["ancient-golem", "dragon"], dpr: { elite: [3, 5.5], boss: [4.5, 7.5] }, rounds: { elite: [8, 33], boss: [18, 45] }, telegraphCap: 0.75 },
  { ids: ["the-founder"], dpr: { boss: [5, 8] }, rounds: { boss: [24, 40] }, telegraphCap: 0.8 },
] as const;

const CASES = BANDS.flatMap((band) =>
  band.ids.flatMap((id) => (Object.keys(band.dpr) as MonsterTier[]).map((tier) => [id, tier] as const))
);

let cached: Row[] | undefined;
function allRows(): Row[] {
  if (cached) return cached;
  cached = simulateRows(CASES);
  if (process.env.BALANCE_REPORT) {
    console.table(cached.map((r) => ({ ...r, dpr: Number(r.dpr.toFixed(1)), rounds: Number(r.rounds.toFixed(1)), winRate: Number(r.winRate.toFixed(2)) })));
  }
  return cached;
}

describe("elite/boss difficulty curve", () => {
  test("every archetype and tier sits inside its band's damage and rounds ranges", () => {
    for (const band of BANDS) {
      for (const row of allRows().filter((r) => (band.ids as readonly string[]).includes(r.id))) {
        const dpr = (band.dpr as Record<string, readonly number[]>)[row.tier]!;
        const rounds = (band.rounds as Record<string, readonly number[]>)[row.tier]!;
        expect(row.dpr, `${row.id} ${row.tier} damage share`).toBeGreaterThanOrEqual(dpr[0]!);
        expect(row.dpr, `${row.id} ${row.tier} damage share`).toBeLessThanOrEqual(dpr[1]!);
        expect(row.rounds, `${row.id} ${row.tier} rounds`).toBeGreaterThanOrEqual(rounds[0]!);
        expect(row.rounds, `${row.id} ${row.tier} rounds`).toBeLessThanOrEqual(rounds[1]!);
      }
    }
  });

  test("band means rise from band to band, for damage and for rounds", () => {
    for (const metric of ["dpr", "rounds"] as const) {
      const means = BANDS.map((band) => mean(allRows().filter((r) => (band.ids as readonly string[]).includes(r.id)).map((r) => r[metric])));
      for (let i = 1; i < means.length; i++) expect(means[i], `${metric}: band ${i + 1} over band ${i}`).toBeGreaterThan(means[i - 1]!);
    }
  });

  test("boss tier sits above elite tier inside every band", () => {
    for (const band of BANDS) {
      for (const id of band.ids) {
        const idRows = allRows().filter((r) => r.id === id);
        const elite = idRows.find((r) => r.tier === "elite");
        const boss = idRows.find((r) => r.tier === "boss")!;
        if (elite) expect(boss.rounds, `${id} rounds`).toBeGreaterThan(elite.rounds);
      }
    }
  });

  test("no skill reaches the lowest-HP class's max HP, and a telegraph stays under its band's cap", () => {
    for (const band of BANDS) {
      for (const id of band.ids) {
        const archetype = MONSTER_ARCHETYPES.find((a) => a.id === id)!;
        const depth = firstDepth(id, "boss");
        const level = levelAt(depth);
        const stats = CLASSES.map((c) => statsForLevel(c, level));
        const minHp = Math.min(...stats.map((s) => s.maxHp));
        const minDefense = Math.min(...stats.map((s) => s.defense));
        const boss = spawnMonster(id, depth, { tier: "boss" });
        for (const skillId of archetype.skillIds) {
          const skill: SkillDefinition = getMonsterSkill(skillId);
          if (!(skill.effects ?? []).some((e) => e.kind === "damage")) continue;
          const preview = previewSkillDamage(skill, { attack: boss.attack }, { defense: minDefense, maxHp: minHp }, 1, false);
          // The worst case one cast can do to one character: every hit of a multi-hit, and a crit on each.
          const worst = (skill.effects ?? [])
            .filter((e) => e.kind === "damage")
            .reduce((sum, e, i) => {
              const perHit = preview.perEffect[i]!.finalDamage * (e.critChance ? 1.5 : 1);
              return sum + perHit * (e.hitCountRange?.max ?? 1);
            }, 0);
          expect(worst, `${id} ${skillId} vs ${minHp} max HP`).toBeLessThan(minHp);
          if (skill.telegraph) expect(worst, `${id} ${skillId} telegraph cap`).toBeLessThan(band.telegraphCap * minHp);
        }
      }
    }
  });

  test("guard-only archetypes keep their Monster Balance Points in the elite/boss band", () => {
    for (const a of MONSTER_ARCHETYPES.filter((m) => m.roles.includes("elite") && !m.roles.includes("normal") && !m.finalBoss)) {
      const points = monsterBalancePoints({ attack: a.baseAttack, defense: a.baseDefense, hp: a.baseHp, speed: a.baseSpeed });
      expect(points, a.id).toBeGreaterThanOrEqual(23);
      expect(points, a.id).toBeLessThanOrEqual(25);
    }
  });
});
