import type { ItemDefinition, Id, SkillEffect, CombatStat } from "../types";
import itemsJson from "../../data/items.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";
import { getStatusEffect } from "./statusEffects";

export const ITEMS = itemsJson as unknown as ItemDefinition[];

export function getItem(id: Id): ItemDefinition {
  const found = ITEMS.find((i) => i.id === id);
  if (!found) throw new Error(`Unknown item: ${id}`);
  return found;
}

const STAT_LABEL: Record<string, string> = { hunger: "hunger", thirst: "thirst", fear: "fear" };
const COMBAT_STAT_LABEL: Record<CombatStat, string> = { attack: "attack", defense: "defense", aggro: "aggro", speed: "speed" };

function statusEffectSummary(statusEffectId: Id): string {
  const status = getStatusEffect(statusEffectId);
  const parts = status.perTurnEffects.map((e) => {
    if (e.kind === "damage") return `lose ${e.amount} HP/turn`;
    if (e.kind === "heal") return `restore ${e.amount} HP/turn`;
    if (e.kind === "modifyCombatStat" && e.combatStat) return `${(e.amount ?? 0) >= 0 ? "+" : ""}${e.amount} ${COMBAT_STAT_LABEL[e.combatStat]}/turn`;
    return "";
  }).filter(Boolean);
  if (status.onHitStatusEffectId) parts.push(`every landed hit also applies ${getStatusEffect(status.onHitStatusEffectId).name}`);
  if (status.vulnerableTo) parts.push(`doubles damage from ${getStatusEffect(status.vulnerableTo.statusEffectId).name} while active`);
  if (status.stuns) parts.push("skips the turn entirely");
  const body = parts.length > 0 ? parts.join(", ") : "no per-turn effect";
  return `${status.name} (${status.durationTurns ?? "?"} turns): ${body}`;
}

function itemEffectSummary(effect: SkillEffect): string {
  switch (effect.kind) {
    case "heal":
      return `Instantly restores ${effect.amount} HP`;
    case "restoreMp":
      return `Instantly restores ${effect.amount} MP`;
    case "modifyStat": {
      const label = effect.stat ? STAT_LABEL[effect.stat] ?? effect.stat : "";
      const amount = effect.amount ?? 0;
      return `${amount >= 0 ? "+" : ""}${amount} ${label}`;
    }
    case "removeStatusEffect":
      return "Removes 1 active negative status effect";
    case "applyStatusEffect":
      return effect.statusEffectId ? `Applies ${statusEffectSummary(effect.statusEffectId)}` : "Applies 1 status effect";
    case "modifyCombatStat": {
      const label = effect.combatStat ? COMBAT_STAT_LABEL[effect.combatStat] : "";
      const amount = effect.amount ?? 0;
      return `${amount >= 0 ? "+" : ""}${amount} ${label}`;
    }
    default:
      return "Special effect";
  }
}

const TARGET_NOTE: Record<string, string> = {
  self: " (choose any character, including allies)",
  singleAlly: " (choose 1 ally)",
  allAllies: " (whole party)",
  singleEnemy: " (choose 1 enemy — combat only)",
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
