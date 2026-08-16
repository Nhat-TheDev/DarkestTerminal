import type { MonsterArchetype, Monster, MonsterTier } from "../types";
import monstersJson from "../../data/monsters.json";
import { growthBonusForDepth, EXP_REWARD_DEPTH_RATE, ELITE_MULTIPLIER, BOSS_MULTIPLIER } from "./levelGrowth";

// Design data now lives in ../../data/monsters.json — see
// docs/gameplay-decisions.md §2. spawnMonster() below is behavior (scaling
// formula), not data, so it stays in code.
export const MONSTER_ARCHETYPES = monstersJson as unknown as MonsterArchetype[];

if (MONSTER_ARCHETYPES.length === 0) throw new Error("data/monsters.json: no monster archetypes defined");

export function getArchetype(id: string): MonsterArchetype {
  const found = MONSTER_ARCHETYPES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown monster archetype: ${id}`);
  return found;
}

let monsterCounter = 0;

const TIER_MULTIPLIER = { elite: ELITE_MULTIPLIER, boss: BOSS_MULTIPLIER };
const TIER_NAME_SUFFIX = { elite: " (Tinh Anh)", boss: " (Đại Tướng)" };

/**
 * Spawns a Monster instance from an archetype, scaled by floor depth using
 * the same 5-tier growth curve as character levels (docs/gameplay-
 * decisions.md §6.3/§6.6), but via the uncapped `growthBonusForDepth` (§6.10)
 * since floor depth has no upper limit — depth 1 = base archetype stats, no
 * bonus yet.
 *
 * The floor's guard room (`opts.tier`) is either "elite" (most floors) or
 * "boss" (every BOSS_FLOOR_INTERVAL floors, replacing elite that floor —
 * §6.11); omitted/"normal" = a regular combat-room monster. The elite
 * multiplier is asymmetric — heavy on HP, light on defense (§6.5): a uniform
 * x2 on every stat let boss defense stack high enough to nearly negate all
 * incoming damage at deep floors. Boss uses its own, stronger multiplier
 * (§6.11) instead of a uniform bump on elite.
 */
export function spawnMonster(archetypeId: string, floorDepth: number, opts?: { tier?: MonsterTier }): Monster {
  const archetype = getArchetype(archetypeId);
  const tier: MonsterTier = opts?.tier ?? "normal";
  const multiplier = tier === "elite" || tier === "boss" ? TIER_MULTIPLIER[tier] : undefined;

  const scaledMaxHp = archetype.baseHp + growthBonusForDepth("maxHp", floorDepth);
  const scaledAttack = archetype.baseAttack + growthBonusForDepth("attack", floorDepth);
  const scaledDefense = archetype.baseDefense + growthBonusForDepth("defense", floorDepth);
  const scaledExp = archetype.expReward + Math.floor(floorDepth * EXP_REWARD_DEPTH_RATE);

  const maxHp = multiplier ? Math.round(scaledMaxHp * multiplier.maxHp) : scaledMaxHp;
  monsterCounter += 1;
  return {
    id: `${archetypeId}-${monsterCounter}`,
    archetypeId,
    name: tier === "elite" || tier === "boss" ? `${archetype.name}${TIER_NAME_SUFFIX[tier]}` : archetype.name,
    hp: maxHp,
    maxHp,
    attack: multiplier ? Math.round(scaledAttack * multiplier.attack) : scaledAttack,
    defense: multiplier ? Math.round(scaledDefense * multiplier.defense) : scaledDefense,
    speed: archetype.baseSpeed,
    skillIds: archetype.skillIds,
    tier,
    aiPattern: archetype.aiPattern,
    activeStatusEffects: [],
    expReward: multiplier ? Math.round(scaledExp * multiplier.exp) : scaledExp,
  };
}
