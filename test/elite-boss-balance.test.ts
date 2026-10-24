import { describe, test, expect } from "bun:test";
import { CLASSES } from "../src/data/classes";
import { MONSTER_ARCHETYPES, getMonsterSkill, spawnMonster } from "../src/data/monsters";
import { getStatusEffect } from "../src/data/statusEffects";
import { BALANCE } from "../src/data/balanceConfig";
import { statsForLevel } from "../src/engine/party";
import { previewSkillDamage, monsterBalancePoints } from "../tools/game-editor/calc";
import type { MonsterArchetype, MonsterTier, SkillDefinition, SkillEffect } from "../src/types";
import { firstDepth, levelAt, mean, simulateRows, type Row } from "./balanceSim";

// The targets live here, not in the docs. Each band rises over the one before it in average damage taken
// per round (as a share of the party's total max HP) and in rounds the party needs to win. The ranges are wide inside a band
// because its members are different monsters (a glass cannon dies sooner than a wall); what the tests below
// pin is the order between bands and between tiers.
//
// The party is the harness's: class stats at the average level for the depth, no artifacts or abilities,
// starting every round from the same wounded spread (`WOUNDED` in balanceSim.ts). The deepest archetypes are
// marathons in it: monster defense and HP outgrow a level-capped party (06-level-system.md, 6.10), which is
// why their rounds are far above the rest.
const BANDS = [
  { ids: ["skeleton-guard", "giant-spider"], dpr: { elite: [2, 4], boss: [0.8, 3.2] }, rounds: { elite: [2.5, 4.8], boss: [2.5, 6.5] } },
  { ids: ["zombie-knight", "orc-chieftain", "vampire-lord"], dpr: { elite: [2, 4], boss: [2.3, 4.5] }, rounds: { elite: [5, 8.5], boss: [7, 11] } },
  { ids: ["dark-knight", "void-amalgamation", "lich"], dpr: { elite: [1.5, 5.5], boss: [1.5, 5.5] }, rounds: { elite: [5, 13.5], boss: [6, 21] } },
  { ids: ["ancient-golem", "dragon"], dpr: { elite: [3, 5.5], boss: [4.5, 7.5] }, rounds: { elite: [8, 33], boss: [18, 45] } },
  { ids: ["the-founder"], dpr: { boss: [5, 8] }, rounds: { boss: [24, 45] } },
] as const;

const CASES = BANDS.flatMap((band) =>
  band.ids.flatMap((id) => (Object.keys(band.dpr) as MonsterTier[]).map((tier) => [id, tier] as const))
);

/** A boss spends turns charging, buffing and summoning, so its damage per round only has to come close to its elite's; the Lich's boss kit spends the most of them. */
const BOSS_DPR_TOLERANCE = 0.55;
/**
 * A band's mean damage per round may sit this far below the band before it: who a guard hits depends on
 * its `aiPattern`, which moves damage between bands, and band 2's mean sits just under band 1's.
 * Rounds still rise strictly.
 */
const BAND_DPR_TOLERANCE = 0.9;
/** The final boss sits at least this close to the hardest guard on both measures. */
const FOUNDER_TOLERANCE = 0.9;

/** Every status an archetype's kit applies, with the skill effect that applies it, on the given side. */
function kitStatuses(archetype: MonsterArchetype, side: "self" | "enemy"): { effect: SkillEffect; statusId: string }[] {
  const out: { effect: SkillEffect; statusId: string }[] = [];
  for (const skill of archetype.skillIds.map(getMonsterSkill)) {
    const onSelf = skill.target === "self" || skill.target === "allAllies";
    for (const effect of [...(skill.effects ?? []), ...(skill.chargeEffects ?? [])]) {
      if (effect.kind !== "applyStatusEffect" || !effect.statusEffectId) continue;
      const lands = skill.chargeEffects?.includes(effect) ? "self" : onSelf ? "self" : "enemy";
      if (lands === side) for (const id of [effect.statusEffectId, ...(effect.alsoApplyStatusEffectIds ?? [])]) out.push({ effect, statusId: id });
    }
  }
  return out;
}

