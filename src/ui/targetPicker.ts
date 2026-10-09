import type { TextChunk } from "@opentui/core";
import type { CombatStat, CombatantRef, SkillEffect } from "../types";
import { getStatusEffect } from "../data/statusEffects";
import { t } from "../data/strings";
import { statDirection, statusRole, type Actor } from "../engine/resolver";
import { colorChunk, hpColorFor, plainChunk } from "./theme";

/** The one flagged as most hurt must be below this share of its max HP. */
export const MOST_HURT_BELOW = 0.5;
/** Enemies are flagged only when there are at least this many to tell apart. */
const MIN_ENEMIES_TO_FLAG = 2;

const STAT_ABBR_KEY: Record<CombatStat, string> = {
  attack: "ui.statAbbrAttack",
  defense: "ui.statAbbrDefense",
  speed: "ui.statAbbrSpeed",
  magicPower: "ui.statAbbrMagicPower",
  aggro: "ui.statAbbrAggro",
};

/** What an ally in the target list is shown with: HP for a heal, the raised stats for a buff, plain HP otherwise. */
export type AllyTargetInfo = { kind: "heal" } | { kind: "stats"; stats: CombatStat[] } | { kind: "plain" };

export function allyTargetInfo(effects: SkillEffect[]): AllyTargetInfo {
  let heals = false;
  const stats = new Set<CombatStat>();
  for (const effect of effects) {
    if (effect.appliesToRelation === "enemy") continue;
    if (effect.kind === "heal") heals = true;
    else if (effect.kind === "modifyCombatStat") {
      if (effect.combatStat && statDirection(effect) > 0) stats.add(effect.combatStat);
    } else if (effect.kind === "applyStatusEffect" && effect.statusEffectId) {
      for (const id of [effect.statusEffectId, ...(effect.alsoApplyStatusEffectIds ?? [])]) {
        const def = getStatusEffect(id);
        const role = statusRole(def);
        if (role === "heal") heals = true;
        else if (role === "buff") for (const e of def.perTurnEffects) if (e.kind === "modifyCombatStat" && e.combatStat) stats.add(e.combatStat);
      }
    }
  }
  if (heals) return { kind: "heal" };
  return stats.size > 0 ? { kind: "stats", stats: [...stats] } : { kind: "plain" };
}

/** Index of the unit to flag as most hurt: the lowest share of max HP, if that is under `MOST_HURT_BELOW` (the first on a tie), else -1. */
export function mostHurtIndex(units: { hp: number; maxHp: number }[], minUnits = 1): number {
  if (units.length < minUnits) return -1;
  let best = -1;
  let bestRatio = Infinity;
  units.forEach((unit, i) => {
    const ratio = unit.maxHp > 0 ? unit.hp / unit.maxHp : 1;
    if (ratio < bestRatio) {
      best = i;
      bestRatio = ratio;
    }
  });
  return bestRatio < MOST_HURT_BELOW ? best : -1;
}

export interface TargetCandidate {
  ref: CombatantRef;
  actor: Actor;
}

/**
 * The rows of a target list. Only the HP figure is coloured (the party panel's thresholds). A heal flags
 * the most hurt ally with `*`; an attack or debuff flags the most hurt enemy, once there are two or more;
 * a stat buff shows the stats it raises in place of HP.
 */
export function targetChoiceLines(candidates: TargetCandidate[], effects: SkillEffect[], withSidePrefix: boolean): TextChunk[][] {
  const info = allyTargetInfo(effects);
  const isEnemy = (c: TargetCandidate) => c.ref.kind === "monster";
  const allies = candidates.filter((c) => !isEnemy(c));
  const enemies = candidates.filter(isEnemy);
  const flagged = new Set<TargetCandidate>();
  if (info.kind === "heal") {
    const i = mostHurtIndex(allies.map((c) => c.actor));
    if (i >= 0) flagged.add(allies[i]!);
  }
  const j = mostHurtIndex(
    enemies.map((c) => c.actor),
    MIN_ENEMIES_TO_FLAG
  );
  if (j >= 0) flagged.add(enemies[j]!);

  return candidates.map((candidate, i) => {
    const { actor } = candidate;
    const enemy = isEnemy(candidate);
    const prefix = withSidePrefix ? t(enemy ? "ui.enemySidePrefix" : "ui.allySidePrefix") : "";
    const line: TextChunk[] = [plainChunk(`  [${i + 1}] ${prefix}${actor.name}`)];
    if (!enemy && info.kind === "stats") {
      const shown = info.stats.map((stat) => t("ui.targetStat", { abbr: t(STAT_ABBR_KEY[stat]), value: (actor as Partial<Record<CombatStat, number>>)[stat] ?? 0 }));
      line.push(plainChunk(` (${shown.join(", ")})`));
    } else {
      line.push(plainChunk(" ("), colorChunk(t("ui.targetHp", { hp: actor.hp, maxHp: actor.maxHp }), hpColorFor(actor.hp, actor.maxHp)), plainChunk(")"));
      if (flagged.has(candidate)) line.push(colorChunk(t("ui.targetMostHurtMark"), hpColorFor(actor.hp, actor.maxHp)));
    }
    return line;
  });
}
