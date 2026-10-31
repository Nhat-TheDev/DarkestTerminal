import { afterEach, describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { Game } from "../src/engine/game";
import { App } from "../src/ui/app";
import { clearSlot } from "../src/engine/save";
import { loadProfile, parseProfile, saveProfile } from "../src/engine/profile";
import { getRoom } from "../src/engine/dungeon";
import { startCombat } from "../src/engine/combat";
import { spawnMonster } from "../src/data/monsters";
import { BALANCE } from "../src/data/balanceConfig";
import { JOURNAL_PAGES, validateJournal, type JournalData } from "../src/data/journal";
import { maybeTriggerReflection } from "../src/engine/events/shared";
import { migrateGameState } from "../src/engine/migration";
import { availableDirections, deductionOptions, faceOf, drainAtFloorClear, endingEchoes, eventEcho, grantFragments, isChoosable, recordEcho, resolveDeduction } from "../src/engine/journal";
import { getJournalLine } from "../src/data/journal";
import { journalPages } from "../src/ui/screens/journal";
import journalJson from "../data/journal.json";
import type { Character } from "../src/types";

const SLOT = "slot1";

afterEach(() => clearSlot(SLOT));

/** No entry ambush: each test places its own room. */
function slotGame(seed = 1, slot: string | null = SLOT): Game {
  const game = new Game(seed, ["knight", "mage", "rogue", "acolyte"], undefined, undefined, false, slot);
  game.state.combat = null;
  return game;
}

function forceEventRoom(game: Game, eventId: string) {
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  room.type = "event";
  room.cleared = false;
  room.rolledEventId = eventId;
  return room;
}

/** Resolves an instant-reward event in the current room, as the room's [1] does. */
function resolveInstant(game: Game, eventId: string): void {
  forceEventRoom(game, eventId);
  game.state.journalHandledRoomId = null;
  expect(game.openChest()).toBeNull();
}

function choose(game: Game, directionLabel: string): void {
  const pending = game.state.pendingJournal!;
  const index = deductionOptions(pending.lineId, game.journal, game.state).findIndex((o) => "direction" in o && o.direction.label === directionLabel);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(game.resolveJournalDeduction(index)).toBeNull();
}

function availableDirectionsFor(lineId: string, game: Game) {
  return availableDirections(getJournalLine(lineId)!, game.journal, game.state);
}

function data(): JournalData {
  return structuredClone(journalJson) as unknown as JournalData;
}

describe("journal data", () => {
  test("the shipped catalog passes", () => {
    expect(() => validateJournal(data())).not.toThrow();
  });

  test("a line needs at least two directions", () => {
    const d = data();
    d.pages[0]!.lines[0]!.directions = d.pages[0]!.lines[0]!.directions.slice(0, 1);
    expect(() => validateJournal(d)).toThrow(/at least 2 directions/);
  });

  test("unknown fragments, events and directions are rejected", () => {
    const d1 = data();
    d1.pages[0]!.lines[0]!.requires = { match: "all", when: [{ fragmentId: "no-such-fragment" }] };
    expect(() => validateJournal(d1)).toThrow(/unknown fragment/);
    const d2 = data();
    d2.fragments[0]!.sources = [{ kind: "eventResolved", eventId: "no-such-event" }];
    expect(() => validateJournal(d2)).toThrow(/unknown event/);
    const d3 = data();
    d3.pages[0]!.lines[1]!.requires = { match: "all", when: [{ lineId: "what-the-marks-count", directionId: "stopped-on-their-own" }] };
    expect(() => validateJournal(d3)).toThrow(/not a direction of/);
  });

  test("a duplicate id and a cycle of line gates are rejected", () => {
    const d1 = data();
    d1.fragments[1]!.id = d1.fragments[0]!.id;
    expect(() => validateJournal(d1)).toThrow(/appears twice/);
    const d2 = data();
    const [first, second] = d2.pages[0]!.lines as [JournalData["pages"][0]["lines"][0], JournalData["pages"][0]["lines"][0]];
    first.requires = { match: "all", when: [{ lineId: second.id, directionId: second.directions[0]!.id }] };
    second.requires = { match: "all", when: [{ lineId: first.id, directionId: first.directions[0]!.id }] };
    expect(() => validateJournal(d2)).toThrow(/cycle/);
  });

  test("a minDepth must name a journal balance key", () => {
    const d = data();
    d.pages[0]!.lines[0]!.minDepth = "noSuchKey";
    expect(() => validateJournal(d)).toThrow(/minDepth/);
  });
});

describe("journal scene at room clear", () => {
  test("Old Count copies its fragment into the slot, opens a scene in place of the reflection, and queues the second line", () => {
    const game = slotGame();
    resolveInstant(game, "old-count");
    expect(game.state.pendingReflection).toBeNull();
    expect(game.state.pendingJournal).toMatchObject({ lineId: "what-the-marks-count", fragmentId: "tally-wall" });
    expect(game.state.journalQueue.map((q) => q.lineId)).toEqual(["the-last-mark"]);
    expect(loadProfile(SLOT).journal.fragments.map((f) => f.id)).toEqual(["tally-wall"]);
  });

  test("a replaced reflection still draws its roll, so the rng stream doesn't depend on the journal", () => {
    const states = [slotGame(5, null), slotGame(5, null)];
    for (const game of states) {
      const room = forceEventRoom(game, "old-count");
      room.cleared = true;
    }
    maybeTriggerReflection(states[0]!.state, states[0]!.ctx, false);
    maybeTriggerReflection(states[1]!.state, states[1]!.ctx, true);
    expect(states[0]!.state.pendingReflection).not.toBeNull();
    expect(states[1]!.state.pendingReflection).toBeNull();
    expect(states[1]!.ctx.rng.getState()).toBe(states[0]!.ctx.rng.getState());
  });

  test("a fragment the event's chain text hid is not granted", () => {
    const game = slotGame();
    game.state.narrativeCounters.freeRewardsTakenCount = BALANCE.events.freeTakenThreshold;
    resolveInstant(game, "old-count");
    expect(game.journal.fragments).toEqual([]);
    expect(game.state.pendingJournal).toBeNull();
  });

  test("a repeat-in-run source needs an earlier resolution of the same event this run", () => {
    const game = slotGame();
    resolveInstant(game, "old-count");
    choose(game, "They counted days, toward a day they meant to leave.");
    resolveInstant(game, "old-count");
    expect(game.state.pendingJournal).toMatchObject({ lineId: "what-the-marks-count", fragmentId: "tally-row" });
    const labels = deductionOptions("what-the-marks-count", game.journal, game.state).map((o) => o.kind);
    expect(labels[0]).toBe("keep");
    expect(labels.at(-1)).toBe("strikeLeaveBlank");
  });

  test("a line queued behind another scene opens at the floor clear", () => {
    const game = slotGame();
    resolveInstant(game, "old-count");
    choose(game, "They counted sleeps. There are no days down here.");
    expect(game.state.pendingJournal).toBeNull();
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.type = "boss";
    room.cleared = false;
    const guard = spawnMonster("skeleton-guard", 1, { tier: "boss" });
    guard.hp = 1;
    guard.attack = 0;
    game.ctx.monsters.push(guard);
    room.monsterIds = [guard.id];
    game.state.combat = startCombat(room.id, [guard.id], game.ctx, true);
    const attacker = game.state.party[0]!;
    game.queue({ kind: "character", id: attacker.id }, attacker.unlockedSkillIds[0]!, [{ kind: "monster", id: guard.id }]);
    game.resolve();
    expect(game.clearFinishedCombat()).toBe(true);
    expect(game.state.pendingJournal?.lineId).toBe("the-last-mark");
  });

  test("an omen grants its fragment", () => {
    const game = slotGame();
    grantFragments({ kind: "omen", omenId: "chalk-higher" }, game.journal, game.state, 1);
    expect(game.journal.fragments.map((f) => f.id)).toEqual(["chalk-higher"]);
  });
});

describe("journal readings", () => {
  test("a gated direction appears only once the reading it follows from is written", () => {
    const game = slotGame();
    resolveInstant(game, "old-count");
    choose(game, "They counted days, toward a day they meant to leave.");
    grantFragments({ kind: "eventResolved", eventId: "doubled-back", outcome: "resolved", baseTextShown: true }, game.journal, game.state, 1);
    expect(isChoosable("the-prints", game.journal, game.state)).toBe(false);
    game.state.pendingJournal = { lineId: "the-last-mark", fragmentId: "tally-wall" };
    choose(game, "They stopped on their own and left.");
    expect(isChoosable("the-prints", game.journal, game.state)).toBe(true);
  });

  test("striking a reading strikes what followed from it", () => {
    const game = slotGame();
    resolveInstant(game, "old-count");
    choose(game, "The count kept their hands busy. It wasn't for anything.");
    game.state.pendingJournal = { lineId: "the-last-mark", fragmentId: "tally-wall" };
    choose(game, "They lost interest in the count.");
    game.state.pendingJournal = { lineId: "what-the-marks-count", fragmentId: "tally-wall" };
    const options = deductionOptions("what-the-marks-count", game.journal, game.state);
    expect(game.resolveJournalDeduction(options.findIndex((o) => o.kind === "strikeLeaveBlank"))).toBeNull();
    expect(game.journal.lines["the-last-mark"]).toMatchObject({ directionId: undefined, struck: ["lost-interest"] });
  });

  test("a line left unwritten isn't offered again at the floor clear", () => {
    const game = slotGame();
    resolveInstant(game, "old-count");
    const leave = deductionOptions("what-the-marks-count", game.journal, game.state).findIndex((o) => o.kind === "leaveBlank");
    resolveDeduction(leave, game.journal, game.state, 1);
    game.state.journalQueue = [];
    drainAtFloorClear(game.journal, game.state);
    expect(game.state.pendingJournal?.lineId).toBe("the-last-mark");
    expect(game.state.journalQueue).toEqual([]);
  });

  test("a depth-gated line waits for its depth", () => {
    const game = slotGame();
    resolveInstant(game, "old-count");
    game.state.pendingJournal = { lineId: "the-last-mark", fragmentId: "tally-wall" };
    choose(game, "They stopped on their own and left.");
    expect(isChoosable("whether-they-came-back", game.journal, game.state)).toBe(false);
    game.state.floor.depth = BALANCE.journal.deepLineMinDepth;
    expect(isChoosable("whether-they-came-back", game.journal, game.state)).toBe(true);
  });
});

describe("journal across runs", () => {
  function wipe(game: Game): void {
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.type = "combat";
    room.cleared = false;
    const monster = spawnMonster("skeleton-guard", 1);
    game.ctx.monsters.push(monster);
    room.monsterIds = [monster.id];
    game.state.combat = startCombat(room.id, [monster.id], game.ctx, false);
    for (const c of game.state.party) {
      c.hp = 0;
      c.isAlive = false;
    }
    game.resolve();
  }

  test("a wipe tears the readings out to the death depth and keeps the fragments", () => {
    const game = slotGame();
    resolveInstant(game, "old-count");
    choose(game, "They counted sleeps. There are no days down here.");
    wipe(game);
    expect(game.state.gameOver).toBe("defeat");
    const profile = loadProfile(SLOT);
    expect(profile.journal.lines).toEqual({});
    expect(profile.journal.fragments.map((f) => f.id)).toEqual(["tally-wall"]);
    expect(profile.droppedJournal?.depth).toBe(game.state.floor.depth);
    expect(profile.droppedJournal?.hands[0]?.lines["what-the-marks-count"]?.directionId).toBe("counted-sleeps");
  });

  test("the next run reopens the line when it sees the source again", () => {
    const first = slotGame();
    resolveInstant(first, "old-count");
    choose(first, "They counted sleeps. There are no days down here.");
    wipe(first);
    const second = slotGame(2);
    resolveInstant(second, "old-count");
    expect(second.state.pendingJournal?.lineId).toBe("what-the-marks-count");
    expect(second.journal.fragments).toHaveLength(1);
  });

  test("the profile drops ids that left the data", () => {
    const profile = loadProfile(SLOT);
    profile.journal = {
      fragments: [
        { id: "tally-wall", run: 1, depth: 2 },
        { id: "gone-fragment", run: 1, depth: 2 },
      ],
      lines: { "the-last-mark": { directionId: "gone-direction", struck: ["something-made-them-stop"] }, "gone-line": { directionId: "x", struck: [] } },
      echoes: [],
    };
    saveProfile(SLOT, profile);
    const parsed = parseProfile(JSON.stringify(loadProfile(SLOT)));
    expect(parsed.journal.fragments.map((f) => f.id)).toEqual(["tally-wall"]);
    expect(parsed.journal.lines).toEqual({ "the-last-mark": { struck: ["something-made-them-stop"] } });
  });

  test("a save from before the journal loads with empty journal state", () => {
    const game = slotGame(3, null);
    const raw = JSON.parse(JSON.stringify(game.state));
    for (const key of ["pendingJournal", "journalQueue", "journalFragmentsSeen", "journalEventVisits", "journalLeftBlank", "journalHandledRoomId"]) delete raw[key];
    const migrated = migrateGameState(raw);
    expect(migrated.pendingJournal).toBeNull();
    expect(migrated.journalQueue).toEqual([]);
    expect(migrated.journalEventVisits).toEqual({});
  });
});

describe("journal viewer", () => {
  test("shows only pages the slot holds a fragment for, with the reading and the copied fragment", () => {
    const game = slotGame();
    resolveInstant(game, "old-count");
    choose(game, "They counted sleeps. There are no days down here.");
    const pages = journalPages(game.journal, null, game.runNumber);
    expect(pages.every((p) => p[0] === JOURNAL_PAGES[0]!.title.toUpperCase())).toBe(true);
    const text = pages.flat().join("\n");
    expect(text).toContain("They counted sleeps. There are no days down here.");
    expect(text).toContain("Tally marks scratched into the wall");
  });
});

describe("journal UI", () => {
  test("a cleared Old Count shows the scene, then [j] opens the journal and Esc returns", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 150, height: 45 });
    const game = slotGame(4, null);
    forceEventRoom(game, "old-count");
    const app = new App(renderer, game);
    await renderOnce();
    mockInput.pressKey("1");
    await renderOnce();
    if (app.debugUiState.kind === "artifactDecision") {
      mockInput.pressKey("2");
      await renderOnce();
    }
    expect(app.debugUiState.kind).toBe("journalDeduction");
    mockInput.pressKey("2");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("room");
    mockInput.pressKey("j");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("journal");
    mockInput.pressEscape();
    // A lone ESC byte is held briefly in case an escape sequence follows.
    await Bun.sleep(50);
    await renderOnce();
    expect(app.debugUiState.kind).toBe("room");
    renderer.destroy();
  });

  test("[j] does nothing before the slot holds a fragment", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 150, height: 45 });
    const game = slotGame(4, null);
    const app = new App(renderer, game);
    await renderOnce();
    const before = app.debugUiState.kind;
    mockInput.pressKey("j");
    await renderOnce();
    expect(app.debugUiState.kind).toBe(before);
    renderer.destroy();
  });
});

