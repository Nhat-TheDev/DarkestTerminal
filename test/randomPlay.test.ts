import { describe, test, expect } from "bun:test";
import { Game } from "../src/engine/game";
import {
  findTextLeaks,
  findLongDecimals,
  findInvariantViolations,
  footerText,
  parseFooter,
  classifyKeyEffect,
  findFooterIssues,
  findLayoutIssues,
} from "../tools/random-play/checks";
import { spansToHtml, summarizeRuns } from "../tools/random-play/report";
import { playRun, loopBreakKey, hasLeftFloor, GUARD_FLOORS, type RunStats } from "../tools/random-play/bot";
import { BANDS, checkGuardWinRate, findCurveIssues, survivalOnTarget, type GuardTally, type Row } from "../tools/random-play/curve";
import { TEAMS, FEAR_ACT_AT, chooseRest, chooseRoom, planTurn, type TurnPlan } from "../tools/random-play/team";
import { getRoom } from "../src/engine/dungeon";
import { BOSS_FLOOR_INTERVAL } from "../src/data/levelGrowth";
import type { Character, Room } from "../src/types";
import { Rng } from "../src/engine/rng";
import { CLASSES, getEffectiveSkill, getSkill } from "../src/data/classes";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FOOTER = "[1-2] Action   │   [b] Party   [l] Log   [q] Save   [s] Quicksave   [Ctrl+C] Quit";

describe("random-play checks", () => {
  test("text leaks catch raw ANSI, NaN and unfilled templates, not ordinary text", () => {
    expect(findTextLeaks("│HP 40/40  Fear 2.5│")).toEqual([]);
    expect(findTextLeaks("│Knight [31mLv.1[0m│").map((f) => f.detail)).toEqual([expect.stringContaining("raw ANSI color code")]);
    expect(findTextLeaks("│HP NaN/40│")[0]!.detail).toContain("NaN");
    expect(findTextLeaks("│Entered {{room}}│")[0]!.detail).toContain("template");
  });

  test("long decimals are flagged, one-decimal fear is not", () => {
    expect(findLongDecimals("Fear 12.5")).toEqual([]);
    expect(findLongDecimals("Fear 12.300000001")).toHaveLength(1);
  });

  test("a fresh run breaks no invariant", () => {
    const game = new Game(7);
    expect(findInvariantViolations(game.state, game.ctx)).toEqual([]);
  });

  test("invariants catch duplicate summon ids, an open combat after defeat and NaN stats", () => {
    const game = new Game(7);
    const summon = { id: "s1", hp: 10, maxHp: 10, attack: 1, defense: 1, magicPower: 1, speed: 1 };
    game.ctx.summons.push({ ...summon } as never, { ...summon } as never);
    game.state.gameOver = "defeat";
    game.state.party[0]!.attack = Number.NaN;
    const details = findInvariantViolations(game.state, game.ctx).map((f) => f.detail);
    expect(details).toContain("two summons share an id");
    expect(details).toContain("character.attack is NaN");
    expect(game.state.combat).not.toBeNull(); // seed 7 opens on an entry-room ambush
    expect(details).toContain("run is over but a combat is still open");
  });

  test("footer is read from the rows below the last panel and parsed into pressable keys", () => {
    const frame = ["┌─Log──┐", "│ x    │", "└──────┘", FOOTER, "", ""].join("\n");
    expect(footerText(frame)).toBe(FOOTER);
    const footer = parseFooter(FOOTER);
    expect([...footer.digits]).toEqual([1, 2]);
    expect(footer.keys).toEqual(expect.arrayContaining(["1", "2", "b", "l", "q", "s"]));
    expect(footer.keys).not.toContain("Ctrl+C");
    expect(parseFooter("[Enter] Continue   [Esc] Back   [←/→] Page").keys).toEqual(["RETURN", "ESCAPE", "ARROW_LEFT", "ARROW_RIGHT"]);
  });

  test("a footer pushed off screen or cut short is reported", () => {
    expect(findFooterIssues(parseFooter(""))[0]!.type).toBe("missingFooter");
    expect(findFooterIssues(parseFooter("[1-2] Action   │   [b] Party   [l] Lo")).map((f) => f.type)).toEqual(["footerTruncated"]);
    expect(findFooterIssues(parseFooter("[1-2] Action   │   [Ctrl+C] Quit   [")).map((f) => f.type)).toEqual(["footerTruncated"]);
    expect(findFooterIssues(parseFooter(FOOTER))).toEqual([]);
  });

  test("an advertised key that changes nothing is dead; an unadvertised digit that acts is hidden", () => {
    const footer = parseFooter(FOOTER);
    const still = { frameChanged: false, uiChanged: false, stateChanged: false, saveWritten: false };
    const types = (r: ReturnType<typeof classifyKeyEffect>) => ({ failures: r.failures.map((f) => f.type), warnings: r.warnings.map((f) => f.type) });
    expect(types(classifyKeyEffect({ key: "l", advertised: true, ...still }, footer))).toEqual({ failures: ["deadKey"], warnings: [] });
    expect(types(classifyKeyEffect({ key: "1", advertised: true, ...still }, footer))).toEqual({ failures: [], warnings: ["deadKey"] });
    expect(types(classifyKeyEffect({ key: "1", advertised: true, ...still, frameChanged: true }, footer))).toEqual({ failures: [], warnings: [] });
    expect(types(classifyKeyEffect({ key: "s", advertised: true, ...still, saveWritten: true }, footer))).toEqual({ failures: [], warnings: ["noFeedback"] });
    expect(types(classifyKeyEffect({ key: "3", advertised: false, ...still, stateChanged: true }, footer))).toEqual({ failures: ["hiddenKey"], warnings: [] });
    expect(types(classifyKeyEffect({ key: "3", advertised: false, ...still, frameChanged: true }, footer))).toEqual({ failures: [], warnings: [] });
  });

  test("layout reports a missing panel and a main panel with no rows", () => {
    const req = { panelTitles: ["Path", "Dungeon"], mainPanelTitle: "Dungeon", minMainRows: 1 };
    expect(findLayoutIssues("┌─Path──┐\n└───────┘", req).failures.map((f) => f.detail)).toEqual(['panel "Dungeon" is not on screen']);
    const squeezed = "┌─Path──┐┌─Dungeon──┐\n└───────┘└──────────┘";
    expect(findLayoutIssues(squeezed, req).failures[0]!.detail).toContain("0 content rows");
    const ok = "┌─Path──┐┌─Dungeon──┐\n│       ││ [1] Fight│\n└───────┘└──────────┘";
    const result = findLayoutIssues(ok, req);
    expect(result.failures).toEqual([]);
    expect(result.warnings.map((w) => w.type)).toEqual(["possibleClip"]);
  });
});

