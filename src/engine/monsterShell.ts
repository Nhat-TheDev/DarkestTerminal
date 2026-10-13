import type { Monster } from "../types";
import { getArchetype } from "../data/monsters";
import { getStatusEffect } from "../data/statusEffects";
import { t } from "../data/strings";
import type { Rng } from "./rng";
import { applyStatusEffectToActor, expireStatusEffect, isHelpfulStatusEffect, isMonster, type Actor, type ResolveContext } from "./resolver";

function shellOf(monster: Monster) {
  return monster.tier === "normal" ? undefined : getArchetype(monster.archetypeId).shell;
}

/** Forms (or re-forms) the shell of a bearer: intact, with the number of hits it takes to break rolled from the archetype's range. A monster with no shell, or at normal tier, is left alone and draws nothing from the RNG. */
export function formShell(monster: Monster, rng: Rng): void {
  const def = shellOf(monster);
  if (!def) return;
  monster.shell = { state: "intact", hitsLeft: rng.int(def.hitsToBreak.min, def.hitsToBreak.max), ownTurnsSinceBreak: 0 };
}

/** An intact shell caps a direct hit at a share of max HP and turns a status tick away entirely. */
export function shellAdjustedDamage(target: Actor, damage: number, isTick: boolean): number {
  if (!isMonster(target) || target.shell?.state !== "intact") return damage;
  if (isTick) return 0;
  const cap = Math.max(1, Math.round((target.maxHp * shellOf(target)!.hitDamageCapMaxHpPercent) / 100));
  return Math.min(damage, cap);
}

/** Counts a direct hit against an intact shell; the last one breaks it and stuns the bearer. */
export function noteShellHit(target: Actor, ctx: ResolveContext): void {
  if (!isMonster(target) || target.shell?.state !== "intact") return;
  target.shell.hitsLeft -= 1;
  if (target.shell.hitsLeft > 0) return;
  const def = shellOf(target)!;
  target.shell = { state: "broken", hitsLeft: 0, ownTurnsSinceBreak: 0 };
  ctx.log.push({ text: t("combat.shellBreaks", { actor: target.name }), kind: "info" });
  applyStatusEffectToActor(target, def.breakStatusId, def.breakDurationTurns, ctx);
}

/** Counts the monster's own turns since breaking (the stunned one included); on the configured one the shell re-forms and every debuff on it falls away. */
export function advanceShellAfterOwnTurn(monster: Monster, rng: Rng, ctx: ResolveContext): void {
  if (monster.shell?.state !== "broken" || monster.hp <= 0) return;
  monster.shell.ownTurnsSinceBreak += 1;
  if (monster.shell.ownTurnsSinceBreak < shellOf(monster)!.reformAfterOwnTurns) return;
  for (const active of [...monster.activeStatusEffects]) {
    if (!isHelpfulStatusEffect(getStatusEffect(active.statusEffectId))) expireStatusEffect(monster, active, ctx);
  }
  formShell(monster, rng);
  ctx.log.push({ text: t("combat.shellReforms", { actor: monster.name }), kind: "info" });
}
