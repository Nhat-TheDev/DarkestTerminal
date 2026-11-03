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
import { TEAMS, FEAR_ACT_AT, BUFF_GAP_ROUNDS, allyOffenseGain, chooseRest, chooseRoom, defenseCut, mainStriker, newFightMemory, planTurn, skillPower, type TurnPlan } from "../tools/random-play/team";
import { getRoom } from "../src/engine/dungeon";
import { BOSS_FLOOR_INTERVAL } from "../src/data/levelGrowth";
import type { Character, Room } from "../src/types";
import { Rng } from "../src/engine/rng";
import { CLASSES, getEffectiveSkill, getSkill } from "../src/data/classes";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { applyDump } from "../tools/dev-save-dump/applyDump";
import {
  compareManifests,
  evidenceComment,
  frameToPng,
  frameToSvg,
  screenKeyOf,
  writeEvidence,
  EVIDENCE_MARKER,
  MAX_INLINE_IMAGES,
  ROOM_EVENT_IDS,
  type Manifest,
  type ManifestEntry,
} from "../tools/random-play/evidence";
import type { FrameCapture } from "../tools/random-play/report";
import type { UiState } from "../src/ui/state";
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
    const result = await playRun({ gameSeed: 1, botSeed: 7920, maxSteps: 40, team: TEAMS[0]! });
    expect(result.steps).toBe(40);
    expect(result.gallery.length).toBeGreaterThan(3);
    expect(result.gallery.every((g) => g.size.endsWith("x70") || g.size === "150x45")).toBe(true);
    expect(result.gallery.some((g) => g.size === "150x45")).toBe(true);
    expect(result.failures).toEqual([]);
  });

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