describe("random-play report", () => {
  test("a captured frame keeps its colours and escapes markup", () => {
    const html = spansToHtml({
      cols: 6,
      rows: 1,
      lines: [[{ text: "<b>&", fg: [255, 0, 0, 255], bg: [0, 0, 0, 0], attributes: 0 }, { text: "ok", fg: [0, 255, 0, 255], bg: [10, 20, 30, 255], attributes: 0 }]],
    });
    expect(html).toContain("&lt;b&gt;&amp;");
    expect(html).toContain("color:rgba(255,0,0,1.00)");
    expect(html).toContain("background:rgba(10,20,30,1.00)");
    expect(html).not.toContain("background:rgba(0,0,0,0.00)");
  });
});

describe("random-play bot", () => {
  test("plays a short run end to end and collects a gallery", async () => {
    const result = await playRun({ gameSeed: 1, botSeed: 7920, maxSteps: 200, team: TEAMS[0]! });
    expect(result.steps).toBeGreaterThan(50);
    expect(result.gallery.length).toBeGreaterThan(3);
    expect(result.gallery.every((g) => g.size.endsWith("x70"))).toBe(true);
    expect(result.failures).toEqual([]);
  }, 30000);

  test("a run counts as finished once the party leaves the floor it started on", () => {
    const game = new Game(7);
    expect(hasLeftFloor(game, 1)).toBe(false);
    game.advanceToNextFloor();
    expect(hasLeftFloor(game, 1)).toBe(true);
  });

  test("a looping bot backs out of submenus and favours progress keys, but never leaves the footer", () => {
    const rng = new Rng(1);
    const count = (footer: string, n = 2000) => {
      const info = parseFooter(footer);
      const tally: Record<string, number> = {};
      for (let i = 0; i < n; i++) {
        const key = loopBreakKey(rng, info);
        tally[key] = (tally[key] ?? 0) + 1;
      }
      return tally;
    };
    const submenu = count("[1-3] Tab   [Esc] Back   │   [b] Party   [l] Log   [q] Save   [s] Quicksave");
    expect(submenu.ESCAPE!).toBeGreaterThan(900);
    const room = count(FOOTER);
    expect(Object.keys(room).sort()).toEqual(["1", "2", "b", "l", "q", "s"]);
    // Each digit is 8x as likely as each global key, so the two digits take 16 of every 20 presses.
    expect(room["1"]! + room["2"]!).toBeGreaterThan(1400);
    // With nothing but global keys on offer it still only presses those, so a screen where no key acts still runs into softLock.
    expect(Object.keys(count("[b] Party   [l] Log")).sort()).toEqual(["b", "l"]);
  });
});

