import type { ItemDefinition, Id, SkillEffect, CombatStat } from "../types";
import itemsJson from "../../data/items.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";
import { getStatusEffect } from "./statusEffects";

// Design data now lives in ../../data/items.json — see
// docs/gameplay-decisions/07-items-artifacts.md §7.1.
export const ITEMS = itemsJson as unknown as ItemDefinition[];

export function getItem(id: Id): ItemDefinition {
  const found = ITEMS.find((i) => i.id === id);
  if (!found) throw new Error(`Unknown item: ${id}`);
  return found;
}

const STAT_LABEL: Record<string, string> = { hunger: "hunger", thirst: "thirst", fear: "fear" };
const COMBAT_STAT_LABEL: Record<CombatStat, string> = { attack: "attack", defense: "defense", aggro: "aggro", speed: "speed" };

/** 1 status effect's per-turn behavior as a short Vietnamese fragment — shared by an item granting it and a status effect's own detail text. */
function statusEffectSummary(statusEffectId: Id): string {
  const status = getStatusEffect(statusEffectId);
  const parts = status.perTurnEffects.map((e) => {
    if (e.kind === "damage") return `mất ${e.amount} HP/lượt`;
    if (e.kind === "heal") return `hồi ${e.amount} HP/lượt`;
    if (e.kind === "modifyCombatStat" && e.combatStat) return `${(e.amount ?? 0) >= 0 ? "+" : ""}${e.amount} ${COMBAT_STAT_LABEL[e.combatStat]}/lượt`;
    return "";
  }).filter(Boolean);
  if (status.onHitStatusEffectId) parts.push(`mọi đòn đánh trúng tự kèm ${getStatusEffect(status.onHitStatusEffectId).name}`);
  if (status.vulnerableTo) parts.push(`nhân đôi sát thương ${getStatusEffect(status.vulnerableTo.statusEffectId).name} đang mang`);
  if (status.stuns) parts.push("mất lượt hoàn toàn");
  const body = parts.length > 0 ? parts.join(", ") : "không có hiệu ứng theo lượt";
  return `${status.name} (${status.durationTurns ?? "?"} lượt): ${body}`;
}

function itemEffectSummary(effect: SkillEffect): string {
  switch (effect.kind) {
    case "heal":
      return `Hồi ngay ${effect.amount} HP`;
    case "restoreMp":
      return `Hồi ngay ${effect.amount} MP`;
    case "modifyStat": {
      const label = effect.stat ? STAT_LABEL[effect.stat] ?? effect.stat : "";
      const amount = effect.amount ?? 0;
      return `${amount >= 0 ? "+" : ""}${amount} ${label}`;
    }
    case "removeStatusEffect":
      return "Gỡ 1 hiệu ứng bất lợi đang mang";
    case "applyStatusEffect":
      return effect.statusEffectId ? `Áp dụng ${statusEffectSummary(effect.statusEffectId)}` : "Áp dụng 1 hiệu ứng";
    case "modifyCombatStat": {
      const label = effect.combatStat ? COMBAT_STAT_LABEL[effect.combatStat] : "";
      const amount = effect.amount ?? 0;
      return `${amount >= 0 ? "+" : ""}${amount} ${label}`;
    }
    default:
      return "Hiệu ứng đặc biệt";
  }
}

const TARGET_NOTE: Record<string, string> = {
  self: " (chọn 1 nhân vật bất kỳ, kể cả đồng đội)",
  singleAlly: " (chọn 1 đồng đội)",
  allAllies: " (cả đội)",
  singleEnemy: " (chọn 1 kẻ địch — chỉ dùng trong combat)",
};

/** Auto-derived "công dụng" text for an item's detail screen — always matches `item.effects` exactly, so it can never drift from `item.description`'s flavor text the way a hand-authored effect string could. */
export function formatItemEffect(item: ItemDefinition): string {
  return item.effects.map(itemEffectSummary).join(". ") + "." + (TARGET_NOTE[item.target] ?? "");
}

/** The 10 shared-pool items — every item without an `archetypeIds` list (§7.1 "Catalog — 10 item"). */
const BASE_ITEM_IDS = ITEMS.filter((i) => !i.archetypeIds || i.archetypeIds.length === 0).map((i) => i.id);

/** §7.1 "Nguồn rơi" — 60% per kill (any tier). Value: data/balance-config.json BALANCE.items.itemDropChance. */
const ITEM_DROP_CHANCE = BALANCE.items.itemDropChance;

/** Per floor of depth beyond 1, an item's weight below 1 grows toward its full weight of 1 — stronger items become progressively easier to find deeper in the dungeon. Value: data/balance-config.json BALANCE.items.itemWeightDepthGrowth. */
const ITEM_WEIGHT_DEPTH_GROWTH = BALANCE.items.itemWeightDepthGrowth;

function effectiveWeight(item: ItemDefinition, floorDepth: number): number {
  const base = item.weight ?? 1;
  if (base >= 1) return base;
  return Math.min(1, base + ITEM_WEIGHT_DEPTH_GROWTH * (floorDepth - 1));
}

/**
 * Rolls whether killing a monster of `archetypeId` drops an item, and which
 * one. On the 60% success: 50% of the weight goes to the archetype's
 * signature items (split by relative `weight` if it has more than 1 — e.g.
 * Zombie Knight has both Rotten Flesh and Broken Blade Fragment), the
 * remaining 50% is split by relative `weight` across the 10 base-pool items
 * (§7.1). Items with weight < 1 (stronger effects) drop less often, growing
 * toward full weight as `floorDepth` increases.
 */
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
