import type { ArtifactDefinition, ArtifactRarity, ArtifactEffect, Id } from "../types";
import artifactsJson from "../../data/artifacts.json";
import type { Rng } from "../engine/rng";

export const ARTIFACTS = artifactsJson as unknown as ArtifactDefinition[];

export function getArtifact(id: Id): ArtifactDefinition {
  const found = ARTIFACTS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown artifact: ${id}`);
  return found;
}

const STAT_LABEL: Record<string, string> = { attack: "attack", defense: "defense", maxHp: "max HP", maxMp: "max MP" };

function artifactEffectSummary(effect: ArtifactEffect): string {
  switch (effect.kind) {
    case "statBoost":
      return `${effect.amount >= 0 ? "+" : ""}${effect.amount} ${STAT_LABEL[effect.stat]}`;
    case "reflectDamage":
      return `Reflects ${effect.percent}% of damage taken back to the attacker`;
    case "poisonOnHit":
      return `${effect.chance}% chance to inflict Poisoned on hit`;
    case "lifesteal":
      return `Heals ${effect.percent}% of damage dealt`;
    case "dodgeChance":
      return `${effect.chance}% chance to fully dodge an attack`;
    case "healOnKill":
      return `Heals ${effect.amount} HP on defeating a target`;
    case "autoDamage":
      return `Deals ${effect.amount} fixed damage to 1 random enemy at the start of each round`;
    case "expBoost":
      return `+${effect.percent}% EXP gained for the party`;
    case "fearResist":
      return `-${effect.percent}% fear accumulated`;
    case "cooldownReduction":
      return `-${effect.turns} turn skill cooldown`;
    case "survivalDrainReduction":
      return `-${effect.percent}% hunger/thirst drain rate`;
    case "curseAggroBoost":
      return `+${effect.amount} aggro`;
    case "curseDrainBoost":
      return `+${effect.percent}% hunger/thirst drain rate`;
    default:
      return "Special effect";
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
