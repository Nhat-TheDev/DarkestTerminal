import { describe, test, expect } from "bun:test";
import { benchRow, compareToBaseline, findCurveIssues, guardCases, guardFight, quantile, wilson, MAX_ROUNDS, BATCH_PER_TEAM, MIN_GUARD_WIN_RATE, BOSS_HP_LOST_TOLERANCE, FOUNDER_WIN_RATE_SLACK, type BenchRow, type TeamStats } from "../tools/curve/bench";
import { curveComment } from "../tools/curve/comment";
import { TEAMS, type Team } from "../tools/random-play/team";
import { getClass } from "../src/data/classes";
import { FINAL_BOSS_ARCHETYPE, MONSTER_ARCHETYPES } from "../src/data/monsters";
import { BOSS_FLOOR_INTERVAL } from "../src/data/levelGrowth";
import { FOUNDER_FLOOR_DEPTH } from "../src/data/endings";

describe("guard bench statistics", () => {
  test("the Wilson interval stays inside 0..1 and narrows with more fights", () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
    const [low, high] = wilson(50, 100);
    expect(low).toBeCloseTo(0.404, 2);
    expect(high).toBeCloseTo(0.596, 2);
    const [allLow, allHigh] = wilson(100, 100);
    expect(allHigh).toBeCloseTo(1, 9);
    expect(allLow).toBeGreaterThan(0.95);
    const [wideLow, wideHigh] = wilson(5, 10);
    expect(wideHigh - wideLow).toBeGreaterThan(high - low);
  });

  test("quantiles use the nearest rank", () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([5, 1, 3, 2, 4], 0.1)).toBe(1);
    expect(quantile([5, 1, 3, 2, 4], 0.9)).toBe(5);
  });
});

describe("guard bench cases", () => {
  const cases = guardCases();

  test("every case is a guard at or below its own floor's tier, and the final boss is on its floor", () => {
    expect(new Set(cases.map((c) => `${c.id}/${c.tier}/${c.depth}`)).size).toBe(cases.length);
    for (const c of cases) {
      const archetype = MONSTER_ARCHETYPES.find((a) => a.id === c.id)!;
      expect(archetype.roles).toContain(c.tier);
      expect(c.depth).toBeGreaterThanOrEqual(archetype.minFloor ?? 0);
      expect(c.tier).toBe(c.depth % BOSS_FLOOR_INTERVAL === 0 ? "boss" : "elite");
    }
    expect(cases).toContainEqual({ id: FINAL_BOSS_ARCHETYPE.id, tier: "boss", depth: FOUNDER_FLOOR_DEPTH });
  });

  test("a fight ends, stays in range, and replays the same from the same seed", () => {
    const guard = cases[0]!;
    const result = guardFight(guard, TEAMS[0]!, 3, 5);
    expect(result.rounds).toBeGreaterThan(0);
    expect(result.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
    expect(result.hpLost).toBeGreaterThanOrEqual(0);
    expect(result.hpLost).toBeLessThanOrEqual(1);
    expect(result.won && result.timedOut).toBe(false);
    expect(guardFight(guard, TEAMS[0]!, 3, 5)).toEqual(result);
  });

  test("a wiped party counts as a loss, not as a fight that ran out of rounds", () => {
    const result = guardFight({ id: FINAL_BOSS_ARCHETYPE.id, tier: "boss", depth: FOUNDER_FLOOR_DEPTH }, TEAMS[0]!, 1, 1);
    expect(result.won).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.deaths).toBe(TEAMS[0]!.members.length);
  });

  test("a row stops after one batch once precise enough, and at the fight cap otherwise", () => {
    const guard = cases[0]!;
    const teams = TEAMS.slice(0, 1);
    expect(benchRow(guard, { teams, level: "avg", precision: 1, maxFights: 1000 }).fights).toBe(BATCH_PER_TEAM);
    const capped = benchRow(guard, { teams, level: "avg", precision: 0, maxFights: 2 * BATCH_PER_TEAM });
    expect(capped.fights).toBe(2 * BATCH_PER_TEAM);
    expect(capped.teams).toEqual([
      { team: TEAMS[0]!.name, fights: 2 * BATCH_PER_TEAM, winRate: capped.winRate, hpLost: capped.hpLost, deaths: capped.deaths, roundsMedian: capped.roundsMedian },
    ]);
  });

  test("a baseline comparison flags a win rate that moved over 5 points, and a guard only one side holds", () => {
    const row = (id: string, winRate: number): BenchRow => ({
      id, tier: "boss", depth: 5, level: 6, fights: 100, winRate, winLow: 0, winHigh: 1, timedOut: 0,
      roundsP10: 1, roundsMedian: 2, roundsP90: 3, hpLost: 0.1, deaths: 0, mpUsed: 0, itemsUsed: 0, teams: [],
    });
    const changes = compareToBaseline([row("a", 0.9), row("b", 0.5), row("c", 1)], [row("a", 0.88), row("b", 0.6), row("d", 1)]);
    const notable = Object.fromEntries(changes.map((c) => [c.key.split(" ")[0], c.notable]));
    expect(notable).toEqual({ a: false, b: true, c: true, d: true });
    expect(changes.find((c) => c.key.startsWith("b"))!.winRate).toBeCloseTo(-0.1);
  });
});

