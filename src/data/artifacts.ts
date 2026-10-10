import type { ArtifactDefinition, ArtifactRarity, ArtifactEffect, Id } from "../types";
import artifactsJson from "../../data/artifacts.json";
import type { Rng } from "../engine/rng";
import { t } from "./strings";
import { signed } from "./items";
import { BALANCE } from "./balanceConfig";
import { autoDamageSummary, poisonOnHitSummary } from "./abilities";

export const ARTIFACTS = artifactsJson as unknown as ArtifactDefinition[];

export function getArtifact(id: Id): ArtifactDefinition {
  const found = ARTIFACTS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown artifact: ${id}`);
  return found;
}

const STAT_LABEL: Record<string, string> = {
  attack: t("resolver.statLabelAttack"),
  defense: t("resolver.statLabelDefense"),
  maxHp: t("artifact.statLabelMaxHp"),
  maxMp: t("artifact.statLabelMaxMp"),
  magicPower: t("ability.statLabelMagicPower"),
  speed: t("resolver.statLabelSpeed"),
};

function artifactEffectSummary(effect: ArtifactEffect): string {
  switch (effect.kind) {
    case "statBoost":
      return t("effect.signedStat", { amount: signed(effect.amount), stat: STAT_LABEL[effect.stat] ?? effect.stat });
    case "reflectDamage":
      return t("artifact.effectReflectDamage", { percent: effect.percent });
    case "poisonOnHit":
      return poisonOnHitSummary(effect);
    case "lifesteal":
      return t("artifact.effectLifesteal", { percent: effect.percent });
    case "dodgeChance":
      return t("artifact.effectDodgeChance", { chance: effect.chance });
    case "healOnKill":
      return t("artifact.effectHealOnKill", { amount: effect.amount });
    case "autoDamage":
      return autoDamageSummary(effect);
    case "expBoost":
      return t("artifact.effectExpBoost", { percent: effect.percent });
    case "fearResist":
      return t("artifact.effectFearResist", { percent: effect.percent });
    case "cooldownReduction":
      return t("artifact.effectCooldownReduction", { turns: effect.turns });
    case "alwaysHit":
      return t("ability.effectAlwaysHit", { chance: effect.chance });
    case "debuffResist":
      return t("ability.effectDebuffResist", { percent: effect.percent });
    case "curseAggroBoost":
      return t("artifact.effectCurseAggroBoost", { amount: effect.amount });
    default:
      return t("effect.default");
  }
}

export function formatArtifactEffect(artifact: ArtifactDefinition): string {
  return artifact.effects.map(artifactEffectSummary).join(". ") + ".";
}

export type ArtifactSource = "elite" | "boss" | "treasureOrEvent";

export const RARITY_ORDER: ArtifactRarity[] = ["common", "rare", "unique", "epic"];

export interface DepthTierCurve {
  floorsPerStep: number;
  anchorFirstFloor: number;
  tilt: number;
  maxStepsFromAnchor: number;
}

/**
 * Tier odds (weights summing to 100) at floor `depth`, for tiers listed lowest to highest in `order`.
 * The step containing `anchorFirstFloor` uses `anchor`; each step away from it scales tier `i`
 * (lowest 0 …) by `tilt ^ (i × stepsFromAnchor)`, then the result is renormalized — deeper floors
 * shift weight toward the higher tiers, shallower ones toward the lowest. A tier anchored at 0 stays
 * 0 at every depth. `maxStepsFromAnchor` freezes the odds beyond that many steps either way, which
 * also keeps `tilt ** exponent` finite for very deep floors.
 */
export function tierWeightsByDepth<T extends string>(order: readonly T[], anchor: Partial<Record<T, number>>, depth: number, curve: DepthTierCurve): Record<T, number> {
  const { floorsPerStep, anchorFirstFloor, tilt, maxStepsFromAnchor } = curve;
  const rawSteps = Math.floor((depth - 1) / floorsPerStep) - Math.floor((anchorFirstFloor - 1) / floorsPerStep);
  const stepsFromAnchor = Math.max(-maxStepsFromAnchor, Math.min(maxStepsFromAnchor, rawSteps));
  const scaled = order.map((tier, i) => (anchor[tier] ?? 0) * tilt ** (i * stepsFromAnchor));
  const total = scaled.reduce((sum, w) => sum + w, 0);
  return Object.fromEntries(order.map((tier, i) => [tier, (100 * scaled[i]!) / total])) as Record<T, number>;
}

/** Rarity odds (weights summing to 100) for `source` at floor `depth`; see `tierWeightsByDepth`. Elite's Epic is anchored at 0, so it never rolls. */
export function artifactRarityWeights(source: ArtifactSource, depth: number): Record<ArtifactRarity, number> {
  const { anchorWeights, ...curve } = BALANCE.artifacts;
  return tierWeightsByDepth(RARITY_ORDER, anchorWeights[source], depth, curve);
}

/** Fixed odds for the exchange events (Sacrificial Circle, Wandering Hermit) — deliberately not depth-scaled. */
const EXCHANGE_RARITY_WEIGHTS: Record<ArtifactRarity, number> = { common: 50, rare: 30, unique: 15, epic: 5 };

export function rollArtifactRarity(source: ArtifactSource, rng: Rng, depth: number): ArtifactRarity {
  const weights = artifactRarityWeights(source, depth);
  const entries = (Object.entries(weights) as [ArtifactRarity, number][]).filter(([, w]) => w > 0);
  return rng.weightedPick(entries, ([, w]) => w)[0];
}

/** Restricted-source artifacts (§F.4, `restrictedDropSources`) are excluded from the pool unless
    `allowRestrictedSource` names the exact source rolling right now — a bare rarity match isn't
    enough, since more than 1 caller can roll the same rarity table for different reasons (Collapsed
    Floor rolls the "boss" table without being a Boss kill). */
export function pickArtifactOfRarity(rarity: ArtifactRarity, rng: Rng, allowRestrictedSource?: "boss" | "blood-altar"): Id {
  const pool = ARTIFACTS.filter(
    (a) => a.rarity === rarity && (!a.restrictedDropSources || (!!allowRestrictedSource && a.restrictedDropSources.includes(allowRestrictedSource)))
  );
  return rng.pick(pool).id;
}

export function rollArtifact(source: ArtifactSource, rng: Rng, depth: number, allowRestrictedSource?: "boss" | "blood-altar"): Id {
  return pickArtifactOfRarity(rollArtifactRarity(source, rng, depth), rng, allowRestrictedSource);
}

export function rollArtifactWithMinRarity(minRarity: ArtifactRarity, rng: Rng): Id {
  const minIndex = RARITY_ORDER.indexOf(minRarity);
  const weights = EXCHANGE_RARITY_WEIGHTS;
  const entries = (Object.entries(weights) as [ArtifactRarity, number][]).filter(
    ([rarity, w]) => w > 0 && RARITY_ORDER.indexOf(rarity) >= minIndex
  );
  const rarity = rng.weightedPick(entries, ([, w]) => w)[0];
  return pickArtifactOfRarity(rarity, rng);
}

const CURSED_ARTIFACT_IDS = ARTIFACTS.filter((a) => a.isCursed).map((a) => a.id);

export function rollArtifactOrCursed(rng: Rng, depth: number): Id {
  if (rng.chance(0.3)) return rng.pick(CURSED_ARTIFACT_IDS);
  return rollArtifact("treasureOrEvent", rng, depth);
}
