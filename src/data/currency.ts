import type { Monster } from "../types";
import type { Rng } from "../engine/rng";
import { getArchetype } from "./monsters";
import { BALANCE } from "./balanceConfig";

const COIN_DROP_BY_TIER = BALANCE.currency.coinDropByTier;

export function rollCoinDrop(monster: Monster, rng: Rng): number {
  const tierKey = monster.tier === "elite" || monster.tier === "boss" ? monster.tier : getArchetype(monster.archetypeId).powerTier ?? "medium";
  const [min, max] = COIN_DROP_BY_TIER[tierKey];
  return rng.int(min, max);
}
