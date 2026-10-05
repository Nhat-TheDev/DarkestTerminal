import type { GeneratorSpec } from "../types";
import { basicAttacks } from "./basicAttacks";
import { classSkills } from "./classSkills";
import { abilities } from "./abilities";
import { artifacts } from "./artifacts";
import { balancePoints, classStats } from "./classStats";
import { coinDropByTier } from "./coinDropByTier";
import { eventTiers } from "./eventTiers";
import { gamblingRounds } from "./gamblingRounds";
import { map } from "./map";
import { deathBursts, minionSkills, minions } from "./minions";
import { monsterSkills, monsterTypeWeights } from "./monsters";
import { passives } from "./passives";
import { rarityOdds } from "./rarityOdds";
import { shopOdds } from "./shopOdds";
import { statusEffects } from "./statusEffects";

/** Every generator a `docs:begin` marker can name. */
export const REGISTRY: Readonly<Record<string, GeneratorSpec>> = { abilities, artifacts, balancePoints, basicAttacks, classSkills, classStats, coinDropByTier, deathBursts, eventTiers, gamblingRounds, map, minionSkills, minions, monsterSkills, monsterTypeWeights, passives, rarityOdds, shopOdds, statusEffects };