describe("random-play curve", () => {
  const row = (id: string, tier: "elite" | "boss", dpr: number, rounds: number, winRate = 1): Row => ({ id, tier, depth: 1, level: 1, dpr, rounds, winRate });
  const inBand = () => BANDS.flatMap((band) => band.ids.flatMap((id) => Object.keys(band.dpr).map((tier) => {
    const t = tier as "elite" | "boss";
    const range = (r: Record<string, readonly number[]>) => (r[t]![0]! + r[t]![1]!) / 2;
    return row(id, t, range(band.dpr), range(band.rounds));
  })));
  const details = (rows: Row[]) => findCurveIssues(rows, []).map((f) => f.detail);

  test("a monster outside its band, or one losing too many fights, is reported", () => {
    const rows = inBand();
    rows[0]!.dpr = 99;
    rows[1]!.winRate = 0.5;
    expect(details(rows).some((d) => d.includes(`${rows[0]!.id} ${rows[0]!.tier} damage share`))).toBe(true);
    expect(details(rows).some((d) => d.includes("simulated fights"))).toBe(true);
  });

  test("a boss that does not outlast its elite at the same depth is reported", () => {
    const rows = inBand();
    const boss = rows.find((r) => r.tier === "boss")!;
    expect(findCurveIssues(rows, [{ ...boss, tier: "elite", rounds: boss.rounds + 1 }]).map((f) => f.detail)).toContain(`${boss.id} boss rounds not above its elite at the same depth`);
  });
});

describe("random-play guard gate", () => {
  const tally = (wins: number, fights: number): GuardTally => ({ elite: { wins, fights }, boss: { wins: 0, fights: 0 } });

  test("on target the rate must beat 25%, off target 20%", () => {
    expect(checkGuardWinRate(tally(1, 4), true)).toEqual([]); // too few fights to judge
    expect(checkGuardWinRate(tally(2, 8), true).map((f) => f.type)).toEqual(["guardWinRate"]);
    expect(checkGuardWinRate(tally(3, 8), true)).toEqual([]);
    expect(checkGuardWinRate(tally(2, 8), false)).toEqual([]);
    expect(checkGuardWinRate(tally(1, 5), false).map((f) => f.type)).toEqual(["guardWinRate"]);
  });

  test("the fear and satiety targets are read from the averages", () => {
    expect(survivalOnTarget({ samples: 2, fear: 98, satiety: 102 })).toBe(true);
    expect(survivalOnTarget({ samples: 2, fear: 100, satiety: 102 })).toBe(false);
    expect(survivalOnTarget({ samples: 2, fear: 98, satiety: 100 })).toBe(false);
    expect(survivalOnTarget({ samples: 0, fear: 0, satiety: 0 })).toBe(false);
  });

  test("runs add up by team, tier and floor", () => {
    const run = (team: string, won: boolean): RunStats => ({ team, startDepth: 1, rooms: 3, guards: [{ depth: 5, tier: "boss", won }], samples: [{ fear: 10, satiety: 80 }], itemsUsed: 1, starvedTurns: 2 });
    const summary = summarizeRuns([run("A", true), run("A", false), run("B", true)]);
    expect(summary.guards.boss).toEqual({ fights: 3, wins: 2 });
    expect(summary.floors).toEqual([{ depth: 5, tier: "boss", wins: 2, fights: 3 }]);
    expect(summary.teams.find((t) => t.team === "A")).toMatchObject({ runs: 2, rooms: 6, fights: 2, wins: 1, fear: 10, satiety: 80 });
  });
});

