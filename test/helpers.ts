import { CLASSES, getSkill } from "../src/data/classes";
import { createFloor } from "../src/data/floor";
import { createCharacter } from "../src/engine/party";
import { Rng } from "../src/engine/rng";
import { getActorByRef, startCombat, autoResolveTargets, livingMonsterRefs, type EngineContext } from "../src/engine/combat";
import { spawnMonster } from "../src/data/monsters";
import type { Character, CombatantRef } from "../src/types";

export function makeCtx(seed = 1) {
  const rng = new Rng(seed);
  const { floor, monsters } = createFloor(rng);
  const party = CLASSES.map((cls, i) => createCharacter(`p${i + 1}`, cls.name, cls));
  const ctx: EngineContext = { party, monsters, rng, inventory: {} };
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
