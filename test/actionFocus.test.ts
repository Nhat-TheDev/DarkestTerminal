import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { CLASSES } from "../src/data/classes";
import { getRoom } from "../src/engine/dungeon";
import { startCombat } from "../src/engine/combat";
import { spawnMonster } from "../src/data/monsters";
import { FOCUS_GLYPH } from "../src/ui/battlefieldFocus";

const PARTY = CLASSES.slice(0, 4).map((c) => c.id);
const count = (frame: string, glyph: string) => frame.split(glyph).length - 1;

/** An app standing at the first command prompt of a fight against 2 sturdy goblins, reveal clock under test control. */
async function openFight(options: { goblinAttack?: number; partyHp?: number; satiety?: number } = {}) {
  const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 62 });
  const game = new Game(7, PARTY);
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  const goblins = [spawnMonster("goblin", 1), spawnMonster("goblin", 1)];
  for (const g of goblins) {
    g.hp = g.maxHp = 500;
    if (options.goblinAttack !== undefined) g.attack = options.goblinAttack;
    game.ctx.monsters.push(g);
  }
  if (options.partyHp !== undefined) for (const c of game.state.party) c.hp = options.partyHp;
  if (options.satiety !== undefined) game.state.satiety = options.satiety;
  room.monsterIds = goblins.map((g) => g.id);
  room.cleared = false;
  game.state.combat = startCombat(room.id, room.monsterIds, game.ctx, false);
  const app = new App(renderer, game, { autoReveal: false });
  await renderOnce();
  // `startCombat` logs a "combat started" line, which the first render queues for reveal: drain it,
  // or `playRound` would see a reveal already running and never play the round.
  while (app.debugRevealActive) app.tickReveal();
  await renderOnce();
  return { app, mockInput, renderOnce, captureCharFrame, game };
}
type Fight = Awaited<ReturnType<typeof openFight>>;

/** Walks the command phase (Fight → first skill → first target) until the round resolves and the reveal starts. */
async function playRound(fight: Fight) {
  let guard = 0;
  while (!fight.app.debugRevealActive && guard++ < 6 * PARTY.length + 10) {
    const kind = fight.app.debugUiState.kind;
    fight.mockInput.pressKey(kind === "skillDetail" ? "RETURN" : "1");
    await fight.renderOnce();
  }
  expect(fight.app.debugRevealActive).toBe(true);
}

async function pressEscape(fight: Fight) {
  fight.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 100)); // a lone Esc is held back briefly to tell it from an escape sequence
  await fight.renderOnce();
}