describe("random-play teams", () => {
  test("every team is four different classes, and together they field all of them", () => {
    for (const team of TEAMS) {
      expect(team.members).toHaveLength(4);
      expect(new Set(team.members.map((m) => m.classId)).size).toBe(4);
    }
    expect(new Set(TEAMS.flatMap((t) => t.members.map((m) => m.classId)))).toEqual(new Set(CLASSES.map((c) => c.id)));
  });

  test("the start floors end in 1 or 5 and hold both elite and boss floors", () => {
    expect(GUARD_FLOORS.slice(0, 6)).toEqual([1, 5, 11, 15, 21, 25]);
    expect(GUARD_FLOORS.at(-1)).toBe(95);
    expect(GUARD_FLOORS.filter((d) => d % BOSS_FLOOR_INTERVAL === 0)).toHaveLength(10);
  });

  /** Seed 7 opens on an entry-room ambush. */
  function fightWith(classIds: string[]) {
    const game = new Game(7, classIds, undefined, [null, null, null, null], false);
    expect(game.state.combat).not.toBeNull();
    const actor = game.state.party[0]!;
    actor.mp = actor.maxMp;
    actor.unlockedSkillIds = CLASSES.find((c) => c.id === actor.classId)!.skills.map((s) => s.id);
    game.state.inventory = {};
    return { game, actor };
  }
  const inGuardRoom = (game: Game) => {
    getRoom(game.state.floor, game.state.currentRoomId).type = "boss";
  };
  const skillOf = (plan: TurnPlan) => (plan.kind === "skill" ? plan.skill.id : plan.item.id);

  test("a healer heals the most wounded ally first", () => {
    const { game, actor } = fightWith(["acolyte", "knight", "mage", "rogue"]);
    const hurt = game.state.party[2]!;
    hurt.hp = 1;
    const plan = planTurn(game, actor, "healer");
    expect(plan.kind).toBe("skill");
    expect(plan.target?.id).toBe(hurt.id);
  });

  test("a frightened ally gets fear relief ahead of an attack", () => {
    const { game, actor } = fightWith(["acolyte", "knight", "mage", "rogue"]);
    const scared = game.state.party[1]!;
    scared.survival.fear = FEAR_ACT_AT;
    const plan = planTurn(game, actor, "healer");
    expect(skillOf(plan)).toBe("prayer");
    expect(plan.target?.id).toBe(scared.id);
  });

  test("low on mana in a normal room, a striker throws an item before it spends MP, and falls back on the free attack", () => {
    const { game, actor } = fightWith(["mage", "knight", "acolyte", "rogue"]);
    actor.mp = Math.floor(actor.maxMp * 0.2);
    game.state.inventory = { "cracker-string": 1 };
    expect(skillOf(planTurn(game, actor, "striker"))).toBe("cracker-string");
    game.state.inventory = {};
    const basic = planTurn(game, actor, "striker");
    expect(basic.kind === "skill" && basic.skill.mpCost).toBe(0);
    expect(basic.kind === "skill" && basic.starved).toBe(true);
  });

  test("a mana potion waits for the guard", () => {
    const { game, actor } = fightWith(["mage", "knight", "acolyte", "rogue"]);
    actor.mp = Math.floor(actor.maxMp * 0.2);
    game.state.inventory = { "small-mana-potion": 1 };
    expect(planTurn(game, actor, "striker").kind).toBe("skill");
    inGuardRoom(game);
    expect(skillOf(planTurn(game, actor, "striker"))).toBe("small-mana-potion");
  });

  test("a hurt character low on mana drinks a health potion before anything else", () => {
    const { game, actor } = fightWith(["mage", "knight", "acolyte", "rogue"]);
    actor.mp = 0;
    actor.hp = 1;
    game.state.inventory = { "small-health-potion": 1, "cracker-string": 1 };
    expect(skillOf(planTurn(game, actor, "striker"))).toBe("small-health-potion");
  });

  test("a healer keeps enough MP for its cheapest heal", () => {
    const { game, actor } = fightWith(["acolyte", "knight", "mage", "rogue"]);
    const healCost = getEffectiveSkill(getSkill("heal"), actor.level).mpCost;
    actor.mp = healCost;
    inGuardRoom(game);
    const plan = planTurn(game, actor, "healer");
    expect(plan.kind === "skill" && plan.skill.mpCost).toBe(0);
  });

  test("a healer short of its heal's MP does not spend it on fear relief", () => {
    const { game, actor } = fightWith(["acolyte", "knight", "mage", "rogue"]);
    game.state.party[1]!.survival.fear = FEAR_ACT_AT;
    actor.mp = getEffectiveSkill(getSkill("heal"), actor.level).mpCost;
    expect(skillOf(planTurn(game, actor, "healer"))).not.toBe("prayer");
  });

  test("a tired party heads for the rest room and eats when hungry, talks when frightened", () => {
    const game = new Game(7, TEAMS[0]!.members.map((m) => m.classId), undefined, [null, null, null, null], false);
    const rooms = [{ type: "combat", cleared: false }, { type: "rest", cleared: false }] as Room[];
    game.connectedRoomChoices = () => rooms;
    expect(chooseRoom(game)).toBe(1);
    game.state.satiety = 50;
    expect(chooseRoom(game)).toBe(2);
    expect(chooseRest(game)).toBe("1");
    game.state.satiety = 90;
    (game.state.party[0] as Character).survival.fear = FEAR_ACT_AT;
    expect(chooseRoom(game)).toBe(2);
    expect(chooseRest(game)).toBe("2");
  });
});

