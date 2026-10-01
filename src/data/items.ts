import type { ItemDefinition, Id, SkillEffect } from "../types";
import itemsJson from "../../data/items.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";
import { getStatusEffect, formatStatusEffectMechanics, COMBAT_STAT_LABEL } from "./statusEffects";
import { t } from "./strings";

export const ITEMS = itemsJson as unknown as ItemDefinition[];

export function getItem(id: Id): ItemDefinition {
  const found = ITEMS.find((i) => i.id === id);
  if (!found) throw new Error(`Unknown item: ${id}`);
  return found;
}

const STAT_LABEL: Record<string, string> = { fear: t("resolver.statLabelFear"), satiety: t("resolver.statLabelSatiety") };

export function signed(amount: number): string {
  return `${amount >= 0 ? "+" : ""}${amount}`;
}

function statusEffectSummary(statusEffectId: Id, durationTurns: number | undefined): string {
  const status = getStatusEffect(statusEffectId);
  return t("item.statusSummary", { name: status.name, turns: durationTurns ?? 1, body: formatStatusEffectMechanics(status) });
}

function itemEffectSummary(effect: SkillEffect): string {
  switch (effect.kind) {
    case "heal":
      return t("item.effectHeal", { amount: effect.amount ?? 0 });
    case "restoreMp":
      return t("item.effectRestoreMp", { amount: effect.amount ?? 0 });
    case "modifyStat": {
      const label = effect.stat ? STAT_LABEL[effect.stat] ?? effect.stat : "";
      return t("effect.signedStat", { amount: signed(effect.amount ?? 0), stat: label });
    }
    case "removeStatusEffect":
      return effect.statusEffectId
        ? t("item.effectRemoveNamedStatus", { status: getStatusEffect(effect.statusEffectId).name })
        : t("item.effectRemoveStatus");
    case "damage":
      return t("item.effectDamage", { amount: effect.amount ?? 0, type: effect.damageType ?? "physical" });
    case "applyStatusEffect":
      return effect.statusEffectId
        ? t("item.effectApplyStatus", { summary: statusEffectSummary(effect.statusEffectId, effect.durationTurns) })
        : t("item.effectApplyStatusGeneric");
    case "modifyCombatStat": {
      const label = effect.combatStat ? COMBAT_STAT_LABEL[effect.combatStat] : "";
      return t("effect.signedStat", { amount: signed(effect.amount ?? 0), stat: label });
    }
    default:
      return t("effect.default");
  }
}

const TARGET_NOTE: Record<string, string> = {
  self: t("item.targetNoteSelf"),
  singleAlly: t("item.targetNoteSingleAlly"),
  allAllies: t("item.targetNoteAllAllies"),
  singleEnemy: t("item.targetNoteSingleEnemy"),
  allEnemies: t("item.targetNoteAllEnemies"),
};

export function formatItemEffect(item: ItemDefinition): string {
  if (item.effects.length === 0) return t("item.effectNone");
  return item.effects.map(itemEffectSummary).join(". ") + "." + (TARGET_NOTE[item.target] ?? "");
}

const TIER_WEIGHTS = BALANCE.items.tierWeights;

for (const item of ITEMS) {
  if (!(item.tier in TIER_WEIGHTS)) throw new Error(`data/items.json: "${item.id}" has an unknown tier "${item.tier}"`);
  if (item.archetypeIds?.length && item.effects.length > 0) throw new Error(`data/items.json: trophy "${item.id}" must have no effects`);
}

/** Trophies (items with `archetypeIds`) drop only from their own monsters; everything else is the general pool. */
const TROPHIES = ITEMS.filter((i) => i.archetypeIds?.length);
const GENERAL_ITEMS = ITEMS.filter((i) => !i.archetypeIds?.length);

const ITEM_DROP_CHANCE = BALANCE.items.itemDropChance;
const TROPHY_DROP_SHARE = BALANCE.items.trophyDropShare;

function dropWeight(item: ItemDefinition): number {
  return TIER_WEIGHTS[item.tier] * (item.groupItem ? BALANCE.items.groupDropMultiplier : 1);
}

export function rollItemDrop(archetypeId: Id, rng: Rng): Id | null {
  if (!rng.chance(ITEM_DROP_CHANCE)) return null;

  const trophies = TROPHIES.filter((i) => i.archetypeIds?.includes(archetypeId));
  const pool = trophies.length > 0 && rng.chance(TROPHY_DROP_SHARE) ? trophies : GENERAL_ITEMS;
  return rng.weightedPick(pool, dropWeight).id;
}