describe("random-play summary", () => {
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
    const plan = planTurn(game, actor, ["healer"]);
    expect(plan.kind).toBe("skill");
    expect(plan.target?.id).toBe(hurt.id);
  });

  test("a frightened ally gets fear relief ahead of an attack", () => {
    const { game, actor } = fightWith(["acolyte", "knight", "mage", "rogue"]);
    const scared = game.state.party[1]!;
    scared.survival.fear = FEAR_ACT_AT;
    const plan = planTurn(game, actor, ["healer"]);
    expect(skillOf(plan)).toBe("prayer");
    expect(plan.target?.id).toBe(scared.id);
  });

  test("low on mana in a normal room, a striker throws an item before it spends MP, and falls back on the free attack", () => {
    const { game, actor } = fightWith(["mage", "knight", "acolyte", "rogue"]);
    actor.mp = Math.floor(actor.maxMp * 0.2);
    game.state.inventory = { "cracker-string": 1 };
    expect(skillOf(planTurn(game, actor, ["striker"]))).toBe("cracker-string");
    game.state.inventory = {};
    const basic = planTurn(game, actor, ["striker"]);
    expect(basic.kind === "skill" && basic.skill.mpCost).toBe(0);
    expect(basic.kind === "skill" && basic.starved).toBe(true);
  });

  test("a mana potion waits for the guard", () => {
    const { game, actor } = fightWith(["mage", "knight", "acolyte", "rogue"]);
    actor.mp = Math.floor(actor.maxMp * 0.2);
    game.state.inventory = { "small-mana-potion": 1 };
    expect(planTurn(game, actor, ["striker"]).kind).toBe("skill");
    inGuardRoom(game);
    expect(skillOf(planTurn(game, actor, ["striker"]))).toBe("small-mana-potion");
  });

  test("a hurt character low on mana drinks a health potion before anything else", () => {
    const { game, actor } = fightWith(["mage", "knight", "acolyte", "rogue"]);
    actor.mp = 0;
    actor.hp = 1;
    game.state.inventory = { "small-health-potion": 1, "cracker-string": 1 };
    expect(skillOf(planTurn(game, actor, ["striker"]))).toBe("small-health-potion");
  });

  test("a healer keeps enough MP for its cheapest heal", () => {
    const { game, actor } = fightWith(["acolyte", "knight", "mage", "rogue"]);
    const healCost = getEffectiveSkill(getSkill("heal"), actor.level).mpCost;
    actor.mp = healCost;
    inGuardRoom(game);
    const plan = planTurn(game, actor, ["healer"]);
    expect(plan.kind === "skill" && plan.skill.mpCost).toBe(0);
  });

  test("a healer short of its heal's MP does not spend it on fear relief", () => {
    const { game, actor } = fightWith(["acolyte", "knight", "mage", "rogue"]);
    game.state.party[1]!.survival.fear = FEAR_ACT_AT;
    actor.mp = getEffectiveSkill(getSkill("heal"), actor.level).mpCost;
    expect(skillOf(planTurn(game, actor, ["healer"]))).not.toBe("prayer");
  });

  test("a healer that summons calls up its healing minion for a wounded ally, once", () => {
    const { game, actor } = fightWith(["summoner", "knight", "mage", "rogue"]);
    game.state.party[1]!.hp = 1;
    const plan = planTurn(game, actor, ["striker", "healer"]);
    expect(skillOf(plan)).toBe("summon-spirit");
    expect(game.queue({ kind: "character", id: actor.id }, "summon-spirit", [{ kind: "character", id: actor.id }])).toBeNull();
    game.resolve();
    game.state.party[1]!.hp = 1;
    expect(skillOf(planTurn(game, actor, ["striker", "healer"]))).not.toBe("summon-spirit");
    expect(skillOf(planTurn(game, actor, ["striker"]))).not.toBe("summon-spirit");
  });

  test("a tank that also heals heals the wounded first and opens with support otherwise", () => {
    const { game, actor } = fightWith(["paladin", "knight", "mage", "rogue"]);
    game.state.party[2]!.hp = Math.floor(game.state.party[2]!.maxHp * 0.6);
    expect(skillOf(planTurn(game, actor, ["tank", "healer"]))).toBe("lay-on-hands");
    expect(skillOf(planTurn(game, actor, ["tank"]))).not.toBe("lay-on-hands");
  });

  test("a coin-flip skill is scored at its odds, and at full value once the caster's odds are certain", () => {
    const { actor } = fightWith(["jester", "knight", "mage", "rogue"]);
    actor.level = 75;
    const skill = getEffectiveSkill(getSkill("double-or-nothing"), actor.level);
    const sure = skillPower({ ...skill, coinFlip: undefined }, actor, 1);
    expect(skillPower(skill, actor, 1)).toBeCloseTo(sure * skill.coinFlip!.winChance);
    actor.activeStatusEffects.push({ statusEffectId: "rigged", remainingTurns: 1 } as never);
    expect(skillPower(skill, actor, 1)).toBeCloseTo(sure * Math.min(1, skill.coinFlip!.winChance * 2));
  });

  test("an attack/magic buff for the allies is cast in a guard fight only when it adds more than the caster's own attack", () => {
    const { game, actor } = fightWith(["jester", "knight", "mage", "rogue"]);
    actor.level = 45;
    inGuardRoom(game);
    const ballad = getEffectiveSkill(getSkill("battle-ballad"), actor.level);
    expect(allyOffenseGain(ballad, actor, game.state.party)).toBeGreaterThan(0);
    // A buff that also does something else is left to the general support rule.
    expect(allyOffenseGain(getEffectiveSkill(getSkill("poison-coat"), 45), actor, game.state.party)).toBeNull();
    expect(allyOffenseGain(getEffectiveSkill(getSkill("rally"), 45), actor, game.state.party)).toBeNull();
    expect(skillOf(planTurn(game, actor, ["striker"]))).not.toBe("battle-ballad");
    for (const ally of game.state.party.slice(1)) ally.attack = ally.magicPower = 5000;
    // Round 1 with the guard's defense intact: a buff waits for an opening or a long enough gap.
    expect(skillOf(planTurn(game, actor, ["striker"]))).not.toBe("battle-ballad");
    game.state.combat!.roundNumber = 2 * BUFF_GAP_ROUNDS;
    expect(skillOf(planTurn(game, actor, ["striker"]))).toBe("battle-ballad");
  });

  test("a single-target attack/magic buff goes on the hardest hitter and waits while that ally still has it", () => {
    const { game, actor } = fightWith(["warlock", "archer", "knight", "acolyte"]);
    inGuardRoom(game);
    const [, archer, knight] = game.state.party;
    archer!.attack = 9000;
    knight!.hp = 1;
    const pact = getEffectiveSkill(getSkill("blood-pact"), actor.level);
    expect(mainStriker(pact, actor, game.state.party).id).toBe(archer!.id);
    game.state.combat!.roundNumber = 2 * BUFF_GAP_ROUNDS;
    const plan = planTurn(game, actor, ["striker"]);
    expect(skillOf(plan)).toBe("blood-pact");
    expect(plan.target?.id).toBe(archer!.id);
    const statusId = pact.effects!.find((e) => e.kind === "applyStatusEffect")!.statusEffectId!;
    archer!.activeStatusEffects.push({ statusEffectId: statusId, remainingTurns: 2 } as never);
    expect(skillOf(planTurn(game, actor, ["striker"]))).not.toBe("blood-pact");
  });

  /** Debuffs on the strongest enemy holding its defense down by half. */
  const openGuard = (game: Game) => {
    const inFight = game.livingEnemyRefs().map((ref) => game.ctx.monsters.find((m) => m.id === ref.id)!);
    const guard = inFight.sort((a, b) => b.maxHp - a.maxHp)[0]!;
    guard.activeStatusEffects.push({ statusEffectId: "weakened", turnsRemaining: 2, appliedAmounts: { defense: -guard.defense } });
    return guard;
  };

  test("a guard with its defense cut opens a window for buffs, and a buff is not repeated inside the gap", () => {
    const { game, actor } = fightWith(["jester", "knight", "mage", "rogue"]);
    actor.level = 45;
    inGuardRoom(game);
    for (const ally of game.state.party.slice(1)) ally.attack = ally.magicPower = 5000;
    expect(defenseCut(openGuard(game))).toBeCloseTo(0.5);
    const memory = newFightMemory();
    expect(skillOf(planTurn(game, actor, ["striker"], memory))).toBe("battle-ballad");
    delete actor.cooldownsRemaining["battle-ballad"];
    game.state.combat!.roundNumber += 1;
    expect(skillOf(planTurn(game, actor, ["striker"], memory))).not.toBe("battle-ballad");
    game.state.combat!.roundNumber += BUFF_GAP_ROUNDS - 1;
    expect(skillOf(planTurn(game, actor, ["striker"], memory))).toBe("battle-ballad");
  });

  test("a self buff that also raises attack is not held back for an opening", () => {
    const { game, actor } = fightWith(["rogue", "knight", "mage", "acolyte"]);
    actor.level = 45;
    inGuardRoom(game);
    expect(skillOf(planTurn(game, actor, ["striker"], newFightMemory()))).toBe("poison-coat");
  });

  test("an ally MP skill goes to the hardest hitter running dry, without waiting for an opening", () => {
    const { game, actor } = fightWith(["warlock", "archer", "knight", "acolyte"]);
    inGuardRoom(game);
    const [, archer, knight] = game.state.party;
    archer!.attack = 9000;
    knight!.attack = 8000;
    knight!.mp = 0;
    const plan = planTurn(game, actor, ["striker"]);
    expect(skillOf(plan)).toBe("blood-pact");
    expect(plan.target?.id).toBe(knight!.id);
  });

  test("a single-target support that is not an attack/magic buff still goes on the weakest ally", () => {
    const { game, actor } = fightWith(["paladin", "archer", "knight", "acolyte"]);
    actor.level = 40;
    inGuardRoom(game);
    const [, archer, knight] = game.state.party;
    archer!.attack = 9000;
    knight!.hp = Math.floor(knight!.maxHp * 0.8);
    for (const c of game.state.party) if (c !== knight) c.hp = c.maxHp;
    actor.cooldownsRemaining["defiance"] = 9;
    const plan = planTurn(game, actor, ["tank"]);
    expect(skillOf(plan)).toBe("guardian-angel");
    expect(plan.target?.id).toBe(knight!.id);
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

  test("--team plays that team alone, --runs counts runs per team, and --report none writes no report", () => {
    const { exitCode, stdout, created } = cli("--team", "oath", "--runs", "2", "--max-steps", "3", "--report", "none");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("0 failures");
    expect(stdout).toContain("run 2/2  Oath");
    expect(stdout).not.toContain("run 3/");
    expect(stdout).not.toContain("report:");
    expect(created.every((name) => name.startsWith("darkest-terminal-random-play-saves-"))).toBe(true);
  });

  test("an unknown team is refused before any run", () => {
    const { exitCode, stdout, stderr } = cli("--team", "nobody");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--team must be one of");
    expect(stdout).not.toContain("run 1/");
  });
});

