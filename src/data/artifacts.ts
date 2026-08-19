import type { ArtifactDefinition, ArtifactRarity, Id } from "../types";
import artifactsJson from "../../data/artifacts.json";
import type { Rng } from "../engine/rng";

// Design data now lives in ../../data/artifacts.json — see
// docs/gameplay-decisions/07-items-artifacts.md §7.2.
export const ARTIFACTS = artifactsJson as unknown as ArtifactDefinition[];

export function getArtifact(id: Id): ArtifactDefinition {
  const found = ARTIFACTS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown artifact: ${id}`);
  return found;
}

/** Where an artifact drop roll came from — each source has its own rarity weight table (§7.2 "Độ hiếm & tỷ lệ rơi từng bậc"). */
export type ArtifactSource = "elite" | "boss" | "treasureOrEvent";

/** Elite: never Epic. Boss: never Common/Rare. Treasure/Event (not wired up until Đợt 3 — Event room): the original shared table. */
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

/** Uniform pick among every catalog entry of exactly `rarity`. */
export function pickArtifactOfRarity(rarity: ArtifactRarity, rng: Rng): Id {
  const pool = ARTIFACTS.filter((a) => a.rarity === rarity);
  return rng.pick(pool).id;
}

/** Rolls 1 artifact id for `source`: rarity first (per-source table), then uniform among that rarity's catalog entries. */
export function rollArtifact(source: ArtifactSource, rng: Rng): Id {
  return pickArtifactOfRarity(rollArtifactRarity(source, rng), rng);
}

const RARITY_ORDER: ArtifactRarity[] = ["common", "rare", "unique", "epic"];

/**
 * docs/gameplay-decisions/08-events.md §8.9 (Vòng Nghi Lễ) — rolls from the
 * base "treasureOrEvent" rarity table (§7.2), but with every tier below
 * `minRarity` excluded and the remaining weights renormalized proportionally
 * (verified against the doc's per-tier tables: e.g. sacrificing a Rare
 * excludes Common's 50, leaving Rare 30/Unique 15/Epic 5 → 60%/30%/10%,
 * exactly what §8.9 lists).
 */
export function rollArtifactWithMinRarity(minRarity: ArtifactRarity, rng: Rng): Id {
  const minIndex = RARITY_ORDER.indexOf(minRarity);
  const weights = RARITY_WEIGHTS.treasureOrEvent;
  const entries = (Object.entries(weights) as [ArtifactRarity, number][]).filter(
    ([rarity, w]) => w > 0 && RARITY_ORDER.indexOf(rarity) >= minIndex
  );
  const rarity = rng.weightedPick(entries, ([, w]) => w)[0];
  return pickArtifactOfRarity(rarity, rng);
}

/** The 4 Cursed Artifacts (docs/gameplay-decisions/08-events.md §8.6) — every artifact with isCursed:true, regardless of rarity. */
const CURSED_ARTIFACT_IDS = ARTIFACTS.filter((a) => a.isCursed).map((a) => a.id);

/** docs/gameplay-decisions/08-events.md §8.7 (Đền Thờ Nguyền Rủa) — 30% a Cursed Artifact, 70% a normal roll off the base table. */
export function rollArtifactOrCursed(rng: Rng): Id {
  if (rng.chance(0.3)) return rng.pick(CURSED_ARTIFACT_IDS);
  return rollArtifact("treasureOrEvent", rng);
}
