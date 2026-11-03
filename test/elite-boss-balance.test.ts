import { describe, test, expect } from "bun:test";
import { CLASSES } from "../src/data/classes";
import { FINAL_BOSS_ARCHETYPE, GUARD_ROOM_ARCHETYPES, MONSTER_ARCHETYPES, getMonsterSkill, spawnMonster } from "../src/data/monsters";
import { getStatusEffect } from "../src/data/statusEffects";
import { BALANCE } from "../src/data/balanceConfig";
import { statsForLevel } from "../src/engine/party";
import { previewSkillDamage, monsterBalancePoints } from "../tools/game-editor/calc";
import type { MonsterArchetype, MonsterTier, SkillDefinition, SkillEffect } from "../src/types";
import { firstDepth, levelAt } from "../tools/random-play/curve";

const GUARD_IDS = [...GUARD_ROOM_ARCHETYPES, FINAL_BOSS_ARCHETYPE].map((a) => a.id);

/** The archetype's own telegraph, or one of its bars'. */
const isTelegraphOf = (archetype: MonsterArchetype, skillId: string): boolean =>
  archetype.bossTelegraph?.skillId === skillId || (archetype.bars ?? []).some((b) => b.bossTelegraph?.skillId === skillId);

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

describe("elite/boss skill rules", () => {
  test("no skill other than a boss telegraph reaches the lowest-HP class's max HP", () => {
    for (const id of GUARD_IDS) {
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
        if (!isTelegraphOf(archetype, skillId)) expect(worst, `${id} ${skillId} vs ${minHp} max HP`).toBeLessThan(minHp);
      }
    }
  });

  test("boss skills follow the damage rules", () => {
    for (const id of GUARD_IDS) {
      const archetype = MONSTER_ARCHETYPES.find((a) => a.id === id)!;
      for (const skillId of archetype.skillIds) {
        for (const effect of getMonsterSkill(skillId).effects ?? []) {
          if (effect.kind !== "damage") continue;
          const percent = effect.offenseMultiplierPercent ?? 100;
          if (isTelegraphOf(archetype, skillId)) {
            expect(percent, `${id} ${skillId} telegraph`).toBeGreaterThanOrEqual(190);
            expect(percent, `${id} ${skillId} telegraph`).toBeLessThanOrEqual(280);
          } else {
            expect(percent, `${id} ${skillId}`).toBeLessThanOrEqual(170);
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