describe("journal echoes", () => {
  test("an echo on some but not all readings of a line is rejected", () => {
    const d = data();
    d.echoes.push({ id: "extra", on: { kind: "ending", endings: ["stay"] }, echoes: [{ lineId: "what-the-marks-count", directionId: "counted-days" }], text: "x" });
    expect(() => validateJournal(d)).toThrow(/some but not all/);
  });

  test("a page of only one-sided lines is rejected", () => {
    const d = data();
    d.echoes = d.echoes.filter((e) => !e.echoes.some((x) => x.lineId === "which-way-is-meant"));
    d.pages[1]!.lines = d.pages[1]!.lines.filter((l) => l.id === "which-way-it-turns");
    expect(() => validateJournal(d)).toThrow(/needs a line with no echo/);
  });

  test("an echo naming an unknown ending is rejected", () => {
    const d = data();
    d.echoes[0]!.on = { kind: "ending", endings: ["nowhere" as "stay"] };
    expect(() => validateJournal(d)).toThrow(/endings/);
  });

  test("an event visit shows the first held echo once per run, then the next", () => {
    const game = slotGame();
    game.journal.lines["the-last-mark"] = { directionId: "stopped-on-their-own", struck: [] };
    game.journal.lines["whether-they-came-back"] = { directionId: "never-came-back", struck: [] };
    game.state.floor.depth = Math.max(BALANCE.journal.deepEchoMinDepth, BALANCE.journal.deepLineMinDepth);
    const first = eventEcho("old-count", game.journal, game.state)!;
    expect(first.id).toBe("heel-scuffs");
    recordEcho(first, game.journal, game.state, 1);
    expect(eventEcho("old-count", game.journal, game.state)?.id).toBe("rows-unchanged");
    expect(game.journal.echoes.map((e) => e.id)).toEqual(["heel-scuffs"]);
  });

  test("an echo needs its reading held", () => {
    const game = slotGame();
    game.journal.lines["the-last-mark"] = { directionId: "something-made-them-stop", struck: [] };
    game.state.floor.depth = BALANCE.journal.deepEchoMinDepth;
    expect(eventEcho("old-count", game.journal, game.state)).toBeUndefined();
  });

  test("an ending shows its held echoes, mirrored ones last and at most one", () => {
    const game = slotGame();
    game.journal.lines["which-way-is-meant"] = { directionId: "open-come-in", struck: [] };
    expect(endingEchoes("letGo", game.journal).map((e) => e.id)).toEqual(["last-mark-open"]);
    game.journal.lines["what-the-marks-count"] = { directionId: "counted-sleeps", struck: [] };
    expect(endingEchoes("stay", game.journal).map((e) => e.id)).toEqual(["count-at-the-stair"]);
    expect(endingEchoes("defeat", game.journal)).toEqual([]);
  });

  test("choosing Stay records the ending's echoes for the Last page", () => {
    const game = slotGame();
    game.journal.lines["what-the-marks-count"] = { directionId: "counted-sleeps", struck: [] };
    game.state.pendingEndingCheckpoint = true;
    game.pickEndingChoice("stay");
    expect(game.state.journalEndingEchoIds).toEqual(["count-at-the-stair"]);
    expect(loadProfile(SLOT).journal.echoes.map((e) => e.id)).toEqual(["count-at-the-stair"]);
  });
});

