import type { ItemDefinition, Id, SkillEffect, CombatStat } from "../types";
import itemsJson from "../../data/items.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";
import { getStatusEffect } from "./statusEffects";
import { t } from "./strings";

export const ITEMS = itemsJson as unknown as ItemDefinition[];

export function getItem(id: Id): ItemDefinition {
  const found = ITEMS.find((i) => i.id === id);
  if (!found) throw new Error(`Unknown item: ${id}`);
  return found;
}

const STAT_LABEL: Record<string, string> = { fear: t("resolver.statLabelFear"), satiety: t("resolver.statLabelSatiety") };
const COMBAT_STAT_LABEL: Record<CombatStat, string> = {
  attack: t("resolver.statLabelAttack"),
  defense: t("resolver.statLabelDefense"),
  aggro: t("resolver.statLabelAggro"),
  speed: t("resolver.statLabelSpeed"),
};

export function signed(amount: number): string {
  return `${amount >= 0 ? "+" : ""}${amount}`;
}

function statusEffectSummary(statusEffectId: Id): string {
  const status = getStatusEffect(statusEffectId);
  const parts = status.perTurnEffects.map((e) => {
    if (e.kind === "damage") return t("item.effectPerTurnDamage", { amount: e.amount ?? 0 });
    if (e.kind === "heal") return t("item.effectPerTurnHeal", { amount: e.amount ?? 0 });
    if (e.kind === "modifyCombatStat" && e.combatStat) return t("item.effectPerTurnStat", { amount: signed(e.amount ?? 0), stat: COMBAT_STAT_LABEL[e.combatStat] });
    return "";
  }).filter(Boolean);
  if (status.onHitStatusEffectId) parts.push(t("item.effectOnHitRider", { status: getStatusEffect(status.onHitStatusEffectId).name }));
  if (status.vulnerableTo) parts.push(t("item.effectVulnerable", { status: getStatusEffect(status.vulnerableTo.statusEffectId).name }));
  if (status.stuns) parts.push(t("item.effectStuns"));
  const body = parts.length > 0 ? parts.join(", ") : t("item.effectNoPerTurn");
  return t("item.statusSummary", { name: status.name, turns: status.durationTurns ?? "?", body });
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
      return t("item.effectRemoveStatus");
    case "applyStatusEffect":
      return effect.statusEffectId ? t("item.effectApplyStatus", { summary: statusEffectSummary(effect.statusEffectId) }) : t("item.effectApplyStatusGeneric");
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
};

export function formatItemEffect(item: ItemDefinition): string {
  return item.effects.map(itemEffectSummary).join(". ") + "." + (TARGET_NOTE[item.target] ?? "");
}

const BASE_ITEM_IDS = ITEMS.filter((i) => !i.archetypeIds || i.archetypeIds.length === 0).map((i) => i.id);

const ITEM_DROP_CHANCE = BALANCE.items.itemDropChance;

const ITEM_WEIGHT_DEPTH_GROWTH = BALANCE.items.itemWeightDepthGrowth;

function effectiveWeight(item: ItemDefinition, floorDepth: number): number {
  const base = item.weight ?? 1;
  if (base >= 1) return base;
  return Math.min(1, base + ITEM_WEIGHT_DEPTH_GROWTH * (floorDepth - 1));
}

export function rollItemDrop(archetypeId: Id, rng: Rng, floorDepth = 1): Id | null {
  if (!rng.chance(ITEM_DROP_CHANCE)) return null;

  const signatureIds = ITEMS.filter((i) => i.archetypeIds?.includes(archetypeId)).map((i) => i.id);
  const weighted: { id: Id; weight: number }[] = [];
  if (signatureIds.length > 0) {
    const signatureTotal = signatureIds.reduce((sum, id) => sum + effectiveWeight(getItem(id), floorDepth), 0);
    for (const id of signatureIds) weighted.push({ id, weight: (effectiveWeight(getItem(id), floorDepth) / signatureTotal) * 50 });
  }
  const baseTotal = BASE_ITEM_IDS.reduce((sum, id) => sum + effectiveWeight(getItem(id), floorDepth), 0);
  for (const id of BASE_ITEM_IDS) weighted.push({ id, weight: (effectiveWeight(getItem(id), floorDepth) / baseTotal) * 50 });

  return rng.weightedPick(weighted, (w) => w.weight).id;
}
