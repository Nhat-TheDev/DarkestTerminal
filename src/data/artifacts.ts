import type { ArtifactDefinition, ArtifactRarity, ArtifactEffect, Id } from "../types";
import artifactsJson from "../../data/artifacts.json";
import type { Rng } from "../engine/rng";
import { t } from "./strings";
import { signed } from "./items";

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
};

function artifactEffectSummary(effect: ArtifactEffect): string {
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

const RARITY_WEIGHTS: Record<ArtifactSource, Record<ArtifactRarity, number>> = {
  elite: { common: 55, rare: 35, unique: 10, epic: 0 },
  boss: { common: 0, rare: 0, unique: 65, epic: 35 },
  treasureOrEvent: { common: 50, rare: 30, unique: 15, epic: 5 },
};

export function rollArtifactRarity(source: ArtifactSource, rng: Rng): ArtifactRarity {
  const weights = RARITY_WEIGHTS[source];
  const entries = (Object.entries(weights) as [ArtifactRarity, number][]).filter(([, w]) => w > 0);
  return rng.weightedPick(entries, ([, w]) => w)[0];
}

export function pickArtifactOfRarity(rarity: ArtifactRarity, rng: Rng): Id {
  const pool = ARTIFACTS.filter((a) => a.rarity === rarity);
  return rng.pick(pool).id;
}

export function rollArtifact(source: ArtifactSource, rng: Rng): Id {
  return pickArtifactOfRarity(rollArtifactRarity(source, rng), rng);
}

const RARITY_ORDER: ArtifactRarity[] = ["common", "rare", "unique", "epic"];

export function rollArtifactWithMinRarity(minRarity: ArtifactRarity, rng: Rng): Id {
  const minIndex = RARITY_ORDER.indexOf(minRarity);
  const weights = RARITY_WEIGHTS.treasureOrEvent;
  const entries = (Object.entries(weights) as [ArtifactRarity, number][]).filter(
    ([rarity, w]) => w > 0 && RARITY_ORDER.indexOf(rarity) >= minIndex
  );
  const rarity = rng.weightedPick(entries, ([, w]) => w)[0];
  return pickArtifactOfRarity(rarity, rng);
}

const CURSED_ARTIFACT_IDS = ARTIFACTS.filter((a) => a.isCursed).map((a) => a.id);

export function rollArtifactOrCursed(rng: Rng): Id {
  if (rng.chance(0.3)) return rng.pick(CURSED_ARTIFACT_IDS);
  return rollArtifact("treasureOrEvent", rng);
}