describe("battlefield and log stay in step", () => {
  test("every render shows the session of the newest visible log line, and the icons of that session", async () => {
    const fight = await openFight();
    await playRound(fight);
    let guard = 0;
    while (fight.app.debugRevealActive && guard++ < 400) {
      const last = fight.app.debugLastRender;
      if (last.revealing) expect(last.focusId).toBe(last.logTailSessionId);
      const frame = fight.captureCharFrame();
      const focus = fight.app.debugFocus;
      expect(count(frame, FOCUS_GLYPH.shield)).toBe(focus?.attackedIds.length ?? 0);
      expect(count(frame, FOCUS_GLYPH.debuff)).toBe(focus?.debuffedIds.length ?? 0);
      fight.app.tickReveal();
      await fight.renderOnce();
    }
    expect(guard).toBeLessThan(400);
  }, 30000);

  test("at least one session shows a shield, and the frame with it also shows that session's log line", async () => {
    const fight = await openFight();
    await playRound(fight);
    let sawShield = false;
    let guard = 0;
    while (fight.app.debugRevealActive && guard++ < 400) {
      const focus = fight.app.debugFocus;
      if (focus && focus.attackedIds.length > 0) {
        sawShield = true;
        const newest = fight.app.debugRoomLog.at(-1)!;
        expect(newest.session?.id).toBe(focus.id);
        expect(fight.captureCharFrame()).toContain(newest.text.slice(0, 20));
      }
      fight.app.tickReveal();
      await fight.renderOnce();
    }
    expect(sawShield).toBe(true);
  }, 30000);

  test("skipping reveals every line and drops the highlight in one step", async () => {
    const fight = await openFight();
    await playRound(fight);
    fight.mockInput.pressKey("1"); // any key skips
    await fight.renderOnce();
    expect(fight.app.debugRevealActive).toBe(false);
    expect(fight.app.debugFocus).toBeNull();
    expect(fight.captureCharFrame()).not.toContain(FOCUS_GLYPH.shield);
    expect(fight.app.debugRoomLog.length).toBe(fight.game.state.combat!.log.length);
  }, 30000);

  test("when the last session's hold ends the round is over for the screen too", async () => {
    const fight = await openFight();
    await playRound(fight);
    let guard = 0;
    while (fight.app.debugRevealActive && guard++ < 400) {
      fight.app.tickReveal();
      await fight.renderOnce();
    }
    expect(fight.app.debugFocus).toBeNull();
    expect(fight.captureCharFrame()).not.toContain("Revealing");
  }, 30000);

  test("a quicksave during the reveal does not rewind HP, MP or coins to the start of the round", async () => {
    const fight = await openFight();
    await playRound(fight);
    for (let i = 0; i < 20 && fight.app.debugRevealActive; i++) fight.app.tickReveal();
    const before = fight.app.debugDisplaySnapshot;
    fight.mockInput.pressKey("s");
    await fight.renderOnce();
    if (fight.app.debugRevealActive) expect(fight.app.debugDisplaySnapshot).toBe(before);
  }, 30000);

  test("the round that wipes the party is still narrated, although the combat is already gone", async () => {
    // Dying damage at round end finishes off whoever the goblins missed, so the wipe is certain.
    const fight = await openFight({ partyHp: 1, satiety: 0 });
    await playRound(fight);
    expect(fight.game.state.combat).toBeNull();
    let guard = 0;
    while (fight.app.debugRevealActive && guard++ < 600) {
      fight.app.tickReveal();
      await fight.renderOnce();
    }
    expect(fight.app.debugRoomLog.some((e) => e.text.includes("party has fallen"))).toBe(true);
  }, 30000);

  test("a save loaded mid-fight does not replay the rounds already played", async () => {
    const { renderer, renderOnce } = await createTestRenderer({ width: 130, height: 62 });
    const game = new Game(7, PARTY);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    const goblin = spawnMonster("goblin", 1);
    goblin.hp = goblin.maxHp = 500;
    game.ctx.monsters.push(goblin);
    room.monsterIds = [goblin.id];
    game.state.combat = startCombat(room.id, [goblin.id], game.ctx, false);
    for (const c of game.state.party) game.queue({ kind: "character", id: c.id }, c.unlockedSkillIds[0]!, [{ kind: "monster", id: goblin.id }]);
    game.resolve();
    expect(game.state.combat!.phase).toBe("command");
    const app = new App(renderer, game, { autoReveal: false });
    await renderOnce();
    expect(app.debugRevealActive).toBe(false);
    expect(app.debugRoomLog).toEqual([]);
  }, 30000);
});

describe("room log", () => {
  test("keeps at most 50 entries", async () => {
    const fight = await openFight();
    for (let i = 0; i < 80; i++) fight.app.pushToast(`note ${i}`);
    fight.app.tickReveal(); // the first tick renders, which queues the toasts
    for (let i = 0; i < 200 && fight.app.debugRevealActive; i++) fight.app.tickReveal();
    await fight.renderOnce();
    expect(fight.app.debugRoomLog.length).toBe(50);
    expect(fight.app.debugRoomLog.at(-1)!.text).toBe("note 79");
  }, 30000);

  test("walking into another room clears it but keeps the line that announces the new room", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 130, height: 62 });
    const game = new Game(7, PARTY);
    game.state.combat = null;
    const app = new App(renderer, game, { autoReveal: false });
    await renderOnce();
    app.logInfo("left over from the first room");
    expect(app.debugRoomLog.map((e) => e.text)).toContain("left over from the first room");

    mockInput.pressKey("1"); // move through the first exit
    await renderOnce();
    for (let i = 0; i < 50 && app.debugRevealActive; i++) app.tickReveal();
    const texts = app.debugRoomLog.map((e) => e.text);
    expect(texts).not.toContain("left over from the first room");
    expect(texts).toContain(game.state.message);
  }, 30000);
});
