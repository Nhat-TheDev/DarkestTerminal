// Real guard fights run straight on the engine: the party starts at full HP with its starting items and
// plays each round through a team's policy, so heals, items, fear and telegraphs all count. Seeds are fixed,
// so two runs on the same data give the same numbers and a run after a data change differs only by that change.
import { Game } from "../../src/engine/game";
import { enterRoom } from "../../src/engine/dungeon";
import { channelStatus } from "../../src/engine/combat";
import { FINAL_BOSS_ARCHETYPE, GUARD_ROOM_ARCHETYPES, spawnMonster } from "../../src/data/monsters";
import { BOSS_FLOOR_INTERVAL } from "../../src/data/levelGrowth";
import { FOUNDER_FLOOR_DEPTH } from "../../src/data/endings";
import type { Character, Id, MonsterTier } from "../../src/types";
import { applyDump } from "../dev-save-dump/applyDump";
import { newFightMemory, planTurn, type Team } from "../random-play/team";
import { GUARD_FLOORS } from "../random-play/bot";
import { firstDepth, levelByDepth } from "../random-play/curve";

export type LevelPick = "min" | "avg" | "max";
export type GuardTier = Extract<MonsterTier, "elite" | "boss">;

export interface GuardCase {
  id: Id;
  tier: GuardTier;
  depth: number;
}

/** A fight still going after this many rounds counts as lost and is reported apart. */
export const MAX_ROUNDS = 300;
/** Fights per team added in each batch. */
export const BATCH_PER_TEAM = 20;
/** Two runs of one case differ noticeably once their win rates are further apart than this. */
export const NOTABLE_WIN_RATE_CHANGE = 0.05;
const Z_95 = 1.96;

const tierAt = (depth: number): GuardTier => (depth % BOSS_FLOOR_INTERVAL === 0 ? "boss" : "elite");

/** Every guard on every start floor it can stand on, its first floor at each tier, and the final boss. */
export function guardCases(): GuardCase[] {
  const cases = new Map<string, GuardCase>();
  const add = (id: Id, tier: GuardTier, depth: number) => cases.set(`${id}/${tier}/${depth}`, { id, tier, depth });
  for (const archetype of GUARD_ROOM_ARCHETYPES) {
    for (const tier of ["elite", "boss"] as const) add(archetype.id, tier, firstDepth(archetype.id, tier));
    for (const depth of GUARD_FLOORS) if ((archetype.minFloor ?? 0) <= depth) add(archetype.id, tierAt(depth), depth);
  }
  add(FINAL_BOSS_ARCHETYPE.id, "boss", FOUNDER_FLOOR_DEPTH);
  return [...cases.values()].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id) || a.tier.localeCompare(b.tier));
}

export function levelFor(depth: number, pick: LevelPick): number {
  const row = levelByDepth[depth - 1]!;
  return Math.round(pick === "min" ? row.minLevel : pick === "max" ? row.maxLevel : row.avgLevel);
}

export interface FightResult {
  won: boolean;
  timedOut: boolean;
  rounds: number;
  /** Share of the party's max HP gone at the end, dead members counted as empty. */
  hpLost: number;
  deaths: number;
  /** Share of the party's MP spent. */
  mpUsed: number;
  itemsUsed: number;
}

const sum = (party: Character[], value: (c: Character) => number) => party.reduce((total, c) => total + value(c), 0);
const itemCount = (inventory: Record<Id, number>) => Object.values(inventory).reduce((a, b) => a + b, 0);