describe("random-play CLI", () => {
  function cli(...args: string[]) {
    const tmp = mkdtempSync(join(tmpdir(), "random-play-cli-"));
    const run = Bun.spawnSync(["bun", "run", "tools/random-play/run.ts", ...args], { env: { ...process.env, TMPDIR: tmp }, stdout: "pipe", stderr: "pipe" });
    return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString(), created: readdirSync(tmp) };
  }

  test("--report none prints the result, exits 0 when nothing failed and writes no report", () => {
    const { exitCode, stdout, created } = cli("--runs", "1", "--max-steps", "60", "--report", "none", "--curve", "off");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("0 failures");
    expect(stdout).not.toContain("report:");
    expect(created.every((name) => name.startsWith("darkest-terminal-random-play-saves-"))).toBe(true);
  }, 30000);

  test("--team plays that team alone, and --runs counts runs per team", () => {
    const { stdout } = cli("--team", "oath", "--runs", "2", "--max-steps", "30", "--report", "none", "--curve", "off");
    expect(stdout).toContain("run 2/2  Oath");
    expect(stdout).not.toContain("run 3/");
    expect(cli("--runs", "1", "--max-steps", "1", "--report", "none", "--curve", "off").stdout).toContain(`run ${TEAMS.length}/${TEAMS.length}`);
  }, 30000);

  test("an unknown team is refused before any run", () => {
    const { exitCode, stdout, stderr } = cli("--team", "nobody");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--team must be one of");
    expect(stdout).not.toContain("run 1/");
  });

  test("an unknown --curve value is refused before any run", () => {
    const { exitCode, stderr } = cli("--runs", "1", "--curve", "maybe");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--curve must be on or off");
  });

  test("an unknown --report value is refused before any run", () => {
    const { exitCode, stdout, stderr } = cli("--runs", "1", "--report", "pdf");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--report must be html or none");
    expect(stdout).not.toContain("run 1/1");
  });
});