describe("curve check", () => {
  const row = (id: string, tier: "elite" | "boss", depth: number, fields: Partial<BenchRow> = {}): BenchRow => ({
    id, tier, depth, level: 1, fights: 100, winRate: 0.9, winLow: 0.85, winHigh: 0.95, timedOut: 0,
    roundsP10: 1, roundsMedian: 2, roundsP90: 3, hpLost: 0.3, deaths: 0, mpUsed: 0, itemsUsed: 0, teams: [], ...fields,
  });
  const founder = row(FINAL_BOSS_ARCHETYPE.id, "boss", FOUNDER_FLOOR_DEPTH, { winRate: 0.3, winLow: 0.25, winHigh: 0.35, hpLost: 0.8 });
  const passing = () => [row("a", "elite", 11), row("a", "boss", 15, { hpLost: 0.4 }), founder];

  test("rows that keep every rule and match the baseline pass", () => {
    expect(findCurveIssues(passing(), passing())).toEqual([]);
  });

  test("a guard whose whole interval sits below the minimum win rate fails, one that only reaches into it does not", () => {
    const rows = passing();
    rows[0] = { ...rows[0]!, winRate: MIN_GUARD_WIN_RATE - 0.01, winLow: 0.2, winHigh: MIN_GUARD_WIN_RATE + 0.02 };
    rows[2] = { ...founder, winRate: 0.2 };
    expect(findCurveIssues(rows, rows)).toEqual([]);
    rows[0] = { ...rows[0]!, winHigh: MIN_GUARD_WIN_RATE - 0.01 };
    expect(findCurveIssues(rows, rows)).toEqual([expect.stringContaining("a elite 11 wins")]);
  });

  test("a final boss won far more often than the hardest guard fails, one just above it does not", () => {
    const rows = passing();
    rows[1] = { ...rows[1]!, winRate: 0.3 - FOUNDER_WIN_RATE_SLACK / 2 };
    expect(findCurveIssues(rows, rows)).toEqual([]);
    rows[1] = { ...rows[1]!, winRate: 0.3 - 2 * FOUNDER_WIN_RATE_SLACK };
    expect(findCurveIssues(rows, rows)).toEqual([expect.stringContaining("the final boss wins 30%")]);
  });

  test("a boss taking clearly less HP than its elite on the floors before it fails", () => {
    const rows = passing();
    rows[1] = { ...rows[1]!, hpLost: 0.3 - BOSS_HP_LOST_TOLERANCE / 2 };
    expect(findCurveIssues(rows, rows)).toEqual([]);
    rows[1] = { ...rows[1]!, hpLost: 0.3 - 2 * BOSS_HP_LOST_TOLERANCE };
    expect(findCurveIssues(rows, rows)).toEqual([expect.stringContaining("less than its elite on floor 11")]);
  });

  test("a win rate that moved from the baseline, and a guard only one side holds, fail", () => {
    const rows = passing();
    const baseline = [{ ...rows[0]!, winRate: 0.8 }, rows[2]!, row("b", "elite", 21)];
    expect(findCurveIssues(rows, baseline)).toEqual([
      "a elite 11 win rate moved from 80% to 90% against the baseline",
      "a boss 15 is missing from the baseline",
      "b elite 21 is gone from the baseline",
    ]);
  });
});