export function guardFight(guard: GuardCase, team: Team, seed: number, level: number): FightResult {
  const game = new Game(seed, team.members.map((m) => m.classId), undefined, team.members.map(() => null), false);
  applyDump(game, { level, floorDepth: guard.depth, roomArg: "entry" });
  game.state.combat = null;
  const room = game.state.floor.rooms.find((r) => r.type === "boss")!;
  const monster = spawnMonster(guard.id, guard.depth, { tier: guard.tier });
  game.ctx.monsters.push(monster);
  room.monsterIds = [monster.id];
  game.state.currentRoomId = room.id;
  game.state.roomPath = [game.state.floor.entryRoomId, room.id];
  enterRoom(game.state, room, game.ctx);
  // Read through a function: assigning null above would otherwise narrow `combat` for the rest of this body.
  const combat = () => game.state.combat;

  const party = game.state.party;
  const rolesOf = new Map(team.members.map((m) => [m.classId, m.roles]));
  const maxHp = sum(party, (c) => c.maxHp);
  const maxMp = sum(party, (c) => c.maxMp);
  const itemsBefore = itemCount(game.state.inventory);
  const memory = newFightMemory();
  let rounds = 0;
  while (combat() && !combat()!.outcome && rounds < MAX_ROUNDS) {
    for (const ref of game.livingCharactersNeedingAction()) {
      const actor = party.find((c) => c.id === ref.id)!;
      if (channelStatus(actor)) {
        game.holdChannel(ref);
        continue;
      }
      const turn = planTurn(game, actor, rolesOf.get(actor.classId) ?? ["striker"], memory);
      const source = turn.kind === "skill" ? turn.skill : turn.item;
      const targets = turn.target ? [turn.target] : (game.autoTargets(source.target, ref) ?? [ref]);
      const err = turn.kind === "skill" ? game.queue(ref, turn.skill.id, targets) : game.queueItem(ref, turn.item.id, targets);
      if (err) game.queue(ref, actor.unlockedSkillIds[0]!, game.livingEnemyRefs().slice(0, 1));
    }
    if (!game.readyToResolve()) break;
    game.resolve();
    rounds++;
  }
  const won = combat()?.outcome === "victory";
  // A wipe ends the fight by clearing `combat` (Game.triggerDefeat), so defeat is read from `gameOver`.
  const lost = game.state.gameOver === "defeat";
  return {
    won,
    timedOut: !won && !lost,
    rounds,
    hpLost: 1 - sum(party, (c) => Math.max(0, c.hp)) / maxHp,
    deaths: party.filter((c) => !c.isAlive).length,
    mpUsed: maxMp === 0 ? 0 : 1 - sum(party, (c) => c.mp) / maxMp,
    itemsUsed: itemsBefore - itemCount(game.state.inventory),
  };
}

/** The 95% Wilson interval for `wins` out of `n`. */
export function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const p = wins / n;
  const z2 = Z_95 * Z_95;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Nearest-rank quantile of `values`, which it sorts in place. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(q * values.length) - 1))]!;
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

export interface TeamStats {
  team: string;
  fights: number;
  winRate: number;
  hpLost: number;
  deaths: number;
  /** Median rounds of this team's fights won. */
  roundsMedian: number;
}

export interface BenchRow extends GuardCase {
  level: number;
  fights: number;
  winRate: number;
  winLow: number;
  winHigh: number;
  timedOut: number;
  /** Rounds of the fights won. */
  roundsP10: number;
  roundsMedian: number;
  roundsP90: number;
  hpLost: number;
  deaths: number;
  mpUsed: number;
  itemsUsed: number;
  teams: TeamStats[];
}

export interface BenchOptions {
  teams: Team[];
  level: LevelPick;
  /** Stop once the win rate's 95% interval is this narrow on each side. */
  precision: number;
  maxFights: number;
}

export function benchRow(guard: GuardCase, options: BenchOptions): BenchRow {
  const level = levelFor(guard.depth, options.level);
  const results = new Map<string, FightResult[]>(options.teams.map((t) => [t.name, []]));
  let fights = 0;
  let wins = 0;
  for (let batch = 0; ; batch++) {
    for (const team of options.teams) {
      for (let i = 0; i < BATCH_PER_TEAM; i++) {
        const result = guardFight(guard, team, batch * BATCH_PER_TEAM + i + 1, level);
        results.get(team.name)!.push(result);
        fights++;
        if (result.won) wins++;
      }
    }
    const [low, high] = wilson(wins, fights);
    if ((high - low) / 2 <= options.precision || fights + options.teams.length * BATCH_PER_TEAM > options.maxFights) break;
  }

  const all = [...results.values()].flat();
  const wonRounds = all.filter((r) => r.won).map((r) => r.rounds);
  const [winLow, winHigh] = wilson(wins, fights);
  return {
    ...guard,
    level,
    fights,
    winRate: wins / fights,
    winLow,
    winHigh,
    timedOut: all.filter((r) => r.timedOut).length,
    roundsP10: quantile([...wonRounds], 0.1),
    roundsMedian: quantile([...wonRounds], 0.5),
    roundsP90: quantile([...wonRounds], 0.9),
    hpLost: mean(all.map((r) => r.hpLost)),
    deaths: mean(all.map((r) => r.deaths)),
    mpUsed: mean(all.map((r) => r.mpUsed)),
    itemsUsed: mean(all.map((r) => r.itemsUsed)),
    teams: [...results].map(([team, rs]) => ({
      team,
      fights: rs.length,
      winRate: rs.filter((r) => r.won).length / rs.length,
      hpLost: mean(rs.map((r) => r.hpLost)),
      deaths: mean(rs.map((r) => r.deaths)),
      roundsMedian: quantile(rs.filter((r) => r.won).map((r) => r.rounds), 0.5),
    })),
  };
}