/** The larger of a stat change's flat amount and its share of the stat (the engine's `minPercent` floor), signed. */
function statChange(effect: SkillEffect, statusId: string, stat: "attack" | "maxHp", base: number): number {
  const def = getStatusEffect(statusId);
  let total = 0;
  for (const e of def.perTurnEffects) {
    if (e.kind !== "modifyCombatStat" || e.combatStat !== stat) continue;
    const amount = effect.amount ?? e.amount ?? 0;
    const minPercent = effect.minPercent ?? e.minPercent ?? 0;
    const floor = (base * minPercent) / 100;
    total += Math.abs(floor) > Math.abs(amount) ? floor : amount;
  }
  return total;
}

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

  test("band means rise from band to band for rounds, and do not fall far for damage", () => {
    for (const metric of ["dpr", "rounds"] as const) {
      const means = BANDS.map((band) => mean(allRows().filter((r) => (band.ids as readonly string[]).includes(r.id)).map((r) => r[metric])));
      for (let i = 1; i < means.length; i++) {
        if (metric === "rounds") expect(means[i], `rounds: band ${i + 1} over band ${i}`).toBeGreaterThan(means[i - 1]!);
        else expect(means[i], `dpr: band ${i + 1} against band ${i}`).toBeGreaterThan(means[i - 1]! * BAND_DPR_TOLERANCE);
      }
    }
  });

  test("boss tier sits above elite tier at the same depth, for rounds and close to it for damage", () => {
    // Skeleton Guard's first elite floor is several floors above its first boss floor, so both tiers are fought at the boss floor.
    const ids = BANDS.flatMap((band) => band.ids.filter((id) => "elite" in band.dpr));
    const elites = simulateRows(ids.map((id) => [id, "elite", firstDepth(id, "boss")] as const));
    for (const elite of elites) {
      const boss = allRows().find((r) => r.id === elite.id && r.tier === "boss")!;
      expect(boss.rounds, `${elite.id} rounds`).toBeGreaterThan(elite.rounds);
      expect(boss.dpr, `${elite.id} damage share`).toBeGreaterThanOrEqual(BOSS_DPR_TOLERANCE * elite.dpr);
    }
  });

  test("the final boss sits at the top of the curve", () => {
    const founder = allRows().find((r) => r.id === "the-founder")!;
    const guards = allRows().filter((r) => r.id !== "the-founder");
    for (const metric of ["dpr", "rounds"] as const) {
      expect(founder[metric], metric).toBeGreaterThanOrEqual(FOUNDER_TOLERANCE * Math.max(...guards.map((r) => r[metric])));
    }
  });

  test("the party wins every simulated fight before the round cap", () => {
    for (const row of allRows()) expect(row.winRate, `${row.id} ${row.tier}`).toBe(1);
  });

  test("no skill other than a boss telegraph reaches the lowest-HP class's max HP", () => {
    for (const band of BANDS) {
      for (const id of band.ids) {
        const archetype = MONSTER_ARCHETYPES.find((a) => a.id === id)!;
        const depth = firstDepth(id, "boss");
        const level = levelAt(depth);
        const stats = CLASSES.map((c) => statsForLevel(c, level));
        const minDefense = Math.min(...stats.map((s) => s.defense));
        const boss = spawnMonster(id, depth, { tier: "boss" });
        // The worst case: every attack buff the kit can put on the monster at once (phase buffs, war cries),
        // against the lowest-HP class with every max-HP loss the kit can put on it.
        const lowestHp = Math.min(...stats.map((s) => s.maxHp));
        const minHp = lowestHp + kitStatuses(archetype, "enemy").reduce((sum, { effect, statusId }) => sum + Math.min(0, statChange(effect, statusId, "maxHp", lowestHp)), 0);
        const attack = boss.attack + kitStatuses(archetype, "self").reduce((sum, { effect, statusId }) => sum + Math.max(0, statChange(effect, statusId, "attack", boss.attack)), 0);
        for (const skillId of archetype.skillIds) {
          const skill: SkillDefinition = getMonsterSkill(skillId);
          if (!(skill.effects ?? []).some((e) => e.kind === "damage")) continue;
          const preview = previewSkillDamage(skill, { attack }, { defense: minDefense, maxHp: minHp }, 1, false);
          // The worst case one cast can do to one character: every hit of a multi-hit, and a crit on each.
          const worst = (skill.effects ?? [])
            .filter((e) => e.kind === "damage")
            .reduce((sum, e, i) => {
              const crit = e.critChance ? (e.critMultiplierPercent ?? BALANCE.combat.defaultCritMultiplierPercent) / 100 : 1;
              const perHit = preview.perEffect[i]!.finalDamage * crit;
              return sum + perHit * (e.hitCountRange?.max ?? 1);
            }, 0);
          if (archetype.bossTelegraph?.skillId !== skillId) expect(worst, `${id} ${skillId} vs ${minHp} max HP`).toBeLessThan(minHp);
        }
      }
    }
  });

  test("boss skills follow the damage rules", () => {
    for (const band of BANDS) {
      for (const id of band.ids) {
        const archetype = MONSTER_ARCHETYPES.find((a) => a.id === id)!;
        for (const skillId of archetype.skillIds) {
          for (const effect of getMonsterSkill(skillId).effects ?? []) {
            if (effect.kind !== "damage") continue;
            const percent = effect.offenseMultiplierPercent ?? 100;
            if (archetype.bossTelegraph?.skillId === skillId) {
              expect(percent, `${id} ${skillId} telegraph`).toBeGreaterThanOrEqual(190);
              expect(percent, `${id} ${skillId} telegraph`).toBeLessThanOrEqual(280);
            } else {
              expect(percent, `${id} ${skillId}`).toBeLessThanOrEqual(170);
            }
          }
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