describe("curve pull request comment", () => {
  const row = (id: string, winRate: number, team: number = winRate): BenchRow => ({
    id, tier: "boss", depth: 15, level: 1, fights: 100, winRate, winLow: winRate - 0.05, winHigh: winRate + 0.05, timedOut: 0,
    roundsP10: 1, roundsMedian: 10, roundsP90: 20, hpLost: 0.3, deaths: 0, mpUsed: 0, itemsUsed: 0, teams: [{ team: "Bulwark", fights: 100, winRate: team, hpLost: 0.3, deaths: 0, roundsMedian: 10 }],
  });

  test("against a base, it shows each team's figures, every guard that moved, and the check passing", () => {
    const text = curveComment({ label: "`head`", rows: [row("a", 0.9), row("b", 0.5)] }, { label: "`base`", rows: [row("a", 0.88), row("b", 0.7)] }, []);
    expect(text).toContain("**Check: passed** · 2 guards · 200 fights · this PR `head` vs base `base`");
    expect(text).toContain("| All guards | 79.0% → 70.0% (−9.0) | 30% → 30% (±0) | 0.00 → 0.00 (±0.00) | 10 → 10 (±0) | b boss 15 (50%) |");
    expect(text).toContain("| Bulwark | 79.0% → 70.0% (−9.0) | 30% → 30% (±0) | 0.00 → 0.00 (±0.00) | 10 → 10 (±0) | b boss 15 (50%) |");
    expect(text).toContain("### Guards whose win rate moved more than 5 points (1)");
    expect(text).toContain("| b boss 15 | 70% → 50% (−20) | 30% → 30% (±0) | 10 → 10 (±0) |");
  });

  test("without a base, it says so and still lists the failures and the hardest guards", () => {
    const text = curveComment({ label: "`head`", rows: [row("a", 0.9), row("b", 0.2)] }, null, ["b boss 15 wins 20%"]);
    expect(text).toContain("**Check: 1 failure**");
    expect(text).toContain("- b boss 15 wins 20%");
    expect(text).toContain("nothing to compare against");
    expect(text.indexOf("| b boss 15 | 20%")).toBeLessThan(text.indexOf("| a boss 15 | 90%"));
  });

  test("it names each team's members and roles, and shows only the PR's figures a base run did not record", () => {
    const old = (r: BenchRow): BenchRow => ({ ...r, teams: r.teams.map((t) => ({ team: t.team, fights: t.fights, winRate: t.winRate }) as TeamStats) });
    const team: Team = { name: "Bulwark", members: [{ classId: TEAMS[0]!.members[0]!.classId, roles: ["tank", "healer"] }] };
    const text = curveComment({ label: "", rows: [row("a", 0.9)] }, { label: "", rows: [old(row("a", 0.8))] }, [], [team]);
    expect(text).toContain("| Bulwark | 80.0% → 90.0% (+10.0) | 30% | 0.00 | 10 | a boss 15 (90%) |");
    expect(text).toContain(`- **Bulwark**: ${getClass(team.members[0]!.classId).name} (tank, healer)`);
  });
});