describe("the dropped journal", () => {
  function dropAt(depth: number, lines: Record<string, { directionId?: string; struck: string[]; writerClassId?: string; run?: number }>, ours: Record<string, { directionId?: string; struck: string[] }> = {}) {
    const profile = loadProfile(SLOT);
    profile.journal = { fragments: [{ id: "tally-wall", run: 1, depth: 1 }], lines: ours, echoes: [] };
    profile.droppedJournal = { depth, hands: [{ run: 1, classIds: ["knight", "viking"], lines }] };
    saveProfile(SLOT, profile);
  }

  function answer(game: Game, ...choices: number[]): void {
    for (const choice of choices) expect(game.resolveJournalPickup(choice)).toBeNull();
  }

  test("arriving at its floor opens the merge: their readings where we're blank, then each line we read differently", () => {
    dropAt(1, {
      "the-last-mark": { directionId: "something-made-them-stop", struck: [], writerClassId: "viking", run: 1 },
      "what-the-marks-count": { directionId: "counted-days", struck: ["hands-kept-busy"], writerClassId: "knight", run: 1 },
    }, { "what-the-marks-count": { directionId: "counted-sleeps", struck: [] } });
    const game = slotGame(2);
    expect(game.state.pendingJournalPickup?.steps.map((s) => s.kind)).toEqual(["intro", "copyPage", "conflict"]);
    answer(game, 0, 0, 2);
    expect(game.state.pendingJournalPickup).toBeNull();
    expect(game.journal.lines["the-last-mark"]).toMatchObject({ directionId: "something-made-them-stop", writerClassId: "viking", run: 1 });
    expect(game.journal.lines["what-the-marks-count"]).toMatchObject({ split: ["counted-sleeps", "counted-days"], struck: ["hands-kept-busy"] });
    expect(loadProfile(SLOT).droppedJournal).toBeNull();
  });

  test("a split line counts for nothing and its next scene offers only its two readings", () => {
    dropAt(1, { "what-the-marks-count": { directionId: "counted-days", struck: [] } }, { "what-the-marks-count": { directionId: "hands-kept-busy", struck: [] } });
    const game = slotGame(2);
    answer(game, 0, 2);
    expect(isChoosable("what-the-marks-count", game.journal, game.state)).toBe(true);
    expect(deductionOptions("what-the-marks-count", game.journal, game.state).map((o) => ("direction" in o ? o.direction.id : o.kind))).toEqual(["counted-days", "hands-kept-busy"]);
    expect(availableDirectionsFor("the-last-mark", game).map((d) => d.id)).not.toContain("lost-interest");
  });

  test("taking theirs strikes ours; a reading that doesn't follow for us can't be taken", () => {
    dropAt(1, {
      "what-the-marks-count": { directionId: "counted-days", struck: [] },
      "the-last-mark": { directionId: "lost-interest", struck: [] },
    }, { "what-the-marks-count": { directionId: "counted-sleeps", struck: [] } });
    const game = slotGame(2);
    expect(game.state.pendingJournalPickup?.steps.map((s) => s.kind)).toEqual(["intro", "conflict", "cannotTake"]);
    answer(game, 0, 1, 0);
    expect(game.journal.lines["what-the-marks-count"]).toMatchObject({ directionId: "counted-days", struck: ["counted-sleeps"] });
    expect(game.journal.lines["the-last-mark"]).toBeUndefined();
  });

  test("past the screen cap, blank lines take their reading silently", () => {
    const saved = BALANCE.journal.maxMergeScreensPerFind;
    BALANCE.journal.maxMergeScreensPerFind = 0;
    try {
      dropAt(1, { "the-last-mark": { directionId: "something-made-them-stop", struck: [] } });
      const game = slotGame(2);
      expect(game.state.pendingJournalPickup?.steps.map((s) => s.kind)).toEqual(["intro"]);
      expect(game.journal.lines["the-last-mark"]?.directionId).toBe("something-made-them-stop");
    } finally {
      BALANCE.journal.maxMergeScreensPerFind = saved;
    }
  });

  test("a run that dies without reaching it moves it up a floor", () => {
    dropAt(5, { "the-last-mark": { directionId: "something-made-them-stop", struck: [] } });
    const game = slotGame(2);
    expect(game.state.pendingJournalPickup).toBeNull();
    for (const c of game.state.party) {
      c.hp = 0;
      c.isAlive = false;
    }
    game.move(game.connectedRoomChoices()[0]!.id);
    expect(game.state.gameOver).toBe("defeat");
    expect(loadProfile(SLOT).droppedJournal?.depth).toBe(5 - BALANCE.journal.driftFloorsPerMissedRun);
  });
});

