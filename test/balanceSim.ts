// Shared by test/elite-boss-balance.test.ts and the tuning scripts: one real fight per call, the party
// using its skills against a single elite or boss. Every round starts from the same wounded spread
// (`WOUNDED`, by party slot), so the two things being measured stay apart — damage taken in one round
// (what the monster does) and the rounds it takes to win (how long the monster lasts) — while a
// monster's rules for the wounded (low-HP targeting, execute bonuses) still see a wounded party.
import { CLASSES, getSkill, getEffectiveSkill } from "../src/data/classes";
import { MONSTER_ARCHETYPES, spawnMonster } from "../src/data/monsters";
import { BOSS_FLOOR_INTERVAL } from "../src/data/levelGrowth";
import { FOUNDER_FLOOR_DEPTH } from "../src/data/endings";
import { createCharacter } from "../src/engine/party";
import { Rng } from "../src/engine/rng";
import { startCombat, queueAction, resolveRound, checkSkillUsable, autoResolveTargets, livingTargetableMonsterRefs, livingCharacterRefs, type EngineContext } from "../src/engine/combat";
import { simulateLevelByDepth } from "../tools/game-editor/calc";
import type { Character, MonsterTier } from "../src/types";

export const PARTIES = [
  ["vanguard", "mage", "acolyte", "archer"],
  ["viking", "rogue", "plague-doctor", "summoner"],
  ["vanguard", "ninja", "mage", "rogue"],
];
export const SEEDS = 6;
export const MAX_ROUNDS = 150;
/** Each party slot's HP, as a share of its max, at the start of every round. */
export const WOUNDED = [1, 0.75, 0.5, 0.3];

const levelByDepth = simulateLevelByDepth(20, FOUNDER_FLOOR_DEPTH);
export const levelAt = (depth: number) => levelByDepth[depth - 1]!.avgLevel;

/** The first depth an archetype appears at as `tier`: elites fill the floors between boss floors. */
export function firstDepth(id: string, tier: MonsterTier): number {
  const archetype = MONSTER_ARCHETYPES.find((a) => a.id === id)!;
  if (archetype.finalBoss) return FOUNDER_FLOOR_DEPTH;
  let depth = Math.max(1, archetype.minFloor ?? 0);
  if (tier === "boss") while (depth % BOSS_FLOOR_INTERVAL !== 0) depth++;
  else while (depth % BOSS_FLOOR_INTERVAL === 0) depth++;
  return depth;
}

export interface FightResult {
  dprPercent: number;
  rounds: number;
  won: boolean;
}

function restoreWounded(party: Character[]): void {
  party.forEach((c, i) => {
    c.hp = Math.max(1, Math.round(c.maxHp * WOUNDED[i % WOUNDED.length]!));
    c.isAlive = true;
  });
}

/** One fight: every character uses its heaviest ready damaging skill on the monster; no heals or items, since every round starts from the same wounded spread. */
export function fight(id: string, tier: MonsterTier, partyIds: string[], seed: number, atDepth?: number): FightResult {
  const depth = atDepth ?? firstDepth(id, tier);
  const level = levelAt(depth);
  const party: Character[] = partyIds.map((classId, i) => createCharacter(`p${i + 1}`, classId, CLASSES.find((c) => c.id === classId)!, level));
  const boss = spawnMonster(id, depth, { tier });
  const ctx: EngineContext = { party, monsters: [boss], summons: [], rng: new Rng(seed), inventory: {} };
  const combat = startCombat("r1", [boss.id], ctx, tier === "boss");
  const totalMaxHp = party.reduce((sum, c) => sum + c.maxHp, 0);
  restoreWounded(party);

  let shareSum = 0;
  let rounds = 0;
  while (combat.phase !== "over" && rounds < MAX_ROUNDS) {
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const actor = party.find((c) => c.id === ref.id)!;
      const usable = actor.unlockedSkillIds
        .map((skillId) => getEffectiveSkill(getSkill(skillId), actor.level))
        .filter((s) => (s.target === "singleEnemy" || s.target === "allEnemies") && checkSkillUsable(actor, s) === null);
      // The heaviest ready skill: the longest cooldown first (an ultimate, a crowd-control skill), then the higher slot.
      const skill = usable.reduce<(typeof usable)[number] | undefined>(
        (best, s) => (!best || (s.cooldownTurns ?? 0) > (best.cooldownTurns ?? 0) || ((s.cooldownTurns ?? 0) === (best.cooldownTurns ?? 0) && s.slot > best.slot) ? s : best),
        undefined
      );
      if (!skill) continue;
      const reachable = livingTargetableMonsterRefs(combat, ctx);
      const targets =
        skill.target === "allEnemies"
          ? (autoResolveTargets("allEnemies", ref, combat, ctx) ?? [])
          : reachable.filter((r) => r.id === boss.id).concat(reachable).slice(0, 1);
      if (targets.length === 0) continue;
      queueAction(combat, ref, skill.id, targets, ctx);
    }
    const before = party.reduce((sum, c) => sum + c.hp, 0);
    resolveRound(combat, ctx, depth);
    shareSum += Math.max(0, before - party.reduce((sum, c) => sum + c.hp, 0)) / totalMaxHp;
    rounds += 1;
    restoreWounded(party);
  }
  return { dprPercent: (shareSum / Math.max(1, rounds)) * 100, rounds, won: combat.outcome === "victory" };
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

export interface Row {
  id: string;
  tier: MonsterTier;
  depth: number;
  level: number;
  dpr: number;
  rounds: number;
  winRate: number;
}

/** Every row for the given (archetype, tier) pairs, each at its first depth unless one is given: the mean over all parties and seeds. */
export function simulateRows(cases: readonly (readonly [string, MonsterTier, number?])[]): Row[] {
  return cases.map(([id, tier, atDepth]) => {
    const depth = atDepth ?? firstDepth(id, tier);
    const results: FightResult[] = [];
    for (const party of PARTIES) for (let seed = 1; seed <= SEEDS; seed++) results.push(fight(id, tier, party, seed, depth));
    return {
      id,
      tier,
      depth,
      level: levelAt(depth),
      dpr: mean(results.map((r) => r.dprPercent)),
      // A fight that hits the cap counts as the cap: the monster outlasted it.
      rounds: mean(results.map((r) => (r.won ? r.rounds : MAX_ROUNDS))),
      winRate: results.filter((r) => r.won).length / results.length,
    };
  });
}