describe("random-play evidence", () => {
  const ui = (kind: string, extra: object = {}) => ({ kind, ...extra }) as unknown as UiState;
  const span = (text: string, fg: [number, number, number, number] = [200, 200, 200, 255]) => ({ text, fg, bg: [10, 10, 10, 255] as [number, number, number, number], attributes: 0 });
  const frame: FrameCapture = { cols: 6, rows: 2, lines: [[span("a<&b"), span("▀█")], [span("      ")]] };

  test("a screen is keyed by its kind, the event room it shows and the case it is drawn in", () => {
    const eventGame = new Game(3, TEAMS[0]!.members.map((m) => m.classId), undefined, [null, null, null, null], false);
    let depth = 12;
    for (; ; depth++) {
      try {
        applyDump(eventGame, { level: 14, floorDepth: depth, roomArg: "event", forceEventId: ROOM_EVENT_IDS[0]! });
        break;
      } catch {}
    }
    expect(screenKeyOf(ui("room"), eventGame)).toEqual({ kind: "room", event: ROOM_EVENT_IDS[0]!, screenCase: null });
    expect(screenKeyOf(ui("roomReward", { entries: [] }), eventGame).screenCase).toBe("empty");

    for (const [floor, tier] of [[11, "elite"], [15, "boss"]] as const) {
      const guardGame = new Game(3, TEAMS[0]!.members.map((m) => m.classId), undefined, [null, null, null, null], false);
      applyDump(guardGame, { level: 14, floorDepth: floor, roomArg: "boss" });
      expect(screenKeyOf(ui("pickAction"), guardGame)).toEqual({ kind: "pickAction", event: null, screenCase: tier });
      guardGame.state.combat!.outcome = "defeat";
      expect(screenKeyOf(ui("combatOver"), guardGame).screenCase).toBe("defeat");
    }
  });

  test("a frame becomes an SVG of its cells, with block glyphs as rectangles and markup escaped", () => {
    const svg = frameToSvg(frame);
    expect(svg).toContain('width="48" height="32"');
    expect(svg).toContain("a&lt;&amp;b");
    expect(svg).toContain('<rect x="32" y="0" width="8" height="8"');
    expect(svg).toContain('<rect x="40" y="0" width="8" height="16"');
    expect(svg).not.toContain("▀");
  });

  test("a frame renders to a PNG", () => {
    expect([...frameToPng(frame).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("writing evidence leaves a PNG per screen and size, a manifest and a gallery", () => {
    const dir = mkdtempSync(join(tmpdir(), "random-play-evidence-"));
    const manifest = writeEvidence(dir, [{ uiKind: "room", event: "merchant", screenCase: null, size: "180x70", count: 1, frame }], 2);
    expect(manifest.failures).toBe(2);
    expect(manifest.screens.map((s) => s.file)).toEqual(["screens/room--merchant@180x70.png"]);
    expect(existsSync(join(dir, "screens", "room--merchant@180x70.png"))).toBe(true);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("![room · merchant @ 180x70](screens/room--merchant@180x70.png)");
  });

  const entry = (label: string, hash: string, size = "180x70"): ManifestEntry => ({ kind: label, event: null, screenCase: null, label, size, file: `screens/${label}@${size}.png`, hash });
  const manifest = (...screens: ManifestEntry[]): Manifest => ({ failures: 0, screens });

  test("two manifests compare by screen and size into new, gone and changed", () => {
    const changes = compareManifests(manifest(entry("a", "1"), entry("b", "2"), entry("c", "3")), manifest(entry("a", "1"), entry("b", "9"), entry("d", "4")));
    expect(changes.added.map((s) => s.label)).toEqual(["c"]);
    expect(changes.removed.map((s) => s.label)).toEqual(["d"]);
    expect(changes.changed.map((s) => s.label)).toEqual(["b"]);
  });

  test("the comment starts with its marker, shows changed screens inline up to the cap and links the rest", () => {
    const changed = Array.from({ length: MAX_INLINE_IMAGES + 2 }, (_, i) => `s${i}`);
    const text = evidenceComment({
      head: manifest(...changed.map((l) => entry(l, "new"))),
      base: manifest(...changed.map((l) => entry(l, "old"))),
      baseLabel: "`base`",
      imageBase: "https://img",
      galleryUrl: "https://gallery",
    });
    expect(text.startsWith(EVIDENCE_MARKER)).toBe(true);
    expect(text).toContain(`0 new · 0 gone · ${changed.length} changed`);
    expect(text.match(/!\[/g)).toHaveLength(MAX_INLINE_IMAGES);
    expect(text).toContain("2 more: [s30 @ 180x70](https://img/screens/s30@180x70.png)");
    expect(text).toContain("[full gallery](https://gallery)");
  });

  test("without a base, the comment says so and names the room events that got no screen", () => {
    const text = evidenceComment({ head: manifest(entry("room", "1")), base: null, baseLabel: "", imageBase: "", galleryUrl: "" });
    expect(text).toContain("nothing to compare against");
    expect(text).toContain(`Room events with no screen: ${ROOM_EVENT_IDS.join(", ")}.`);
  });
});
