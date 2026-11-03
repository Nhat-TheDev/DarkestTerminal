// The elite/boss difficulty curve and the bot's guard win rate, both reported by `bun run random-play`.
//
// The curve measures one real fight per call, the party using its skills against a single elite or boss.
// Every round starts from the same wounded spread (`WOUNDED`, by party slot), so the two things being
// measured stay apart — damage taken in one round (what the monster does) and the rounds it takes to win
// (how long the monster lasts) — while a monster's rules for the wounded (low-HP targeting, execute
// bonuses) still see a wounded party.
import { CLASSES, getSkill, getEffectiveSkill } from "../../src/data/classes";
import { MONSTER_ARCHETYPES, spawnMonster } from "../../src/data/monsters";
import { BOSS_FLOOR_INTERVAL } from "../../src/data/levelGrowth";
import { FOUNDER_FLOOR_DEPTH } from "../../src/data/endings";
import { createCharacter } from "../../src/engine/party";
import { Rng } from "../../src/engine/rng";
import { startCombat, queueAction, resolveRound, checkSkillUsable, autoResolveTargets, livingTargetableMonsterRefs, livingCharacterRefs, type EngineContext } from "../../src/engine/combat";
import { simulateLevelByDepth } from "../game-editor/calc";
import type { Character, MonsterTier } from "../../src/types";
import type { Finding } from "./checks";

export const PARTIES = [
  ["knight", "mage", "acolyte", "archer"],
  ["viking", "rogue", "plague-doctor", "summoner"],
  ["knight", "ninja", "mage", "rogue"],
];
export const SEEDS = 6;
export const MAX_ROUNDS = 150;
/** Each party slot's HP, as a share of its max, at the start of every round. */
export const WOUNDED = [1, 0.75, 0.5, 0.3];

// The targets live here, not in the docs. Each band rises over the one before it in average damage taken
// per round (as a share of the party's total max HP) and in rounds the party needs to win. The ranges are wide inside a band
// because its members are different monsters (a glass cannon dies sooner than a wall); what the checks below
// pin is the order between bands and between tiers.
//
// The party is class stats at the average level for the depth, no artifacts or abilities. The deepest
// archetypes are marathons in it: monster defense and HP outgrow a level-capped party (06-level-system.md,
// 6.10), which is why their rounds are far above the rest.
export const BANDS = [
  { ids: ["skeleton-guard", "giant-spider"], dpr: { elite: [3.4, 4.8], boss: [3.7, 5.7] }, rounds: { elite: [3.2, 5.4], boss: [4.3, 7.8] } },
  { ids: ["zombie-knight", "orc-chieftain", "vampire-lord"], dpr: { elite: [2.4, 4.1], boss: [3.4, 6.8] }, rounds: { elite: [5.4, 10.2], boss: [8.1, 19.6] } },
  { ids: ["dark-knight", "void-amalgamation", "lich"], dpr: { elite: [2.6, 5.6], boss: [2.9, 6.5] }, rounds: { elite: [4.7, 14.7], boss: [6.8, 29.8] } },
  { ids: ["ancient-golem", "dragon"], dpr: { elite: [3.2, 5.1], boss: [4.6, 14.6] }, rounds: { elite: [8.7, 30.2], boss: [31, 65] } },
  { ids: ["the-founder"], dpr: { boss: [9.7, 13.1] }, rounds: { boss: [43.6, 59] } },
] as const;

const CASES = BANDS.flatMap((band) =>
  band.ids.flatMap((id) => (Object.keys(band.dpr) as MonsterTier[]).map((tier) => [id, tier] as const))
);

/** A boss spends turns charging, buffing and summoning, so its damage per round only has to come close to its elite's; the Lich's boss kit spends the most of them. */
const BOSS_DPR_TOLERANCE = 0.55;
/**
 * A band's mean damage per round may sit this far below the band before it: who a guard hits depends on
 * its `aiPattern`, which moves damage between bands, and band 2's mean sits just under band 1's.
 * Rounds still rise strictly.
 */
const BAND_DPR_TOLERANCE = 0.85;
/** The final boss sits at least this close to the hardest guard on both measures. */
const FOUNDER_TOLERANCE = 0.9;
const MAX_LOSSES_PER_ROW = 1;

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

const curveFinding = (detail: string): Finding => ({ type: "curve", detail });
const bandRows = (rows: Row[], band: (typeof BANDS)[number]) => rows.filter((r) => (band.ids as readonly string[]).includes(r.id));