describe("journal UI, part two", () => {
  test("the dropped journal is read on arrival, before the room", async () => {
    const profile = loadProfile(SLOT);
    profile.droppedJournal = { depth: 1, hands: [{ run: 1, classIds: ["knight", "viking"], lines: { "the-last-mark": { directionId: "something-made-them-stop", struck: [] } } }] };
    saveProfile(SLOT, profile);
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 150, height: 45 });
    const game = slotGame(2);
    const app = new App(renderer, game);
    await renderOnce();
    expect(app.debugUiState.kind).toBe("journalPickup");
    expect(captureCharFrame()).toContain("in a Knight's hand");
    mockInput.pressKey("RETURN");
    await renderOnce();
    expect(captureCharFrame()).toContain("in their hand");
    mockInput.pressKey("1");
    await renderOnce();
    expect(app.debugUiState.kind).not.toBe("journalPickup");
    renderer.destroy();
  });

  test("an ending with echoes offers the Last page from the game-over screen", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 150, height: 45 });
    const game = slotGame(4, null);
    game.journal.lines["what-the-marks-count"] = { directionId: "counted-sleeps", struck: [] };
    game.state.pendingEndingCheckpoint = true;
    const app = new App(renderer, game);
    await renderOnce();
    mockInput.pressKey("1");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("gameover");
    expect(captureCharFrame()).toContain("[Enter] Last page");
    mockInput.pressKey("RETURN");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("journalLastPage");
    expect(captureCharFrame()).toContain("By the stair, someone has started a row of short marks");
    expect(captureCharFrame()).not.toContain("[s] Quicksave");
    mockInput.pressEscape();
    await Bun.sleep(50);
    await renderOnce();
    expect(app.debugUiState.kind).toBe("gameover");
    renderer.destroy();
  });
});