export interface RowChange {
  key: string;
  now: BenchRow | null;
  before: BenchRow | null;
  winRate: number;
  hpLost: number;
  roundsMedian: number;
  notable: boolean;
}

export const rowKey = (row: GuardCase) => `${row.id} ${row.tier} ${row.depth}`;

/** Each case of either run against the other; a case only one run holds is notable. */
export function compareToBaseline(now: BenchRow[], before: BenchRow[]): RowChange[] {
  const keys = [...new Set([...now, ...before].map(rowKey))];
  return keys.map((key) => {
    const a = now.find((r) => rowKey(r) === key) ?? null;
    const b = before.find((r) => rowKey(r) === key) ?? null;
    const delta = (field: "winRate" | "hpLost" | "roundsMedian") => (a && b ? a[field] - b[field] : 0);
    return {
      key,
      now: a,
      before: b,
      winRate: delta("winRate"),
      hpLost: delta("hpLost"),
      roundsMedian: delta("roundsMedian"),
      notable: !a || !b || Math.abs(delta("winRate")) > NOTABLE_WIN_RATE_CHANGE,
    };
  });
}

/** A guard fails once its whole 95% interval sits below this win rate. */
export const MIN_GUARD_WIN_RATE = 0.25;
/** The final boss may be won this much more often than the hardest guard before it fails. */
export const FOUNDER_WIN_RATE_SLACK = 0.2;
/** A boss may take this much less of the party's HP than its elite on the floors just before it. */
export const BOSS_HP_LOST_TOLERANCE = 0.02;

/** What `bun run curve --check` fails on: the design rules on `rows`, then every notable change from `baseline`. */
export function findCurveIssues(rows: BenchRow[], baseline: BenchRow[]): string[] {
  const found: string[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  for (const row of rows) {
    if (row.winHigh < MIN_GUARD_WIN_RATE) found.push(`${rowKey(row)} wins ${pct(row.winRate)}, its interval below ${pct(MIN_GUARD_WIN_RATE)}`);
  }

  const founder = rows.find((r) => r.id === FINAL_BOSS_ARCHETYPE.id);
  const hardest = rows.filter((r) => r !== founder).sort((a, b) => a.winRate - b.winRate)[0];
  if (founder && hardest && founder.winRate > hardest.winRate + FOUNDER_WIN_RATE_SLACK) {
    found.push(`the final boss wins ${pct(founder.winRate)}, more than ${pct(FOUNDER_WIN_RATE_SLACK)} above the hardest guard (${rowKey(hardest)}, ${pct(hardest.winRate)})`);
  }

  for (const boss of rows.filter((r) => r.tier === "boss")) {
    const elite = rows
      .filter((r) => r.id === boss.id && r.tier === "elite" && r.depth < boss.depth && boss.depth - r.depth < BOSS_FLOOR_INTERVAL)
      .sort((a, b) => b.depth - a.depth)[0];
    if (elite && boss.hpLost < elite.hpLost - BOSS_HP_LOST_TOLERANCE) {
      found.push(`${rowKey(boss)} takes ${pct(boss.hpLost)} of the party's HP, less than its elite on floor ${elite.depth} (${pct(elite.hpLost)})`);
    }
  }

  for (const change of compareToBaseline(rows, baseline).filter((c) => c.notable)) {
    if (!change.now || !change.before) found.push(`${change.key} is ${change.now ? "missing from" : "gone from"} the baseline`);
    else found.push(`${change.key} win rate moved from ${pct(change.before.winRate)} to ${pct(change.now.winRate)} against the baseline`);
  }
  return found;
}