/** `elitesAtBossDepth`: each guard's elite fought at its boss floor, since Skeleton Guard's first elite floor is several floors above its first boss floor. */
export function findCurveIssues(rows: Row[], elitesAtBossDepth: Row[]): Finding[] {
  const found: Finding[] = [];
  const inRange = (label: string, value: number, [min, max]: readonly number[]) => {
    if (value < min! || value > max!) found.push(curveFinding(`${label} ${value.toFixed(1)} outside ${min}..${max}`));
  };

  for (const band of BANDS) {
    for (const row of bandRows(rows, band)) {
      inRange(`${row.id} ${row.tier} damage share`, row.dpr, (band.dpr as Record<string, readonly number[]>)[row.tier]!);
      inRange(`${row.id} ${row.tier} rounds`, row.rounds, (band.rounds as Record<string, readonly number[]>)[row.tier]!);
    }
  }

  const means = (metric: "dpr" | "rounds") => BANDS.map((band) => mean(bandRows(rows, band).map((r) => r[metric])));
  const [dprMeans, roundMeans] = [means("dpr"), means("rounds")];
  for (let i = 1; i < BANDS.length; i++) {
    if (roundMeans[i]! <= roundMeans[i - 1]!) found.push(curveFinding(`band ${i + 1} mean rounds ${roundMeans[i]!.toFixed(1)} not above band ${i}`));
    if (dprMeans[i]! <= dprMeans[i - 1]! * BAND_DPR_TOLERANCE) found.push(curveFinding(`band ${i + 1} mean damage share ${dprMeans[i]!.toFixed(1)} too far below band ${i}`));
  }

  for (const elite of elitesAtBossDepth) {
    const boss = rows.find((r) => r.id === elite.id && r.tier === "boss");
    if (!boss) continue;
    if (boss.rounds <= elite.rounds) found.push(curveFinding(`${elite.id} boss rounds not above its elite at the same depth`));
    if (boss.dpr < BOSS_DPR_TOLERANCE * elite.dpr) found.push(curveFinding(`${elite.id} boss damage share too far below its elite at the same depth`));
  }

  const founder = rows.find((r) => r.id === "the-founder");
  const guards = rows.filter((r) => r.id !== "the-founder");
  if (founder) {
    for (const metric of ["dpr", "rounds"] as const) {
      if (founder[metric] < FOUNDER_TOLERANCE * Math.max(...guards.map((r) => r[metric]))) found.push(curveFinding(`the final boss is not at the top of the curve for ${metric}`));
    }
  }

  const fights = PARTIES.length * SEEDS;
  for (const row of rows) {
    const losses = Math.round((1 - row.winRate) * fights);
    if (losses > MAX_LOSSES_PER_ROW) found.push(curveFinding(`${row.id} ${row.tier} lost ${losses} of ${fights} simulated fights`));
  }
  return found;
}

export function checkCurve(): { rows: Row[]; findings: Finding[] } {
  const rows = simulateRows(CASES);
  const ids = BANDS.flatMap((band) => band.ids.filter((id) => "elite" in band.dpr));
  const elites = simulateRows(ids.map((id) => [id, "elite", firstDepth(id, "boss")] as const));
  return { rows, findings: findCurveIssues(rows, elites) };
}

export type GuardTier = "elite" | "boss";
export type GuardTally = Record<GuardTier, { fights: number; wins: number }>;

export interface SurvivalTally {
  samples: number;
  /** Sum of the party's highest fear at each sample. */
  fear: number;
  satiety: number;
}

export const FEAR_TARGET = 50;
export const SATIETY_TARGET = 50;
/** The bot must beat this share of a tier's guards; the second rate applies when it missed its fear or satiety target. */
export const GUARD_WIN_RATE = 0.25;
export const GUARD_WIN_RATE_OFF_TARGET = 0.2;
/** Fewer finished fights than this in a tier say nothing about it. */
export const MIN_GUARD_FIGHTS = 5;

export function survivalOnTarget(tally: SurvivalTally): boolean {
  return tally.samples > 0 && tally.fear / tally.samples < FEAR_TARGET && tally.satiety / tally.samples > SATIETY_TARGET;
}

export const requiredGuardWinRate = (onTarget: boolean) => (onTarget ? GUARD_WIN_RATE : GUARD_WIN_RATE_OFF_TARGET);

export function checkGuardWinRate(tally: GuardTally, onTarget: boolean): Finding[] {
  const required = requiredGuardWinRate(onTarget);
  return (Object.keys(tally) as GuardTier[]).flatMap((tier) => {
    const { fights, wins } = tally[tier];
    if (fights < MIN_GUARD_FIGHTS || wins / fights > required) return [];
    return [{ type: "guardWinRate", detail: `${tier} win rate ${wins}/${fights} is not above ${required * 100}%` }];
  });
}