describe("journal personalities", () => {
  test("lines for an unknown personality, or missing a side, are rejected", () => {
    const d1 = data();
    d1.pages[0]!.lines[0]!.directions[0]!.personalities = { nobody: { good: "a", bad: "b" } };
    expect(() => validateJournal(d1)).toThrow(/unknown personality/);
    const d2 = data();
    d2.pages[0]!.lines[0]!.directions[0]!.personalities = { gentle: { good: "a", bad: "" } };
    expect(() => validateJournal(d2)).toThrow(/both a "good" and a "bad"/);
  });

  test("each personality's bad side shows under its own condition", () => {
    const game = slotGame(1, null);
    const [knight, mage, rogue, acolyte] = game.state.party as [Character, Character, Character, Character];
    expect(faceOf(rogue, game.state)).toBe("good");
    rogue.survival.fear = 60;
    expect(faceOf(rogue, game.state)).toBe("bad");
    game.state.satiety = 10;
    expect(faceOf(knight, game.state)).toBe("bad");
    expect(faceOf(mage, game.state)).toBe("good");
    acolyte.hp = 1;
    expect(faceOf(mage, game.state)).toBe("bad");
  });

  test("the Paladin's bad side answers a teammate's fear, never his own", () => {
    const game = new Game(1, ["paladin", "knight", "mage", "rogue"], undefined, undefined, false, null);
    const [paladin, knight] = game.state.party as [Character, Character];
    paladin.survival.fear = 90;
    expect(faceOf(paladin, game.state)).toBe("good");
    knight.survival.fear = 60;
    expect(faceOf(paladin, game.state)).toBe("bad");
  });

  test("a scene fixes its speakers and faces when it opens, and a bad-side line costs the others fear", () => {
    const game = slotGame();
    const rogue = game.state.party[2]!;
    rogue.survival.fear = 60;
    const before = game.state.party.map((c) => c.survival.fear);
    resolveInstant(game, "old-count");
    const voices = game.state.pendingJournal!.voices!;
    const rogueVoice = voices.find((v) => v.characterId === rogue.id);
    expect(rogueVoice?.face).toBe("bad");
    game.state.party.forEach((c, i) => {
      if (c.id === rogue.id) expect(c.survival.fear).toBe(before[i]!);
      else expect(c.survival.fear).toBeGreaterThan(before[i]!);
    });
    rogue.survival.fear = 0;
    expect(game.state.pendingJournal!.voices!.find((v) => v.characterId === rogue.id)?.face).toBe("bad");
  });

  test("a reading no living member's personality has a line for is a margin note with the default line", () => {
    const game = new Game(1, ["viking", "warlock", "jester", "paladin"], undefined, undefined, false, SLOT);
    game.state.combat = null;
    resolveInstant(game, "old-count");
    const voices = game.state.pendingJournal!.voices!;
    const days = voices.find((v) => v.directionId === "counted-days");
    expect(days?.classId).toBeNull();
  });
});

