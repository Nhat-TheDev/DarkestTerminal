import { afterAll, beforeAll } from "bun:test";
import { BALANCE } from "../src/data/balanceConfig";
import { CLASSES, getSkill } from "../src/data/classes";
import { createFloor } from "../src/data/floor";
import { createCharacter } from "../src/engine/party";
import { Rng } from "../src/engine/rng";
import { getActorByRef, startCombat, autoResolveTargets, livingMonsterRefs, livingCharacterRefs, queueAction, resolveRound, isCombatOver, type EngineContext } from "../src/engine/combat";
import { spawnMonster, MONSTER_ARCHETYPES, MONSTER_SKILLS } from "../src/data/monsters";
import type { Character, CombatantRef } from "../src/types";

export function makeCtx(seed = 1) {
  const rng = new Rng(seed);
  const { floor, monsters } = createFloor(rng);
  const party = CLASSES.map((cls, i) => createCharacter(`p${i + 1}`, cls.name, cls));
  const ctx: EngineContext = { party, monsters, summons: [], rng, inventory: {} };
  return { ctx, floor, monsters, party };
}

export function spawnInto(ctx: EngineContext, archetypeId: string, depth = 1) {
  const m = spawnMonster(archetypeId, depth);
  ctx.monsters.push(m);
  return m;
}

export function pickAnyAction(
  ctx: EngineContext,
  combat: ReturnType<typeof startCombat>,
  ref: CombatantRef
): { skillId: string; targets: CombatantRef[] } {
  const actor = getActorByRef(ref, ctx) as Character;
  const attackSkill = actor.unlockedSkillIds.map(getSkill).find((s) => s.target === "singleEnemy");
  if (attackSkill) {
    const enemy = livingMonsterRefs(combat, ctx)[0]!;
    return { skillId: attackSkill.id, targets: [enemy] };
  }
  const skill = actor.unlockedSkillIds.map(getSkill)[0]!;
  const targets = autoResolveTargets(skill.target, ref, combat, ctx) ?? [ref];
  return { skillId: skill.id, targets };
}

/** Pins fields of `BALANCE.combat` for the enclosing describe and puts them back after it. */
export function pinCombatBalance(values: Partial<typeof BALANCE.combat>): void {
  const saved: Partial<typeof BALANCE.combat> = {};
  beforeAll(() => {
    Object.assign(saved, Object.fromEntries(Object.keys(values).map((key) => [key, BALANCE.combat[key as keyof typeof BALANCE.combat]])));
    Object.assign(BALANCE.combat, values);
  });
  afterAll(() => {
    Object.assign(BALANCE.combat, saved);
  });
}

/** A describe that asserts an exact damage, heal or rng-draw count is about the formula, not the dice: no variance and no base crit. */
export function withoutDamageRolls(): void {
  pinCombatBalance({ damageVariancePercent: 0, baseCritChancePercent: 0 });
}

/** A normal-tier Skeleton Guard against the default party: `rounds` rounds, or until the fight ends. `lowHp` starts it under the defensive low-HP threshold. */
export function runNormalSkeletonGuardFight(seed: number, rounds: number, lowHp = false) {
  const { ctx } = makeCtx(seed);
  const guard = spawnMonster("skeleton-guard", 1);
  guard.maxHp = 5000;
  guard.hp = lowHp ? 400 : 5000;
  ctx.monsters.push(guard);
  const combat = startCombat("r1", [guard.id], ctx, false);
  for (let r = 0; r < rounds && !isCombatOver(combat, ctx); r++) {
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
  }
  return { guard, log: combat.log.map((l) => l.text) };
}

/** A monster skill for fixture kits: a 1-damage single-target hit unless `over` says otherwise. */
export const sk = (id: string, over: object = {}) => ({ id, name: id, description: "x", mpCost: 0, target: "singleEnemy", effects: [{ kind: "damage", amount: 1 }], slot: 0, unlockLevel: 1, ...over });

/**
 * Runs `body` with a guard-room archetype "fixture-boss" (Giant Spider's stats and roles, none of its
 * phases) and the given skills in the catalog, removing both afterwards even if `body` throws.
 */
export function withFixture(skills: any[], archetypeOver: any, body: () => void) {
  const base = structuredClone(MONSTER_ARCHETYPES.find((a) => a.id === "giant-spider")!);
  const archetype = { ...base, id: "fixture-boss", skillIds: skills.map((x) => x.id), phases: undefined, ...archetypeOver };
  MONSTER_SKILLS.push(...skills);
  MONSTER_ARCHETYPES.push(archetype);
  try {
    body();
  } finally {
    for (const x of skills) MONSTER_SKILLS.splice(MONSTER_SKILLS.findIndex((y) => y.id === x.id), 1);
    MONSTER_ARCHETYPES.splice(MONSTER_ARCHETYPES.findIndex((a) => a.id === "fixture-boss"), 1);
  }
}
