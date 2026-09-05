import type { AbilityDefinition, AbilityEffect, ArtifactRarity, Id } from "../types";
import abilitiesJson from "../../data/abilities.json";
import type { Rng } from "../engine/rng";
import { BALANCE } from "./balanceConfig";
import { t } from "./strings";
import { signed } from "./items";

export const ABILITIES = abilitiesJson as unknown as AbilityDefinition[];

export function getAbility(id: Id): AbilityDefinition {
  const found = ABILITIES.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown ability: ${id}`);
  return found;
}

const STAT_LABEL: Record<string, string> = {
  attack: t("resolver.statLabelAttack"),
  defense: t("resolver.statLabelDefense"),
  maxHp: t("artifact.statLabelMaxHp"),
  maxMp: t("artifact.statLabelMaxMp"),
  aggro: t("resolver.statLabelAggro"),
  speed: t("resolver.statLabelSpeed"),
  magicPower: t("ability.statLabelMagicPower"),
};

function abilityEffectSummary(effect: AbilityEffect): string {
  switch (effect.kind) {
    case "statBoost":
      return t("effect.signedStat", { amount: signed(effect.amount), stat: STAT_LABEL[effect.stat] ?? effect.stat });
    case "reflectDamage":
      return t("artifact.effectReflectDamage", { percent: effect.percent });
    case "poisonOnHit":
      return t("artifact.effectPoisonOnHit", { chance: effect.chance });
    case "lifesteal":
      return t("artifact.effectLifesteal", { percent: effect.percent });
    case "dodgeChance":
      return t("artifact.effectDodgeChance", { chance: effect.chance });
    case "healOnKill":
      return t("artifact.effectHealOnKill", { amount: effect.amount });
    case "autoDamage":
      return t("artifact.effectAutoDamage", { amount: effect.amount });
    case "expBoost":
      return t("artifact.effectExpBoost", { percent: effect.percent });
    case "fearResist":
      return t("artifact.effectFearResist", { percent: effect.percent });
    case "cooldownReduction":
      return t("artifact.effectCooldownReduction", { turns: effect.turns });
    case "alwaysHit":
      return t("ability.effectAlwaysHit", { chance: effect.chance });
    default:
      return t("effect.default");
  }
}

export function formatAbilityEffect(ability: AbilityDefinition): string {
  return ability.effects.map(abilityEffectSummary).join(". ") + ".";
}

export type AbilitySource = "elite" | "boss";

const RARITIES: ArtifactRarity[] = ["common", "rare", "unique", "epic"];

/** Linear interpolation between the depth-1 and depth-cap weight tables — `11-abilities.md` §11.1 "Mid-run acquisition". */
function interpolateWeight(atDepth1: number, atDepthCap: number, depth: number, depthCap: number): number {
  if (depthCap <= 1) return atDepth1;
  const clampedDepth = Math.max(1, Math.min(depthCap, depth));
  return atDepth1 + (atDepthCap - atDepth1) * ((clampedDepth - 1) / (depthCap - 1));
}

function weightsAtDepth(source: AbilitySource, depth: number): Record<ArtifactRarity, number> {
  const cfg = BALANCE.abilities.rarityWeightsByDepth[source];
  const depthCap = BALANCE.abilities.depthCap;
  const weights = {} as Record<ArtifactRarity, number>;
  for (const rarity of RARITIES) {
    weights[rarity] = interpolateWeight(cfg.atDepth1[rarity], cfg.atDepthCap[rarity], depth, depthCap);
  }
  return weights;
}

export function abilitiesOfRarity(rarity: ArtifactRarity): AbilityDefinition[] {
  return ABILITIES.filter((a) => a.rarity === rarity);
}

/** Non-common abilities of `rarity` not already in `unlockedAbilityIds` — the roll only ever surfaces something new ("tỉ lệ rơi chỉ rơi những abilities chưa có trong pool chung"). */
export function availableAbilitiesOfRarity(rarity: ArtifactRarity, unlockedAbilityIds: Id[]): AbilityDefinition[] {
  return abilitiesOfRarity(rarity).filter((a) => !unlockedAbilityIds.includes(a.id));
}

/**
 * Elite and Boss both resolve identically: gated by `dropChance`, then a depth-interpolated rarity
 * roll excluding any tier already fully unlocked (redistributing its weight across the rest), then a
 * random pick within that tier excluding ids already unlocked. Resolves to `null` when the roll
 * misses, the rolled rarity is `common` (always available already, nothing to unlock), or the whole
 * non-common catalog is exhausted. `11-abilities.md` §11.1 "Mid-run acquisition".
 */
export function rollAbility(source: AbilitySource, depth: number, rng: Rng, unlockedAbilityIds: Id[]): Id | null {
  if (!rng.chance(BALANCE.abilities.dropChance)) return null;
  const weights = weightsAtDepth(source, depth);
  const entries = RARITIES.filter((rarity) => rarity === "common" || availableAbilitiesOfRarity(rarity, unlockedAbilityIds).length > 0)
    .map((rarity) => [rarity, weights[rarity]] as const)
    .filter(([, weight]) => weight > 0);
  if (entries.length === 0) return null;
  const rarity = rng.weightedPick(entries, ([, weight]) => weight)[0];
  if (rarity === "common") return null;
  const pool = availableAbilitiesOfRarity(rarity, unlockedAbilityIds);
  return rng.pick(pool).id;
}