describe("journal review fixes", () => {
  test("a line no fragment names shows no floor, even with a dropped journal lying elsewhere", () => {
    const game = slotGame();
    resolveInstant(game, "old-count");
    choose(game, "They counted sleeps. There are no days down here.");
    game.journal.lines["whether-they-came-back"] = { directionId: "never-came-back", struck: [] };
    const dropped = { depth: 3, hands: [{ run: 1, classIds: ["knight"], lines: { "the-last-mark": { directionId: "something-made-them-stop", struck: [] } } }] };
    const text = journalPages(game.journal, dropped, game.runNumber).flat().join("\n");
    expect(text).toContain("Whether they came back up\n");
    expect(text).not.toContain("Whether they came back up — floor");
  });

  test("a split line offers only readings that still follow, and leaving it unwritten clears the split", () => {
    const game = slotGame();
    resolveInstant(game, "old-count");
    choose(game, "They counted days, toward a day they meant to leave.");
    game.journal.lines["the-last-mark"] = { split: ["lost-interest", "stopped-on-their-own"], struck: [] };
    const options = deductionOptions("the-last-mark", game.journal, game.state).map((o) => ("direction" in o ? o.direction.id : o.kind));
    expect(options).toEqual(["stopped-on-their-own", "leaveBlank"]);
    game.state.pendingJournal = { lineId: "the-last-mark", fragmentId: "tally-wall" };
    expect(game.resolveJournalDeduction(1)).toBeNull();
    expect(game.journal.lines["the-last-mark"]?.split).toBeUndefined();
  });

  test("both readings of a split line still following force the choice", () => {
    const game = slotGame();
    game.journal.lines["the-last-mark"] = { split: ["something-made-them-stop", "stopped-on-their-own"], struck: [] };
    const kinds = deductionOptions("the-last-mark", game.journal, game.state).map((o) => o.kind);
    expect(kinds).toEqual(["write", "write"]);
  });
});

describe("journal viewer in combat", () => {
  test("[j] opens mid-fight and Esc returns to the same combat screen", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 150, height: 45 });
    const game = slotGame(4, null);
    grantFragments({ kind: "omen", omenId: "chalk-higher" }, game.journal, game.state, 1);
    game.state.pendingJournal = null;
    game.state.journalQueue = [];
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    const monster = spawnMonster("skeleton-guard", 1);
    game.ctx.monsters.push(monster);
    room.monsterIds = [monster.id];
    game.state.combat = startCombat(room.id, [monster.id], game.ctx, false);
    const app = new App(renderer, game);
    await renderOnce();
    const fighting = app.debugUiState.kind;
    expect(fighting).toBe("pickAction");
    mockInput.pressKey("j");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("journal");
    mockInput.pressEscape();
    await Bun.sleep(50);
    await renderOnce();
    expect(app.debugUiState.kind).toBe(fighting);
    renderer.destroy();
  });
});
