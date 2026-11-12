import type { ItemDefinition, Id, SkillEffect } from "../types";
import itemsJson from "../../data/items.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";
import { getStatusEffect, formatStatusEffectMechanics, COMBAT_STAT_LABEL } from "./statusEffects";
import { t } from "./strings";

export const ITEMS = itemsJson as unknown as ItemDefinition[];

const campKits = ITEMS.filter((i) => i.campKit);
if (campKits.length !== 1) throw new Error(`data/items.json: exactly 1 item must set campKit (found ${campKits.length})`);
export const CAMP_KIT_ITEM_ID: Id = campKits[0]!.id;

for (const id of Object.keys(BALANCE.party.startingItems)) {
  if (!ITEMS.some((i) => i.id === id)) throw new Error(`data/balance-config.json: party.startingItems names unknown item "${id}"`);
  if (id === CAMP_KIT_ITEM_ID) throw new Error(`data/balance-config.json: party.startingItems must not list "${id}", set party.startingExplorationKits instead`);
}

export function getItem(id: Id): ItemDefinition {
  const found = ITEMS.find((i) => i.id === id);
  if (!found) throw new Error(`Unknown item: ${id}`);
  return found;
}

const STAT_LABEL: Record<string, string> = { fear: t("resolver.statLabelFear"), satiety: t("resolver.statLabelSatiety") };

export function signed(amount: number): string {
  return `${amount >= 0 ? "+" : ""}${amount}`;
}

/** The effect's `amount`/`minPercent` override the status's own magnitude (resolver.ts), so the summary shows those. */
function statusEffectSummary(statusEffectId: Id, effect: SkillEffect): string {
  const status = getStatusEffect(statusEffectId);
  const body = formatStatusEffectMechanics(status, { amount: effect.amount, minPercent: effect.minPercent });
  return t("item.statusSummary", { name: status.name, turns: effect.durationTurns ?? 1, body });
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
        ? t("item.effectApplyStatus", { summary: statusEffectSummary(effect.statusEffectId, effect) })
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

function noEffectText(item: ItemDefinition): string {
  return t(item.archetypeIds?.length ? "item.trophyHint" : "item.effectNone");
}

export function describeItemEffects(item: ItemDefinition): string {
  if (item.effects.length === 0) return noEffectText(item);
  return item.effects.map(itemEffectSummary).join(". ") + ".";
}

export function formatItemEffect(item: ItemDefinition): string {
  if (item.effects.length === 0) return noEffectText(item);
  return describeItemEffects(item) + (TARGET_NOTE[item.target] ?? "");
}

const TIER_WEIGHTS = BALANCE.items.tierWeights;

for (const item of ITEMS) {
  if (!(item.tier in TIER_WEIGHTS)) throw new Error(`data/items.json: "${item.id}" has an unknown tier "${item.tier}"`);
  if (item.archetypeIds?.length && item.effects.length > 0) throw new Error(`data/items.json: trophy "${item.id}" must have no effects`);
  if (item.effects.some((e) => e.rankWeights)) throw new Error(`data/items.json: "${item.id}" sets rankWeights, which only rolls on skills`);
}

const TROPHIES = ITEMS.filter((i) => i.archetypeIds?.length);
const GENERAL_ITEMS = ITEMS.filter((i) => !i.archetypeIds?.length);

const ITEM_DROP_CHANCE = BALANCE.items.itemDropChance;
const TROPHY_DROP_SHARE = BALANCE.items.trophyDropShare;

const GENERAL_TIER_SHARE = BALANCE.items.generalTierShare;
const GENERAL_TIERS = [...new Set(GENERAL_ITEMS.map((i) => i.tier))];

for (const tier of GENERAL_TIERS) {
  if (!(GENERAL_TIER_SHARE[tier]! > 0)) throw new Error(`data/balance-config.json: items.generalTierShare has no share for "${tier}", a tier general-pool items use`);
}

function dropWeight(item: ItemDefinition): number {
  return TIER_WEIGHTS[item.tier] * (item.groupItem ? BALANCE.items.groupDropMultiplier : 1);
}

function rollGeneralItem(rng: Rng): ItemDefinition {
  const tier = rng.weightedPick(GENERAL_TIERS, (candidate) => GENERAL_TIER_SHARE[candidate]!);
  return rng.pick(GENERAL_ITEMS.filter((i) => i.tier === tier));
}

export function rollItemDrop(archetypeId: Id, rng: Rng): Id | null {
  if (!rng.chance(ITEM_DROP_CHANCE)) return null;

  const trophies = TROPHIES.filter((i) => i.archetypeIds?.includes(archetypeId));
  if (trophies.length > 0 && rng.chance(TROPHY_DROP_SHARE)) return rng.weightedPick(trophies, dropWeight).id;
  return rollGeneralItem(rng).id;
}
