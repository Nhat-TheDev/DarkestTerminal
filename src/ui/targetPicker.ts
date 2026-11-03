import type { TextChunk } from "@opentui/core";
import type { CombatStat, CombatantRef, SkillEffect } from "../types";
import { getStatusEffect } from "../data/statusEffects";
import { t } from "../data/strings";
import { getFearTier, isCharacter, statDirection, statusRole, type Actor } from "../engine/resolver";
import { PALETTE, colorChunk, fearColorFor, hpColorFor, plainChunk } from "./theme";

export const MOST_HURT_BELOW = 0.5;
const MIN_ENEMIES_TO_FLAG = 2;

const STAT_ABBR_KEY: Record<CombatStat, string> = {
  attack: "ui.statAbbrAttack",
  defense: "ui.statAbbrDefense",
  speed: "ui.statAbbrSpeed",
  magicPower: "ui.statAbbrMagicPower",
  aggro: "ui.statAbbrAggro",
  maxHp: "ui.statAbbrMaxHp",
};

export interface AllyTargetInfo {
  hp: boolean;
  mp: boolean;
  fear: boolean;
  stats: CombatStat[];
}

export function allyTargetInfo(effects: SkillEffect[]): AllyTargetInfo {
  return sideTargetInfo(effects, "ally");
}

function isPlain(info: AllyTargetInfo): boolean {
  return !info.hp && !info.mp && !info.fear && info.stats.length === 0;
}

/** Effects restricted to the other side, or resolved on a target of their own, are left out. */
function sideTargetInfo(effects: SkillEffect[], side: "ally" | "enemy"): AllyTargetInfo {
  const info: AllyTargetInfo = { hp: false, mp: false, fear: false, stats: [] };
  const stats = new Set<CombatStat>();
  for (const effect of effects) {
    if (effect.target !== undefined || (effect.appliesToRelation && effect.appliesToRelation !== side)) continue;
    if (effect.kind === "heal") info.hp = true;
    else if (effect.kind === "restoreMp") info.mp = true;
    else if (effect.kind === "modifyStat" && effect.stat === "fear") info.fear = true;
    else if (effect.kind === "modifyCombatStat") {
      if (effect.combatStat && statDirection(effect) > 0) stats.add(effect.combatStat);
    } else if (effect.kind === "applyStatusEffect" && effect.statusEffectId) {
      for (const id of [effect.statusEffectId, ...(effect.alsoApplyStatusEffectIds ?? [])]) {
        const def = getStatusEffect(id);
        if (statusRole(def) === "debuff") continue;
        if (def.fearResistPercent) info.fear = true;
        for (const e of def.perTurnEffects) {
          if (e.kind === "heal") info.hp = true;
          else if (e.kind === "restoreMp") info.mp = true;
          else if (e.kind === "modifyStat" && e.stat === "fear") info.fear = true;
          else if (e.kind === "modifyCombatStat" && e.combatStat) stats.add(e.combatStat);
        }
      }
    }
  }
  info.stats = [...stats];
  return info;
}

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

/** A list of both sides is judged per side, by the effects that reach that side. */
export function targetChoiceLines(candidates: TargetCandidate[], effects: SkillEffect[], withSidePrefix: boolean): TextChunk[][] {
  const info = allyTargetInfo(effects);
  const isEnemy = (c: TargetCandidate) => c.ref.kind === "monster";
  const allies = candidates.filter((c) => !isEnemy(c));
  const enemies = candidates.filter(isEnemy);
  const flagged = new Set<TargetCandidate>();
  if (info.hp) {
    const i = mostHurtIndex(allies.map((c) => c.actor));
    if (i >= 0) flagged.add(allies[i]!);
  }
  if (isPlain(sideTargetInfo(effects, "enemy"))) {
    const j = mostHurtIndex(
      enemies.map((c) => c.actor),
      MIN_ENEMIES_TO_FLAG
    );
    if (j >= 0) flagged.add(enemies[j]!);
  }

  return candidates.map((candidate, i) => {
    const { actor } = candidate;
    const enemy = isEnemy(candidate);
    const prefix = withSidePrefix ? t(enemy ? "ui.enemySidePrefix" : "ui.allySidePrefix") : "";
    const line: TextChunk[] = [plainChunk(`  [${i + 1}] ${prefix}${actor.name}`)];
    const hpChunk = colorChunk(t("ui.targetHp", { hp: actor.hp, maxHp: actor.maxHp }), hpColorFor(actor.hp, actor.maxHp));
    const parts: TextChunk[] = [];
    if (!enemy) {
      if (info.hp) parts.push(hpChunk);
      if (isCharacter(actor)) {
        if (info.mp) parts.push(colorChunk(t("ui.targetMp", { mp: actor.mp, maxMp: actor.maxMp }), PALETTE.mp));
        if (info.fear) parts.push(colorChunk(t("ui.fearStat", { fear: Math.floor(actor.survival.fear) }), fearColorFor(getFearTier(actor.survival.fear))));
      }
      for (const stat of info.stats) parts.push(plainChunk(t("ui.targetStat", { abbr: t(STAT_ABBR_KEY[stat]), value: (actor as Partial<Record<CombatStat, number>>)[stat] ?? 0 })));
    }
    if (parts.length === 0) parts.push(hpChunk);
    line.push(plainChunk(" ("));
    parts.forEach((part, k) => {
      if (k > 0) line.push(plainChunk(", "));
      line.push(part);
    });
    line.push(plainChunk(")"));
    if (flagged.has(candidate)) line.push(colorChunk(t("ui.targetMostHurtMark"), hpColorFor(actor.hp, actor.maxHp)));
    return line;
  });
}
