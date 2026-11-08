import { describe, test, expect } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KeyEvent, RGBA, type CapturedFrame } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { App, type RunExit } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { saveRun, loadSave, gameFromSave, listSlots, continuableSlots, clearSlot, SLOT_IDS } from "../src/engine/save";
import { getSkill } from "../src/data/classes";
import { ABILITIES } from "../src/data/abilities";
import { loadProfile, saveProfile } from "../src/engine/profile";
import type { Character, SkillDefinition, SkillEffect } from "../src/types";
import { getActorByRef, startCombat } from "../src/engine/combat";
import { spawnMonster, getArchetype, MONSTER_ARCHETYPES } from "../src/data/monsters";
import { resolveSkillEffect } from "../src/engine/resolver";
import { getRoom, enterRoom } from "../src/engine/dungeon";
import { getEvent } from "../src/data/events";
import { GATEKEEPER_EVENT_ID } from "../src/engine/events/gatekeeper";
import { ARTIFACTS } from "../src/data/artifacts";
import { showMainMenu } from "../src/ui/mainMenu";
import { showSlotSelect } from "../src/ui/saveSelect";
import { t } from "../src/data/strings";
import { renderFloorMap } from "../src/ui/floorMap";
import { CLASSES } from "../src/data/classes";
import { renderMain as renderCombat, skillEffectLine, skillMechanicLines } from "../src/ui/screens/combat";
import { BALANCE } from "../src/data/balanceConfig";
import * as runnerScreen from "../src/ui/screens/runner";
import * as artifactsScreen from "../src/ui/screens/artifacts";
import * as inventoryScreen from "../src/ui/screens/inventory";
import * as artifactDecisionScreen from "../src/ui/screens/artifactDecision";
import * as roomScreen from "../src/ui/screens/room";
import * as eventsScreen from "../src/ui/screens/events";
import * as campScreen from "../src/ui/screens/camp";
import * as abilityBuybackScreen from "../src/ui/screens/abilityBuyback";
import { formatArtifactEffect } from "../src/data/artifacts";
import { TROPHY_ICON } from "../src/ui/state";
import { getStatusEffect } from "../src/data/statusEffects";
import { ITEMS, describeItemEffects, getItem } from "../src/data/items";
import { getSummonArchetype, getSummonCast, getSummonSkill } from "../src/data/summons";
import { UNIT_BLOCK_HEIGHT } from "../src/ui/layout";
import { PALETTE } from "../src/ui/theme";
import { SAVE_DIR } from "../src/engine/paths";
import { panelContentRows } from "../tools/random-play/checks";

describe("headless UI smoke test", () => {
  test("a boss kill's pending artifact decision surfaces before the floor advances", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 100, height: 40 });
    const game = new Game(7);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.type = "boss";
    const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });
    boss.hp = 1;
    game.ctx.monsters.push(boss);
    room.monsterIds = [boss.id];
    room.cleared = false;
    game.state.combat = startCombat(room.id, [boss.id], game.ctx, true);
    const app = new App(renderer, game);
    await renderOnce();

    let guard = 0;
    while (app.debugUiState.kind !== "artifactDecision" && guard < 80) {
      guard++;
      if (app.debugUiState.kind === "roomReward" || app.debugUiState.kind === "skillDetail") mockInput.pressKey("RETURN");
      else mockInput.pressKey("1");
      await renderOnce();
    }
    expect(app.debugUiState.kind).toBe("artifactDecision");
    expect(game.state.floor.depth).toBe(1); // the decision comes first

    mockInput.pressKey("1"); // Equip
    await renderOnce();
    mockInput.pressKey("1"); // pick character 1
    await renderOnce();

    expect(game.state.pendingArtifactDecision).toBeNull();
    expect(app.debugUiState.kind).toBe("memoryIntro");
    mockInput.pressKey("RETURN");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("campPrompt"); // after the decision, before the floor advances
    expect(game.state.floor.depth).toBe(1);

    mockInput.pressKey("RETURN"); // skip Camp
    await renderOnce();

    expect(game.state.floor.depth).toBe(2);
  }, 20000);

  // The camp offer and the floor advance are held by the App, not the save, so a run reloaded
  // between the boss kill and the advance must pick the sequence back up from the cleared boss room.
  async function bossKilledThenReloadedAt(stopAt: "artifactDecision" | "campPrompt") {
    saveProfile("slot1", { ...loadProfile("slot1"), memoryUnlocked: true, memoryIntroShown: true });
    let game = new Game(7, ["knight", "mage", "rogue", "acolyte"], undefined, undefined, false, "slot1");
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.type = "boss";
    const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });
    boss.hp = 1;
    game.ctx.monsters.push(boss);
    room.monsterIds = [boss.id];
    room.cleared = false;
    game.state.combat = startCombat(room.id, [boss.id], game.ctx, true);
    let setup = await createTestRenderer({ width: 100, height: 40 });
    let app = new App(setup.renderer, game);
    await setup.renderOnce();

    for (let guard = 0; app.debugUiState.kind !== stopAt && guard < 40; guard++) {
      const kind = app.debugUiState.kind;
      setup.mockInput.pressKey(kind === "roomReward" || kind === "skillDetail" ? "RETURN" : "1");
      await setup.renderOnce();
    }
    expect(app.debugUiState.kind).toBe(stopAt);

    saveRun(game);
    game = gameFromSave(loadSave("slot1"), "slot1", 7);
    setup = await createTestRenderer({ width: 100, height: 40 });
    app = new App(setup.renderer, game);
    await setup.renderOnce();
    return { game, app, setup };
  }

  test("a run reloaded on a boss kill's artifact decision still offers Camp and advances the floor", async () => {
    const { game, app, setup } = await bossKilledThenReloadedAt("artifactDecision");
    expect(app.debugUiState.kind).toBe("artifactDecision");

    setup.mockInput.pressKey("2"); // Discard
    await setup.renderOnce();
    expect(app.debugUiState.kind).toBe("campPrompt");
    expect(game.state.floor.depth).toBe(1);

    setup.mockInput.pressKey("RETURN"); // skip Camp
    await setup.renderOnce();
    expect(game.state.floor.depth).toBe(2);
    clearSlot("slot1");
  }, 20000);

  test("a run reloaded on the post-boss Camp offer is offered Camp again and then advances", async () => {
    const { game, app, setup } = await bossKilledThenReloadedAt("campPrompt");
    expect(app.debugUiState.kind).toBe("campPrompt");
    expect(game.state.floor.depth).toBe(1);

    setup.mockInput.pressKey("RETURN"); // skip Camp
    await setup.renderOnce();
    expect(game.state.floor.depth).toBe(2);
    clearSlot("slot1");
  }, 20000);

  test("the monster panel shows a shell bearer's shell: hits left while intact, broken after the break", async () => {
    // A real archetype (the panel needs its sprite) given a shell for the length of the test.
    const spider = MONSTER_ARCHETYPES.find((a) => a.id === "giant-spider")!;
    spider.shell = { hitsToBreak: { min: 3, max: 3 }, hitDamageCapMaxHpPercent: 5, breakStatusId: "stunned", breakDurationTurns: 1, reformAfterOwnTurns: 2 };
    try {
      const frameWith = async (hits: number) => {
        const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 47 });
        const game = new Game(7);
        const room = getRoom(game.state.floor, game.state.currentRoomId);
        room.type = "boss";
        const boss = spawnMonster("giant-spider", 1, { tier: "boss" });
        game.ctx.monsters.push(boss);
        room.monsterIds = [boss.id];
        room.cleared = false;
        game.state.combat = startCombat(room.id, [boss.id], game.ctx, true);
        for (let i = 0; i < hits; i++) resolveSkillEffect({ kind: "damage", amount: 1 }, game.state.party[0]!, boss, { log: [] });
        new App(renderer, game);
        await renderOnce();
        return captureCharFrame();
      };
      expect(await frameWith(0)).toContain("Shell (3 hits)");
      expect(await frameWith(1)).toContain("Shell (2 hits)");
      expect(await frameWith(2)).toContain("Shell (1 hit)");
      const broken = await frameWith(3);
      expect(broken).toContain("Shell broken");
      expect(broken).not.toContain("Shell (");
    } finally {
      delete spider.shell;
    }
  }, 20000);

  test("a target prompt with nothing in reach says so instead of showing an empty list", () => {
    const game = new Game(7);
    const actor = game.state.party[0]!;
    const skill = getSkill(actor.unlockedSkillIds.map(getSkill).find((s) => s.target === "singleEnemy")!.id);
    const out = renderCombat(game, { kind: "pickTarget", actorRef: { kind: "character", id: actor.id }, source: { kind: "skill", skill }, candidates: [] }) as unknown as {
      chunks: { text: string }[];
    };
    const text = out.chunks.map((c) => c.text).join("");
    expect(text).toContain(t("ui.noTargetReachable"));
  });

  test("merchant offer detail: cancel returns to list, buy purchases and closes", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 100, height: 40 });
    const game = new Game(7);
    game.state.combat = null;
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.type = "event";
    room.rolledEventId = "merchant";
    room.cleared = false;
    const artifactId = ARTIFACTS[0]!.id;
    game.state.activeEvent = { eventId: "merchant", offerArtifactIds: [artifactId] };
    game.state.coins = 9999;
    const app = new App(renderer, game);
    await renderOnce();

    expect(app.debugUiState.kind).toBe("eventArtifactShop");

    mockInput.pressKey("1"); // view the first offer's detail
    await renderOnce();
    let ui = app.debugUiState;
    if (ui.kind !== "eventArtifactShop") throw new Error(`expected eventArtifactShop, got ${ui.kind}`);
    expect(ui.viewingOfferIndex).toBe(0);

    mockInput.pressKey("2"); // cancel back to the offer list
    await renderOnce();
    ui = app.debugUiState;
    if (ui.kind !== "eventArtifactShop") throw new Error(`expected eventArtifactShop, got ${ui.kind}`);
    expect(ui.viewingOfferIndex).toBeNull();
    expect(game.state.coins).toBe(9999);
    expect(game.state.activeEvent).not.toBeNull();

    mockInput.pressKey("1"); // view again
    await renderOnce();
    mockInput.pressKey("1"); // buy
    await renderOnce();

    expect(game.state.coins).toBeLessThan(9999);
    expect(game.state.pendingArtifactDecision?.artifactId).toBe(artifactId);
    expect(app.debugUiState.kind).toBe("artifactDecision");
  });

  test("q opens the save menu instead of quitting", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 80, height: 24 });
    const originalExit = process.exit;
    let exitCalled = false;
    process.exit = ((code?: number) => {
      exitCalled = true;
      throw new Error("__exit__");
    }) as typeof process.exit;
    try {
      const app = new App(renderer, new Game(1));
      await renderOnce();
      mockInput.pressKey("q");
      expect(app.debugUiState.kind).toBe("saveMenu");
      expect(exitCalled).toBe(false);
    } finally {
      process.exit = originalExit;
    }
  });

  test("ctrl+c quits the process", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 80, height: 24 });
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("__exit__");
    }) as typeof process.exit;
    try {
      new App(renderer, new Game(1));
      await renderOnce();
      try {
        mockInput.pressCtrlC();
      } catch (e) {
        if (!(e instanceof Error) || e.message !== "__exit__") throw e;
      }
      expect(exitCode).toBe(0);
    } finally {
      process.exit = originalExit;
    }
  });
});

describe("key handler lifecycle", () => {
  test("the main menu leaves no keypress listener behind once the game is running", async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 130, height: 45 });
    const press = async (key: string) => {
      mockInput.pressKey(key);
      await renderOnce();
    };
    const listeners = () => renderer.keyInput.listenerCount("keypress");

    const menu = showMainMenu(renderer);
    await renderOnce();
    await press("x"); // title screen -> the New/Continue choice
    await press("1"); // choose New
    expect(await menu).toBe("new");

    const classIds = CLASSES.slice(0, 4).map((c) => c.id);
    new App(renderer, new Game(7, classIds));
    await renderOnce();

    // `.once("keypress", ...)` never removes itself under InternalKeyHandler.emit, so the menu would stack a handler per keypress.
    const settled = listeners();
    for (const key of ["b", "b", "1", "2", "b"]) await press(key);

    expect(listeners()).toBe(settled);
  });

  test("Esc out of the slot list draws the main menu without another keypress", async () => {
    const { renderer, mockInput, captureCharFrame } = await createTestRenderer({ width: 130, height: 45 });
    // No renderOnce() here: the bug only shows when the renderer schedules its own frames.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

    const slot = showSlotSelect(renderer, "new");
    await settle();
    mockInput.pressEscape();
    expect(await slot).toBeNull();

    void showMainMenu(renderer);
    await settle();
    expect(captureCharFrame()).toContain(t("mainMenu.tagline"));
  });

  test("New Game asks before overwriting a slot whose run ended", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 45 });
    clearSlot("slot3");
    saveProfile("slot3", { ...loadProfile("slot3"), runCount: 2 });
    const warning = t("saveSelect.overwriteWarningEnded", { slot: 3 });

    const slot = showSlotSelect(renderer, "new");
    await renderOnce();
    mockInput.pressKey("3");
    await renderOnce();
    expect(captureCharFrame()).toContain(warning);

    mockInput.pressEscape();
    // A lone Esc reaches the handler only once the parser stops waiting for an escape sequence.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await renderOnce();
    expect(captureCharFrame()).not.toContain(warning);

    mockInput.pressKey("3");
    await renderOnce();
    mockInput.pressKey("1");
    expect(await slot).toMatchObject({ id: "slot3", overwrite: true });
    clearSlot("slot3");
  });
});

describe("game over", () => {
  async function defeatedRunInSlot() {
    const setup = await createTestRenderer({ width: 150, height: 45 });
    const game = new Game(7, ["knight", "mage", "rogue", "acolyte"], undefined, undefined, false, "slot1");
    saveRun(game);
    game.state.combat = null;
    game.state.gameOver = "defeat";
    game.state.abilityDeathResults = [];
    const exits: RunExit[] = [];
    const app = new App(setup.renderer, game, { onExit: (next) => exits.push(next) });
    await setup.renderOnce();
    return { setup, game, app, exits };
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

  test("defeat clears the run but keeps the slot for the next run", async () => {
    const { game, app, setup } = await defeatedRunInSlot();
    expect(app.debugUiState.kind).toBe("gameover");
    expect(listSlots()[0]!.meta).toBeNull();
    expect(game.currentSaveSlot).toBe("slot1");
    const frame = setup.captureCharFrame();
    expect(frame).toContain("[n] New Run   [Esc] Main Menu");
    const lines = frame.split("\n");
    expect(lines.some((line) => line.includes("[n] New Run") && !line.includes("[Esc]"))).toBe(true);
    expect(lines.some((line) => line.includes("[Esc] Main Menu") && !line.includes("[n]"))).toBe(true);
  });

  test("[n] asks for a new run and [Esc] for the main menu; a stray [1] from the screen before does nothing", async () => {
    const first = await defeatedRunInSlot();
    first.setup.mockInput.pressKey("1");
    await tick();
    expect(first.exits).toEqual([]);
    expect(first.app.debugUiState.kind).toBe("gameover");
    first.setup.mockInput.pressKey("n");
    await tick();
    expect(first.exits).toEqual(["newRun"]);

    const second = await defeatedRunInSlot();
    second.setup.mockInput.pressEscape();
    await tick();
    await tick();
    expect(second.exits).toEqual(["menu"]);
  });

  test("a slot whose run ended before the next party was picked still shows in Continue", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 45 });
    clearSlot("slot5");
    saveProfile("slot5", { ...loadProfile("slot5"), runCount: 2 });
    const index = continuableSlots().findIndex((slot) => slot.id === "slot5");

    const menu = showMainMenu(renderer);
    await renderOnce();
    mockInput.pressKey("x");
    await renderOnce();
    mockInput.pressKey("2");
    expect(await menu).toBe("continue");

    const slot = showSlotSelect(renderer, "continue");
    await renderOnce();
    expect(captureCharFrame()).toContain(t("saveSelect.endedLine", { i: index + 1, slot: 5, run: 2 }).trim());
    mockInput.pressKey(String(index + 1));
    expect(await slot).toEqual({ id: "slot5", overwrite: false, hasRun: false });
  });

  test("a wipe records the run's play time and end for the slot list", async () => {
    const before = Date.now();
    const { game } = await defeatedRunInSlot();
    const lastRun = loadProfile("slot1").lastRun!;
    expect(lastRun.playTime).toBe(game.playTimeSec());
    expect(lastRun.endedAt).toBeGreaterThanOrEqual(before);
  });

  test("an ended slot reads as bright as a run, with its play time and end", async () => {
    const { renderer, renderOnce, captureCharFrame, captureSpans } = await createTestRenderer({ width: 130, height: 45 });
    SLOT_IDS.forEach(clearSlot);
    const endedAt = Date.UTC(2026, 9, 31, 12);
    saveProfile("slot2", { ...loadProfile("slot2"), runCount: 3, lastRun: { playTime: 3720, endedAt } });
    saveProfile("slot4", { ...loadProfile("slot4"), runCount: 1 });

    void showSlotSelect(renderer, "continue");
    await renderOnce();
    const frame = captureCharFrame();
    const timed = t("saveSelect.endedLineTime", { i: 1, slot: 2, run: 3, playTime: "1h 2m" }).trim();
    const plain = t("saveSelect.endedLine", { i: 2, slot: 4, run: 1 }).trim();
    expect(frame).toContain(timed);
    expect(frame).toContain(new Date(endedAt).toLocaleString());
    expect(frame).toContain(plain);

    const textColor = RGBA.fromHex(PALETTE.text);
    const spanWith = (text: string) => captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes(text))!;
    expect(spanWith(timed).fg).toEqual(textColor);
    expect(spanWith(plain).fg).toEqual(textColor);
    SLOT_IDS.forEach(clearSlot);
  });

  test("New Game names a save it can't load and asks before overwriting it", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 45 });
    SLOT_IDS.forEach(clearSlot);
    const path = join(SAVE_DIR, "slot3.json");
    saveProfile("slot3", { ...loadProfile("slot3"), runCount: 2, lastRun: { playTime: 3720, endedAt: Date.UTC(2026, 9, 31, 12) } });
    writeFileSync(path, "{");

    const slot = showSlotSelect(renderer, "new");
    await renderOnce();
    expect(captureCharFrame()).toContain(t("saveSelect.unreadableLine", { i: 3, slot: 3 }).trim());
    expect(captureCharFrame()).not.toContain("1h 2m");

    mockInput.pressKey("3");
    await renderOnce();
    expect(captureCharFrame()).toContain(t("saveSelect.confirmHint"));
    mockInput.pressEscape();
    await tick();
    await renderOnce();
    expect(captureCharFrame()).not.toContain(t("saveSelect.confirmHint"));
    expect(readFileSync(path, "utf8")).toBe("{");

    mockInput.pressKey("3");
    await renderOnce();
    mockInput.pressKey("1");
    expect(await slot).toEqual({ id: "slot3", overwrite: true, hasRun: true });
    SLOT_IDS.forEach(clearSlot);
  });
});

describe("character info screen", () => {
  test("shows which digit switches to which party member, and switches on that digit", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 47 });
    const classIds = CLASSES.slice(0, 4).map((c) => c.id);
    const app = new App(renderer, new Game(7, classIds));
    await renderOnce();
    mockInput.pressKey("RETURN"); // skip the ambush reveal
    await renderOnce();
    mockInput.pressKey("b");
    await renderOnce();

    const opened = captureCharFrame();
    expect(opened).toContain("[2] Mage");
    expect(opened).toContain("Knight (Level 1 Knight)");
    expect(opened).toContain("[1-4] Character");

    mockInput.pressKey("3");
    await renderOnce();
    expect(captureCharFrame()).toContain("Rogue (Level 1 Rogue)");
  });
});

describe("list paging", () => {
  test("right/left arrows turn the page of the item list instead of being taken by the log panel", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 47 });
    const game = new Game(1);
    for (const item of ITEMS) game.state.inventory[item.id] = 1;
    const app = new App(renderer, game);
    await renderOnce();
    expect(app.debugUiState.kind).toBe("pickAction");
    mockInput.pressKey("2");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("pickItemInCombat");
    const firstItemLine = () => captureCharFrame().split("\n").find((l) => l.includes("[1] "))!;
    const page1 = firstItemLine();

    mockInput.pressArrow("right");
    await renderOnce();
    expect(firstItemLine()).not.toBe(page1);

    mockInput.pressArrow("left");
    await renderOnce();
    expect(firstItemLine()).toBe(page1);
  });
});

describe("playtest fixes", () => {
  test("Twin Altars shows each artifact's effect, not its lore", () => {
    const game = new Game(1);
    forceTwinAltars(game);
    const text = eventsScreen.renderMain(game, { kind: "eventPairedOffer" }) as string;
    for (const [i, id] of game.state.activeEvent!.offerArtifactIds.entries()) {
      const a = ARTIFACTS.find((x) => x.id === id)!;
      expect(text).toContain(`[${i + 1}] ${a.name} (${a.rarity}) — ${formatArtifactEffect(a)}`);
    }
  });

  test("ability buyback: Reclaim is locked and [1] does nothing without enough Stardust", () => {
    const game = new Game(1);
    const ability = ABILITIES.find((a) => a.rarity === "rare")!;
    const cost = BALANCE.abilities.stardustCostByRarity.rare;
    game.state.pendingAbilityBuyback = { entries: [{ characterId: game.state.party[0]!.id, lostAbilityId: ability.id, rarity: "rare" }], resolvedIndex: 0 };
    game.state.runStardust = cost - 1;
    expect(abilityBuybackScreen.renderMain(game)).toContain(t("ui.abilityBuybackReclaimLocked", { cost, current: cost - 1 }));
    expect(abilityBuybackScreen.renderMain(game)).not.toContain("[1]");
    expect(abilityBuybackScreen.renderFooter(game)).toBe(t("ui.footerAbilityBuybackSkipOnly"));
    let synced = 0;
    const ctx = { game, syncUiToGameState: () => synced++, reportUnusable: () => synced++ } as unknown as Parameters<typeof abilityBuybackScreen.handleKey>[0];
    abilityBuybackScreen.handleKey(ctx, { kind: "abilityBuyback" }, {} as KeyEvent, 1);
    expect(game.state.pendingAbilityBuyback).not.toBeNull();
    expect(synced).toBe(0);

    game.state.runStardust = cost;
    expect(abilityBuybackScreen.renderMain(game)).toContain(t("ui.abilityBuybackReclaimOption", { cost }));
    expect(abilityBuybackScreen.renderFooter(game)).toBe(t("ui.footerAbilityBuyback"));
  });

  test("the artifact list and the wearer/replace pickers advertise [Esc] Back", () => {
    const game = new Game(1);
    const c = game.state.party[0]!;
    c.equippedArtifactIds = ARTIFACTS.filter((a) => !a.isCursed).slice(0, 3).map((a) => a.id);
    expect(artifactsScreen.renderFooter({ kind: "artifactMenu" }, game)).toContain("[Esc] Back");
    game.state.pendingArtifactDecision = { artifactId: ARTIFACTS[5]!.id, forceEquip: false };
    expect(artifactDecisionScreen.renderFooter({ kind: "artifactDecisionPickCharacter" }, game)).toContain("[Esc] Back");
    expect(artifactDecisionScreen.renderFooter({ kind: "artifactDecisionPickReplace", characterId: c.id }, game)).toContain("[Esc] Back");
  });

  test("the Camp option reads its satiety from the balance config", () => {
    const game = new Game(1);
    const original = BALANCE.survival.campSatietyRestore;
    (BALANCE.survival as { campSatietyRestore: number }).campSatietyRestore = 17;
    try {
      expect(campScreen.renderMain(game, { kind: "campPrompt" })).toContain("restore 17 satiety");
    } finally {
      (BALANCE.survival as { campSatietyRestore: number }).campSatietyRestore = original;
    }
  });
});

describe("rest room options", () => {
  test("Eat and Talk read their numbers from the balance config", () => {
    const game = new Game(1);
    game.state.combat = null;
    const survival = BALANCE.survival as { eatDrinkRestoreFraction: number; eatDrinkSatietyRestore: number; chatRestoreFraction: number; chatFearRelief: number };
    const original = { ...survival };
    Object.assign(survival, { eatDrinkRestoreFraction: 0.25, eatDrinkSatietyRestore: 35, chatRestoreFraction: 0.15, chatFearRelief: 12 });
    try {
      const text = roomScreen.renderMain(game, { kind: "rest" }) as string;
      expect(text).toContain("restore 25% max HP/MP and 35 satiety");
      expect(text).toContain("restore 15% max HP/MP, reduce the party's fear by 12");
    } finally {
      Object.assign(survival, original);
    }
  });
});

function forceTwinAltars(game: Game): void {
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  room.type = "event";
  room.rolledEventId = "twin-altars";
  game.state.activeEvent = { eventId: "twin-altars", offerArtifactIds: [ARTIFACTS[0]!.id, ARTIFACTS[1]!.id] };
}

describe("room screen", () => {
  test("the first line names the room, and an event room adds the event's name", () => {
    const game = new Game(1);
    game.state.combat = null;
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.cleared = true;
    const firstLine = () => {
      const out = roomScreen.renderMain(game, { kind: "room" });
      return (typeof out === "string" ? out : out.chunks.map((c) => c.text).join("")).split("\n")[0];
    };
    room.type = "combat";
    room.rolledEventId = undefined;
    expect(firstLine()).toBe(room.name);
    room.type = "event";
    room.rolledEventId = "merchant";
    expect(firstLine()).toBe(`${room.name} — ${getEvent("merchant").name}`);
  });
});

describe("artifact decision", () => {
  test("choosing a wearer lists only living characters, numbered in that order", () => {
    const game = new Game(1);
    const fallen = game.state.party[1];
    fallen!.isAlive = false;
    fallen!.hp = 0;
    game.state.pendingArtifactDecision = { artifactId: ARTIFACTS[0]!.id, forceEquip: true };
    const ui = { kind: "artifactDecisionPickCharacter" } as const;
    const text = artifactDecisionScreen.renderMain(game, ui);
    const living = game.state.party.filter((c) => c.isAlive);
    expect(living).toHaveLength(game.state.party.length - 1);
    expect(text).not.toContain(`${fallen!.name} (`);
    living.forEach((c, i) => expect(text).toContain(`[${i + 1}] ${c.name} (`));
    expect(artifactDecisionScreen.renderFooter(ui, game)).toContain(`[1-${living.length}]`);
  });
});

describe("item lists", () => {
  test("each item shows its effect summary on a second line", () => {
    const game = new Game(1);
    game.state.inventory = { "small-health-potion": 2 };
    const potion = getItem("small-health-potion");
    const lines = inventoryScreen.renderMain(game, { kind: "pickItemOutOfCombat" }).split("\n");
    const row = lines.findIndex((l) => l.includes("[1] ") && l.includes(potion.name));
    expect(lines[row + 1]).toBe(t("ui.inventoryEffectLine", { effect: describeItemEffects(potion) }));
  });

  test("an item flagged combatUsable: false is listed out of combat but not in combat", () => {
    const game = new Game(1);
    const kit = getItem("exploration-kit");
    expect(kit.combatUsable).toBe(false);
    game.state.inventory = { [kit.id]: 1, "small-health-potion": 1 };
    expect(inventoryScreen.renderMain(game, { kind: "pickItemOutOfCombat" })).toContain(kit.name);
    const actorRef = { kind: "character", id: game.state.party[0]!.id } as const;
    const inCombat = renderCombat(game, { kind: "pickItemInCombat", actorRef }) as string;
    expect(inCombat).not.toContain(kit.name);
    expect(inCombat).toContain(getItem("small-health-potion").name);
  });

  test("out of combat an item can only be viewed: the camp kit says Camp spends it, the rest say combat", () => {
    const game = new Game(1);
    const kit = ITEMS.find((i) => i.campKit)!;
    const potion = getItem("small-health-potion");
    game.state.inventory = { [kit.id]: 1, [potion.id]: 1 };
    expect(inventoryScreen.renderMain(game, { kind: "pickItemOutOfCombat" }).split("\n")[0]).toBe(t("ui.inventoryTitle"));
    const detail = (item: typeof kit) => inventoryScreen.renderMain(game, { kind: "itemDetail", item, origin: { kind: "outOfCombat" } });
    expect(detail(kit)).toContain(t("ui.itemCampKitHint"));
    expect(detail(potion)).toContain(t("ui.itemOutOfCombatViewOnlyHint"));
    expect(detail(potion)).not.toContain(t("ui.itemDetailUseOption"));
  });

  test("a trophy is marked with its own icon", () => {
    const game = new Game(1);
    const trophy = ITEMS.find((i) => i.archetypeIds?.length)!;
    game.state.inventory = { [trophy.id]: 1, "small-health-potion": 1 };
    const list = inventoryScreen.renderMain(game, { kind: "pickItemOutOfCombat" });
    expect(list).toContain(`${TROPHY_ICON} ${trophy.name}`);
    expect(list).toContain(`✚ ${getItem("small-health-potion").name}`);
  });
});

describe("skillEffectLine: damage/heal scaling description shows the effect's real offenseMultiplierPercent", () => {
  test("a damage effect below 100% shows its own percent, not a hardcoded 100%", () => {
    const skill = getSkill("volley-shot");
    const effect = skill.effects![0]!; // amount:10, offenseMultiplierPercent:60
    expect(skillEffectLine(effect, skill)).toBe("  • 60% Base Attack + 10 Attack to all enemies");
  });

  test("a damage effect above 100% shows its own percent too", () => {
    const skill = getSkill("throw-axe");
    const effect = skill.effects![0]!; // amount:16, offenseMultiplierPercent:100 (rank 1)
    expect(skillEffectLine(effect, skill)).toBe("  • 100% Base Attack + 16 Attack to an enemy");
  });

  test("a flat-amount-only damage effect (e.g. a basic attack) with no offenseMultiplierPercent falls back to 100%", () => {
    const skill = getSkill("slash");
    const effect = skill.effects![0]!; // amount:0
    expect(effect.offenseMultiplierPercent).toBeUndefined();
    expect(skillEffectLine(effect, skill)).toBe("  • 100% Base Attack to an enemy");
  });

  test("a heal effect with a non-100% offenseMultiplierPercent shows its own percent", () => {
    const skill = getSkill("heal");
    const effect = skill.effects![0]!; // amount:16, offenseMultiplierPercent:90 (rank 1)
    expect(skillEffectLine(effect, skill)).toBe("  • Heals: 90% Base Magic Power + 16 HP to an ally\n  • Up to +40% healing the greater their fear, in full at 70");
  });
});

describe("skillEffectLine: per-effect target overrides (replaces the old effectsByRelation)", () => {
  test("appliesToRelation on a singleAllyOrEnemy skill (Purify) shows the singular ally/enemy suffix per effect", () => {
    const skill = getSkill("purify");
    const [removeStatus, , damage] = skill.effects!;
    expect(removeStatus!.appliesToRelation).toBe("ally");
    expect(skillEffectLine(removeStatus!, skill)).toBe("  • 100%: Removes 1 debuff to an ally");
    expect(damage!.appliesToRelation).toBe("enemy");
    expect(skillEffectLine(damage!, skill)).toBe("  • 100% Base Magic Power + 15 Magic Power to an enemy");
  });

  test("appliesToRelation on an allAlliesAndEnemies skill (Total Plague) shows the plural party/all-enemies suffix per effect", () => {
    const skill = getSkill("total-plague");
    const heal = skill.effects!.find((e) => e.kind === "heal")!;
    const damage = skill.effects!.find((e) => e.kind === "damage")!;
    expect(skillEffectLine(heal, skill)).toContain("to your party");
    expect(skillEffectLine(damage, skill)).toContain("to all enemies");
  });

  test("effect.target overrides the skill's own target for that 1 effect's suffix", () => {
    const skill = getSkill("fireball"); // any allEnemies-less singleEnemy skill works as a stand-in host
    const overriddenEffect: SkillEffect = { kind: "damage", amount: 5, target: "self" };
    expect(skillEffectLine(overriddenEffect, skill)).toContain("to yourself");
  });
});

describe("skillMechanicLines: skill-level mechanics derived from the skill's own data", () => {
  test("an ultimate shows the always-hit / fear rule", () => {
    expect(skillMechanicLines(getSkill("sword-judgment"))).toEqual(["  • Always hits; effectiveness is reduced by fear"]);
  });

  test("executeBonus shows its bonus and HP threshold", () => {
    const { hpPercentThreshold, bonusDamageFlat } = getSkill("death-mark").executeBonus!;
    expect(skillMechanicLines(getSkill("death-mark"))).toContain(`  • +${bonusDamageFlat} damage against targets below ${hpPercentThreshold}% HP`);
  });

  test("conditionalBonus shows the defense ignored, and a consumed status gets its own line", () => {
    const frenzied = getSkill("frenzied-slash");
    expect(skillMechanicLines(frenzied)).toEqual([`  • Ignores ${frenzied.conditionalBonus!.ignoreDefensePercentBonus}% more defense while Storm-Empowered`]);
    expect(skillMechanicLines(getSkill("thunder-gods-fury"))).toContain("  • Consumes Storm-Empowered");
  });

  test("a damage effect's critChance is shown with the base chance every hit has", () => {
    const { critChance } = getSkill("aimed-shot").effects!.find((e) => e.kind === "damage")!;
    const percent = Math.round(critChance! * 100) + BALANCE.combat.baseCritChancePercent;
    expect(percent).toBeGreaterThan(Math.round(critChance! * 100));
    expect(skillMechanicLines(getSkill("aimed-shot"))).toContain(`  • Critical chance: ${percent}%`);
  });

  test("a skill that always crits reads 100%, not more", () => {
    const { critChance } = getSkill("deadeye-shot").effects!.find((e) => e.kind === "damage")!;
    expect(critChance).toBe(1);
    expect(skillMechanicLines(getSkill("deadeye-shot"))).toContain("  • Critical chance: 100%");
  });

  test("a skill with none of these mechanics yields no lines", () => {
    expect(skillMechanicLines(getSkill("slash"))).toEqual([]);
  });
});

describe("skillEffectLine: summon effects show their minion", () => {
  const summonLine = (skillId: string) => {
    const skill = getSkill(skillId);
    return skillEffectLine(skill.effects!.find((e) => e.kind === "summon")!, skill);
  };

  const minion = (castId: string) => {
    const cast = getSummonCast(castId);
    const archetype = getSummonArchetype(cast.archetypeId);
    return { cast, archetype, skills: (archetype.signatureSkillIds ?? []).map((id) => getSummonSkill(id).name) };
  };

  test("a minion with signature skills lists them under its bullet", () => {
    for (const id of ["summon-goblin", "summon-spirit"]) {
      const { cast, archetype, skills } = minion(id);
      expect(skills.length).toBeGreaterThan(0);
      expect(summonLine(id)).toBe(`  • Summons ${archetype.name}: acts up to ${cast.maxActions} times, aggro ${cast.aggro}\n      Skills: ${skills.join(", ")}`);
    }
  });

  test("a minion with no signature skills gets a single line", () => {
    const { cast, archetype, skills } = minion("shadow-clone");
    expect(skills).toEqual([]);
    expect(summonLine("shadow-strike")).toBe(`  • Summons ${archetype.name}: acts up to ${cast.maxActions} times, aggro ${cast.aggro}`);
  });

  test("a passive minion has no action count", () => {
    const { cast, archetype } = minion("totem-recall");
    expect(archetype.passive).toBe(true);
    expect(summonLine("totem-recall")).toBe(`  • Summons ${archetype.name}: aggro ${cast.aggro}`);
  });
});

describe("skillEffectLine: an applied status shows what it does", () => {
  test("every status a class skill applies, at every rank, has a derived line under its bullet", () => {
    for (const cls of CLASSES) {
      for (const base of cls.skills) {
        const effects = [...(base.effects ?? []), ...(base.ranks ?? []).flatMap((r) => r.effects ?? [])];
        for (const e of effects) {
          if (e.kind !== "applyStatusEffect" || !e.statusEffectId) continue;
          const detail = skillEffectLine(e, base)!.split("\n")[1];
          expect(detail, `${base.id} → ${e.statusEffectId}`).toBeDefined();
          expect(detail!.trim(), `${base.id} → ${e.statusEffectId}`).not.toBe("");
          expect(detail, `${base.id} → ${e.statusEffectId}`).not.toContain("no per-turn effect");
        }
      }
    }
  });

  test("a status whose magnitude the skill sets shows that magnitude and its floor, not the status's own 0", () => {
    const skill = getSkill("totem-recall");
    const effect = skill.effects!.find((e) => e.kind === "applyStatusEffect")!;
    expect(skillEffectLine(effect, skill)).toContain(`\n      +${effect.amount} attack (or ${effect.minPercent}% of the bearer's attack if larger)`);
  });

  test("Storm-Empowered shows its splash with the multiplier and the defense it ignores", () => {
    const skill = getSkill("lightning-axe");
    const effect = skill.effects!.find((e) => e.kind === "applyStatusEffect" && e.statusEffectId?.startsWith("storm-empowered"))!;
    const aoe = getStatusEffect(effect.statusEffectId!).onHitAoeDamage!;
    expect(skillEffectLine(effect, skill)).toContain(
      `splashes ${aoe.amount} damage plus ${aoe.offenseMultiplierPercent}% of the bearer's magic power to all enemies, ignoring ${aoe.ignoreDefensePercent}% of their defense`
    );
  });

  test("Poison Coat says that its hits also poison", () => {
    const skill = getSkill("poison-coat");
    const line = skillEffectLine(skill.effects!.find((e) => e.kind === "applyStatusEffect")!, skill);
    expect(line).toContain("every landed hit also applies Poisoned");
  });
});

describe("skill detail screen", () => {
  function detail(skill: SkillDefinition, setUp?: (actor: Character) => void): string {
    const game = new Game(1);
    const actor = game.state.party[0]!;
    setUp?.(actor);
    return renderCombat(game, { kind: "skillDetail", actorRef: { kind: "character", id: actor.id }, skill }) as string;
  }

  test("every class skill shows at least one Effects line", () => {
    for (const cls of CLASSES) {
      for (const base of cls.skills) {
        const skill = getSkill(base.id);
        const lines = [...(skill.effects ?? []).map((e) => skillEffectLine(e, skill)).filter((l) => l !== null), ...skillMechanicLines(skill)];
        expect(lines.length, base.id).toBeGreaterThan(0);
      }
    }
  });

  test("lists the mechanic lines under Effects", () => {
    const text = detail(getSkill("sword-judgment"));
    expect(text).toContain("Effects:");
    expect(text).toContain("  • Always hits; effectiveness is reduced by fear");
  });

  test("estimated damage follows the effect's offenseMultiplierPercent", () => {
    const check = (skillId: string, stat: "attack" | "magicPower", value: number) => {
      const skill = getSkill(skillId);
      const effect = skill.effects!.find((e) => e.kind === "damage")!;
      const expected = Math.round((effect.amount ?? 0) + value * ((effect.offenseMultiplierPercent ?? 100) / 100));
      expect(detail(skill, (a) => (a[stat] = value))).toContain(`Estimated damage: ~${expected}`);
    };
    check("quick-shot", "attack", 20);
    check("hollow-pulse", "magicPower", 30);
  });

  test("an executeBonus shows a percent bonus, both bonuses, and nothing when it carries no bonus", () => {
    const withBonus = (executeBonus: NonNullable<SkillDefinition["executeBonus"]>) => ({ ...getSkill("death-mark"), executeBonus });
    expect(skillMechanicLines(withBonus({ hpPercentThreshold: 25, bonusDamagePercent: 20 }))).toContain("  • +20% damage against targets below 25% HP");
    expect(skillMechanicLines(withBonus({ hpPercentThreshold: 25, bonusDamageFlat: 10, bonusDamagePercent: 20 }))).toContain("  • +10 and +20% damage against targets below 25% HP");
    expect(skillMechanicLines(withBonus({ hpPercentThreshold: 25 })).some((l) => l.includes("damage against"))).toBe(false);
  });
});

describe("Rest room runner screens", () => {
  async function restApp(opts: { runner: boolean; campReflection?: boolean }) {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({ width: 100, height: 40 });
    const game = new Game(7);
    game.state.combat = null;
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.type = "rest";
    room.cleared = false;
    if (opts.runner) {
      game.state.restRunner = {
        roomId: room.id,
        noticeShown: false,
        noticeVariant: 1,
        offers: [{ itemId: "small-health-potion", lot: false }, { itemId: "antidote", lot: true }],
        refreshCount: 0,
      };
    }
    if (opts.campReflection) game.state.pendingCampReflectionTier = 1;
    const app = new App(renderer, game);
    await renderOnce();
    return { app, game, room, mockInput, renderOnce };
  }

  test("the notice comes first, then the Rest choices with Trade, then the shop closes the room on leaving", async () => {
    const { app, game, room, mockInput, renderOnce } = await restApp({ runner: true, campReflection: true });
    expect(app.debugUiState.kind).toBe("runnerNotice");

    mockInput.pressKey("RETURN");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("rest");

    game.state.coins = 100;
    mockInput.pressKey("3");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("runnerShop");

    mockInput.pressKey("1"); // buy the single Small Health Potion for 15
    await renderOnce();
    expect(game.state.coins).toBe(85);
    expect(app.debugUiState.kind).toBe("runnerShop");
    expect(game.state.restRunner?.offers[0]?.sold).toBe(true);

    mockInput.pressKey("r"); // refresh costs 10
    await renderOnce();
    expect(game.state.coins).toBe(75);
    expect(app.debugUiState.kind).toBe("runnerShop");

    mockInput.pressKey("RETURN"); // leave: trading replaces the rest action
    await renderOnce();
    expect(room.cleared).toBe(true);
    expect(game.state.restRunner).toBeNull();
    expect(app.debugUiState.kind).toBe("campReflection");
  });

  test("an artifact's detail view offers Back as its only option", () => {
    const artifact = ARTIFACTS[0]!;
    const text = artifactsScreen.renderMain(new Game(7), { kind: "artifactDetail", artifactId: artifact.id, origin: { kind: "owned", characterId: "x" } });
    expect(text).toContain(artifact.name);
    expect(text.split("\n").at(-1)).toBe("  [1] Back");
  });

  test("each shop offer shows what the item does", async () => {
    const { game } = await restApp({ runner: true });
    const text = runnerScreen.renderMain(game, { kind: "runnerShop" });
    expect(text).toContain("Small Health Potion — costs 15 coins");
    expect(text).toContain("Instantly restores 60 HP.");
    expect(text).toContain("Antidote ×3 — costs 40 coins");
    expect(text).toContain("Removes Poisoned.");
  });

  test("selling lists what the runner buys, pays out, and returns to the shop", async () => {
    const { app, game, mockInput, renderOnce } = await restApp({ runner: true });
    mockInput.pressKey("RETURN");
    await renderOnce();
    game.state.inventory = { "rat-tail": 1 };
    game.state.coins = 0;
    mockInput.pressKey("3");
    await renderOnce();
    mockInput.pressKey("x");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("runnerSell");

    mockInput.pressEscape(); // back to the shop without selling
    await new Promise((resolve) => setTimeout(resolve, 100)); // a lone Esc is held back briefly to tell it from an escape sequence
    await renderOnce();
    expect(app.debugUiState.kind).toBe("runnerShop");
    expect(game.state.inventory["rat-tail"]).toBe(1);
    mockInput.pressKey("x");
    await renderOnce();

    mockInput.pressKey("1");
    await renderOnce();
    expect(game.state.coins).toBe(5);
    expect(game.state.inventory["rat-tail"]).toBe(0);
    expect(app.debugUiState.kind).toBe("runnerShop"); // nothing left to sell
  });

  test("bartering lists each offer with the buff it buys, trades it, and hides [t] once none are left", async () => {
    const { app, game, mockInput, renderOnce } = await restApp({ runner: true });
    game.state.restRunner!.barterOffers = [{ itemId: "rat-tail" }, { itemId: "warped-vambrace" }];
    mockInput.pressKey("RETURN");
    await renderOnce();
    mockInput.pressKey("3");
    await renderOnce();
    expect(runnerScreen.renderFooter({ kind: "runnerShop" }, game)).toContain("[t] Barter");

    mockInput.pressKey("t");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("runnerBarter");
    const text = runnerScreen.renderMain(game, { kind: "runnerBarter" });
    expect(text).toContain("Rat Tail ×5 (you have 0)");
    expect(text).toContain("attack and magic power +4%, defense +4%, speed +4%");
    expect(text).toContain("Warped Vambrace ×3");

    game.state.inventory["rat-tail"] = 5;
    mockInput.pressKey("1");
    await renderOnce();
    expect(game.state.inventory["rat-tail"]).toBe(0);
    expect(game.state.pendingBarterBuffs).toEqual(["rat-tail"]);
    expect(app.debugUiState.kind).toBe("runnerBarter");
    expect(runnerScreen.renderMain(game, { kind: "runnerBarter" })).not.toContain("Rat Tail");

    mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await renderOnce();
    expect(app.debugUiState.kind).toBe("runnerShop");

    game.state.inventory["warped-vambrace"] = 3;
    mockInput.pressKey("t");
    await renderOnce();
    mockInput.pressKey("1"); // the one offer left
    await renderOnce();
    expect(app.debugUiState.kind).toBe("runnerShop"); // nothing left to trade
    expect(runnerScreen.renderFooter({ kind: "runnerShop" }, game)).not.toContain("[t] Barter");
  });

  test("a Rest room without the runner keeps its two choices, and Camp Reflection waits for the choice", async () => {
    const { app, game, room, mockInput, renderOnce } = await restApp({ runner: false, campReflection: true });
    expect(app.debugUiState.kind).toBe("rest");

    mockInput.pressKey("3"); // no Trade option here
    await renderOnce();
    expect(app.debugUiState.kind).toBe("rest");
    expect(room.cleared).toBe(false);

    mockInput.pressKey("RETURN"); // skip
    await renderOnce();
    expect(room.cleared).toBe(true);
    expect(game.state.restRunner ?? null).toBeNull();
    expect(app.debugUiState.kind).toBe("campReflection");
  });
});

describe("a panel scrolled with the mouse wheel", () => {
  /** A Rest room with a Runner in it, entered from a fresh run. */
  function gameInRunnerRoom(): Game {
    for (let seed = 1; seed < 300; seed++) {
      const game = new Game(seed, ["knight", "mage", "rogue", "acolyte"]);
      game.state.combat = null;
      const rest = game.state.floor.rooms.find((r) => r.type === "rest")!;
      game.state.currentRoomId = rest.id;
      enterRoom(game.state, rest, game.ctx);
      if (game.state.restRunner) return game;
    }
    throw new Error("no seed rolled a Runner");
  }

  /** The Dungeon panel and everything below it. */
  const dungeonOf = (frame: string) => {
    const rows = frame.split("\n");
    return rows.slice(rows.findIndex((r) => r.includes("─Dungeon")) + 1).join("\n");
  };

  test("does not carry its offset into the next, shorter screen", async () => {
    // Short enough that the shop overflows the Dungeon panel, so there is an offset to carry.
    const { renderer, mockInput, mockMouse, renderOnce, captureCharFrame } = await createTestRenderer({ width: 160, height: 44 });
    const app = new App(renderer, gameInRunnerRoom(), { autoReveal: false });
    await renderOnce();
    const dungeon = () => dungeonOf(captureCharFrame());

    mockInput.pressKey("RETURN");
    await renderOnce();
    mockInput.pressKey("3");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("runnerShop");
    expect(dungeon()).toContain("You have");
    await mockMouse.scroll(90, 33, "down");
    await renderOnce();
    expect(dungeon()).not.toContain("You have");

    mockInput.pressKey("RETURN");
    await renderOnce();
    mockInput.pressKey("1");
    await renderOnce();
    for (let i = 0; i < 50 && app.debugRevealActive; i++) app.tickReveal();
    await renderOnce();
    expect(app.debugUiState.kind).toBe("pickAction");
    expect(dungeon()).toContain("choose an action");
  });

  test("keeps its offset across re-renders when its lines wrap", async () => {
    // At this width the shop's lines wrap: the panel holds more rows than it has lines of text.
    const { renderer, mockInput, mockMouse, renderOnce, captureCharFrame } = await createTestRenderer({ width: 100, height: 50 });
    const app = new App(renderer, gameInRunnerRoom(), { autoReveal: false });
    await renderOnce();
    mockInput.pressKey("RETURN");
    await renderOnce();
    mockInput.pressKey("3");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("runnerShop");
    const top = dungeonOf(captureCharFrame());
    for (let i = 0; i < 20; i++) await mockMouse.scroll(50, 33, "down");
    await renderOnce();
    const scrolled = dungeonOf(captureCharFrame());
    expect(scrolled).not.toBe(top);

    app.tickReveal(); // a render with nothing new to show
    await renderOnce();
    expect(dungeonOf(captureCharFrame())).toBe(scrolled);
  });
});

describe("layout", () => {
  const panelRows = (frame: string, title: string) => panelContentRows(frame.split("\n"), title);

  /** Seed 7 opens on an entry-room ambush of normal monsters; `boss` swaps it for a lone boss. */
  async function openFight(width: number, height: number, boss = false) {
    const game = new Game(7, ["knight", "mage", "rogue", "acolyte"]);
    if (boss) {
      const room = getRoom(game.state.floor, game.state.currentRoomId);
      const monster = spawnMonster("skeleton-guard", 1, { tier: "boss" });
      game.ctx.monsters.push(monster);
      room.monsterIds = [monster.id];
      game.state.combat = startCombat(room.id, [monster.id], game.ctx, true);
    }
    const setup = await createTestRenderer({ width, height });
    const app = new App(setup.renderer, game, { autoReveal: false });
    await setup.renderOnce();
    expect(app.debugUiState.kind).toBe("pickAction");
    return { ...setup, game, app };
  }

  test("at 150x45 the Log sits beside the battlefield, as tall as it, and the Dungeon panel has room", async () => {
    const { captureCharFrame, game } = await openFight(150, 45);
    const frame = captureCharFrame();
    const rows = frame.split("\n");
    expect(frame).not.toContain("─Path─");
    expect(panelRows(frame, t("ui.panelBattlefield"))).toBe(UNIT_BLOCK_HEIGHT);
    expect(panelRows(frame, t("ui.panelLog"))).toBe(UNIT_BLOCK_HEIGHT);
    expect(rows.findIndex((r) => r.includes(`─${t("ui.panelLog")}`))).toBe(rows.findIndex((r) => r.includes(`─${t("ui.panelBattlefield")}`)));
    expect(panelRows(frame, t("ui.panelMain"))).toBeGreaterThanOrEqual(10);
    expect(rows[44]).toContain("[Ctrl+C] Quit");
    for (const abbr of ["KN", "MG", "RG", "AC"]) expect(frame).toMatch(new RegExp(`│[^│]*\\b${abbr}\\b`));
    for (const c of game.state.party) expect(frame).toContain(`${c.hp}/${c.maxHp}`);
  });

  test("the Log keeps its width on a wide terminal, and a long entry wraps under its icon", async () => {
    const { captureCharFrame, renderOnce, app } = await openFight(200, 45);
    app.pushToast("Knight uses Slash on Goblin for 23 damage, and the goblin staggers back into the corner.");
    app.tickReveal(); // the first tick renders, which queues the toast
    for (let i = 0; i < 500 && app.debugRevealActive; i++) app.tickReveal();
    await renderOnce();
    const rows = captureCharFrame().split("\n");
    const top = rows.findIndex((r) => r.includes(`─${t("ui.panelLog")}`));
    const left = rows[top]!.indexOf(`─${t("ui.panelLog")}`) - 1;
    expect(rows[top]!.indexOf("┐", left) - left + 1).toBe(35);
    const panel = rows.slice(top + 1, top + 1 + UNIT_BLOCK_HEIGHT).map((r) => r.slice(left + 1, left + 34));
    const first = panel.findIndex((line) => line.includes("Knight uses"));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(panel[first + 1]).toMatch(/^ {2}\S/);
  });

  test("the Log and the Monsters panel below it share their left edge", async () => {
    for (const width of [150, 200]) {
      const { captureCharFrame, renderer } = await openFight(width, 45);
      const rows = captureCharFrame().split("\n");
      const leftEdge = (title: string) => rows.find((r) => r.includes(`─${title}`))!.indexOf(`─${title}`) - 1;
      expect(leftEdge(t("ui.panelLog")), `${width}`).toBe(leftEdge(t("ui.panelMonsters")));
      renderer.destroy();
    }
  });

  test("the battlefield is as tall in an ordinary fight as against a boss", async () => {
    for (const boss of [false, true]) {
      const { captureCharFrame, renderer } = await openFight(150, 45, boss);
      expect(panelRows(captureCharFrame(), t("ui.panelBattlefield")), boss ? "boss" : "ordinary").toBe(UNIT_BLOCK_HEIGHT);
      renderer.destroy();
    }
  });

  async function openBossFight(archetypeId: string, tier: "boss" | "elite", meter?: number) {
    const game = new Game(7, ["knight", "mage", "rogue", "acolyte"]);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    const monster = spawnMonster(archetypeId, 1, { tier });
    if (meter !== undefined) monster.telegraphMeter = meter;
    game.ctx.monsters.push(monster);
    room.monsterIds = [monster.id];
    game.state.combat = startCombat(room.id, [monster.id], game.ctx, true);
    const setup = await createTestRenderer({ width: 150, height: 45 });
    new App(setup.renderer, game, { autoReveal: false });
    await setup.renderOnce();
    return setup;
  }

  test("a boss shows its telegraph meter under its HP, filled icons first", async () => {
    const { captureCharFrame, renderer } = await openBossFight("skeleton-guard", "boss", 3);
    const rows = captureCharFrame().split("\n");
    const hpRow = rows.findIndex((r) => r.includes(t("ui.hpLabel")) && r.includes("/") && r.includes("█"));
    expect(rows[hpRow + 1]).toContain("◆◆◆◇◇");
    renderer.destroy();
  });

  test("the Founder shows his phase next to his name and the bar's HP and meter of that phase", async () => {
    const { captureCharFrame, renderer } = await openBossFight("the-founder", "boss", 2);
    const frame = captureCharFrame();
    expect(frame).toContain("Phase 1/3");
    expect(frame).toContain("◆◆◇◇");
    renderer.destroy();
  });

  test("a boss without bars shows no phase", async () => {
    const { captureCharFrame, renderer } = await openBossFight("skeleton-guard", "boss");
    expect(captureCharFrame()).not.toContain("Phase ");
    renderer.destroy();
  });

  test("the Founder on his second bar reads Phase 2/3 with that bar's HP", async () => {
    const game = new Game(7, ["knight", "mage", "rogue", "acolyte"]);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    const founder = spawnMonster("the-founder", 1, { tier: "boss" });
    founder.barIndex = 1;
    founder.maxHp = founder.hp = Math.round(founder.barBaseHp! * getArchetype("the-founder").bars![1]!.hpMultiplier);
    founder.telegraphMeter = 1;
    game.ctx.monsters.push(founder);
    room.monsterIds = [founder.id];
    game.state.combat = startCombat(room.id, [founder.id], game.ctx, true);
    const setup = await createTestRenderer({ width: 150, height: 45 });
    new App(setup.renderer, game, { autoReveal: false });
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Phase 2/3");
    expect(frame).toContain(`${founder.hp}/${founder.maxHp}`);
    expect(frame).toContain("◆◇◇◇");
    setup.renderer.destroy();
  });

  test("elites and meterless bosses show no meter", async () => {
    for (const [id, tier] of [["skeleton-guard", "elite"], ["orc-chieftain", "boss"]] as const) {
      const { captureCharFrame, renderer } = await openBossFight(id, tier);
      const frame = captureCharFrame();
      expect(frame, `${id} ${tier}`).not.toMatch(/[◆◇]/);
      renderer.destroy();
    }
  });

  test("a taller terminal gives its extra rows to the Dungeon panel, not the battlefield", async () => {
    const { captureCharFrame, resize, renderOnce } = await openFight(150, 45);
    const before = panelRows(captureCharFrame(), t("ui.panelMain"))!;
    resize(150, 70);
    await renderOnce();
    expect(panelRows(captureCharFrame(), t("ui.panelBattlefield"))).toBe(UNIT_BLOCK_HEIGHT);
    expect(panelRows(captureCharFrame(), t("ui.panelMain"))).toBe(before + 25);
  });

  const PANEL_BG = RGBA.fromHex(PALETTE.panelBg);
  const sameRgba = (a: RGBA, b: RGBA) => a.r === b.r && a.g === b.g && a.b === b.b;

  /** The background of terminal cell (x, y), read from the rendered spans. */
  function bgAt(frame: CapturedFrame, x: number, y: number): RGBA {
    let col = 0;
    for (const span of frame.lines[y]!.spans) {
      if (x < col + span.width) return span.bg;
      col += span.width;
    }
    throw new Error(`no cell at ${x},${y}`);
  }

  /** Left border column and first content row of the Battlefield panel. */
  function battlefieldOrigin(frame: string): { left: number; top: number } {
    const rows = frame.split("\n");
    const top = rows.findIndex((r) => r.includes(`─${t("ui.panelBattlefield")}`));
    return { left: rows[top]!.indexOf(`─${t("ui.panelBattlefield")}`) - 1, top: top + 1 };
  }

  test("the battlefield is painted to the panel's full width in a fight", async () => {
    for (const width of [150, 200]) {
      const { captureCharFrame, captureSpans, renderer } = await openFight(width, 45);
      const { left, top } = battlefieldOrigin(captureCharFrame());
      const spans = captureSpans();
      const innerWidth = width - 35 - 2;
      for (const x of [left + 1, left + innerWidth]) expect(sameRgba(bgAt(spans, x, top), PANEL_BG), `${width} col ${x}`).toBe(false);
      renderer.destroy();
    }
  });

  test("a resize repaints the backdrop at the new width and keeps the units centred", async () => {
    const { captureCharFrame, captureSpans, resize, renderOnce, renderer } = await openFight(150, 45);
    const labelColumn = () => {
      const rows = captureCharFrame().split("\n");
      const { left, top } = battlefieldOrigin(rows.join("\n"));
      const row = rows.slice(top, top + UNIT_BLOCK_HEIGHT).find((r) => /\bKN\b/.test(r.slice(left)))!;
      return row.slice(left).search(/\bKN\b/);
    };
    const before = labelColumn();
    resize(200, 45);
    await renderOnce();
    const { left, top } = battlefieldOrigin(captureCharFrame());
    expect(sameRgba(bgAt(captureSpans(), left + 200 - 35 - 2, top), PANEL_BG)).toBe(false);
    expect(labelColumn()).toBe(before + (200 - 150) / 2);
    renderer.destroy();
  });

  test("a resize re-centres the floor map on the battlefield", async () => {
    const game = new Game(10, ["knight", "mage", "rogue", "acolyte"]);
    game.state.combat = null;
    getRoom(game.state.floor, game.state.currentRoomId).cleared = true;
    const setup = await createTestRenderer({ width: 180, height: 70 });
    new App(setup.renderer, game, { autoReveal: false });
    await setup.renderOnce();
    setup.resize(150, 45);
    await setup.renderOnce();
    const map = renderFloorMap(game.state.floor, game.state.roomPath, game.state.currentRoomId);
    const frame = setup.captureCharFrame();
    const { left } = battlefieldOrigin(frame);
    const row = frame.split("\n").find((r) => r.includes("[ ■ ]"))!;
    expect(row.indexOf("[ ■ ]") - left - 1).toBe(Math.floor((150 - 35 - 2 - map.width) / 2));
    setup.renderer.destroy();
  });

  test("label and HP rows keep the panel colour", async () => {
    const { captureCharFrame, captureSpans, renderer } = await openFight(150, 45);
    const { left, top } = battlefieldOrigin(captureCharFrame());
    const spans = captureSpans();
    for (const row of [UNIT_BLOCK_HEIGHT - 2, UNIT_BLOCK_HEIGHT - 1]) {
      for (const x of [left + 1, left + 40, left + 113]) expect(sameRgba(bgAt(spans, x, top + row), PANEL_BG), `row ${row} col ${x}`).toBe(true);
    }
    renderer.destroy();
  });

  test("the backdrop dims while a round is narrated and not while choosing actions", async () => {
    const fight = await openFight(150, 45);
    const { left, top } = battlefieldOrigin(fight.captureCharFrame());
    const wall = () => bgAt(fight.captureSpans(), left + 1, top);
    const before = wall();
    let guard = 0;
    while (!fight.app.debugRevealActive && guard++ < 30) {
      fight.mockInput.pressKey(fight.app.debugUiState.kind === "skillDetail" ? "RETURN" : "1");
      await fight.renderOnce();
    }
    expect(fight.app.debugRevealActive).toBe(true);
    let dimmed = false;
    for (guard = 0; fight.app.debugRevealActive && guard++ < 400; ) {
      fight.app.tickReveal();
      await fight.renderOnce();
      if (fight.app.debugLastRender.focusId !== null && !sameRgba(wall(), before)) dimmed = true;
    }
    expect(dimmed).toBe(true);
    await fight.renderOnce();
    expect(fight.app.debugRevealActive).toBe(false);
    expect(sameRgba(wall(), before)).toBe(true);
    fight.renderer.destroy();
  });

  test("a room whose name has no scene draws the plain panel", async () => {
    const game = new Game(7, ["knight", "mage", "rogue", "acolyte"]);
    getRoom(game.state.floor, game.state.currentRoomId).name = "No Such Room";
    const setup = await createTestRenderer({ width: 150, height: 45 });
    new App(setup.renderer, game, { autoReveal: false });
    await setup.renderOnce();
    const { left, top } = battlefieldOrigin(setup.captureCharFrame());
    const spans = setup.captureSpans();
    for (const x of [left + 1, left + 113]) expect(sameRgba(bgAt(spans, x, top), PANEL_BG)).toBe(true);
    setup.renderer.destroy();
  });

  test("a pending Gatekeeper shows its own backdrop, not the first room's", async () => {
    const topLeftBg = async (pending: boolean) => {
      const game = new Game(7, ["knight", "mage", "rogue", "acolyte"]);
      game.state.pendingGatekeeper = pending;
      const setup = await createTestRenderer({ width: 150, height: 45 });
      new App(setup.renderer, game, { autoReveal: false });
      await setup.renderOnce();
      const { left, top } = battlefieldOrigin(setup.captureCharFrame());
      const bg = bgAt(setup.captureSpans(), left + 1, top);
      setup.renderer.destroy();
      return bg;
    };
    expect(getEvent(GATEKEEPER_EVENT_ID).backdrop).toBeDefined();
    const gatekeeper = await topLeftBg(true);
    expect(sameRgba(gatekeeper, PANEL_BG)).toBe(false);
    expect(sameRgba(gatekeeper, await topLeftBg(false))).toBe(false);
  });
});

describe("memory screen", () => {
  const SLOT = "slot1";

  async function bossWinInSlot(memoryUnlocked: boolean) {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 100, height: 40 });
    const profile = loadProfile(SLOT);
    profile.unlockedAbilityIds = ["bloodletting"];
    profile.memoryUnlocked = memoryUnlocked;
    saveProfile(SLOT, profile);
    const game = new Game(7, undefined, undefined, undefined, false, SLOT);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.type = "boss";
    const boss = spawnMonster("skeleton-guard", 1, { tier: "boss" });
    boss.hp = 1;
    game.ctx.monsters.push(boss);
    room.monsterIds = [boss.id];
    room.cleared = false;
    game.state.combat = startCombat(room.id, [boss.id], game.ctx, true);
    const app = new App(renderer, game);
    await renderOnce();
    return { game, renderer, app, mockInput, renderOnce, captureCharFrame };
  }

  test("the first boss win shows the intro, then [m] opens the slot's held abilities and Esc returns", async () => {
    try {
      const { renderer, app, mockInput, renderOnce, captureCharFrame } = await bossWinInSlot(false);
      let guard = 0;
      while (app.debugUiState.kind !== "memoryIntro" && guard < 80) {
        guard++;
        const kind = app.debugUiState.kind;
        // Unlocked by now, but not offered until the intro has introduced it.
        if (kind === "roomReward") expect(captureCharFrame()).not.toContain("[m] Memory");
        mockInput.pressKey(kind === "roomReward" || kind === "skillDetail" ? "RETURN" : "1");
        await renderOnce();
      }
      expect(app.debugUiState.kind).toBe("memoryIntro");
      mockInput.pressKey("m");
      await renderOnce();
      expect(app.debugUiState.kind).toBe("memoryIntro");

      mockInput.pressKey("RETURN");
      await renderOnce();
      expect(app.debugUiState.kind).not.toBe("memoryIntro");
      const before = app.debugUiState.kind;

      mockInput.pressKey("m");
      await renderOnce();
      expect(app.debugUiState.kind).toBe("memory");
      expect(captureCharFrame()).toContain("Bloodletting");

      // A lone Esc from the mock input waits on the parser's escape-sequence timeout; emitting the event directly keeps the test off the clock.
      renderer.keyInput.emit("keypress", new KeyEvent({ name: "escape", ctrl: false, meta: false, shift: false, option: false, sequence: "\x1b", number: false, raw: "\x1b", eventType: "press", source: "raw" }));
      await renderOnce();
      expect(app.debugUiState.kind).toBe(before);
    } finally {
      clearSlot(SLOT);
    }
  }, 20000);

  test("every Memory page fits the Dungeon panel at the minimum 150x45 terminal", async () => {
    try {
      const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 150, height: 45 });
      const held = ABILITIES.filter((a) => a.rarity !== "common");
      saveProfile(SLOT, { ...loadProfile(SLOT), unlockedAbilityIds: held.map((a) => a.id), memoryUnlocked: true, memoryIntroShown: true });
      const game = new Game(7, undefined, undefined, undefined, false, SLOT);
      game.state.combat = null;
      const app = new App(renderer, game);
      await renderOnce();
      mockInput.pressKey("m");
      await renderOnce();
      expect(app.debugUiState.kind).toBe("memory");
      const seen = new Set<string>();
      let previous = "";
      for (let guard = 0; guard < 20 && captureCharFrame() !== previous; guard++) {
        previous = captureCharFrame();
        for (const ability of held) if (previous.includes(`${ability.name} (${ability.rarity})`)) seen.add(ability.id);
        mockInput.pressArrow("right");
        await renderOnce();
      }
      expect([...seen].sort()).toEqual(held.map((a) => a.id).sort());
    } finally {
      clearSlot(SLOT);
    }
  }, 20000);

  test("a slot that has not unlocked Memory advertises nothing and ignores [m]", async () => {
    try {
      const { game, app, mockInput, renderOnce, captureCharFrame } = await bossWinInSlot(false);
      expect(game.memoryUnlocked).toBe(false);
      mockInput.pressKey("m");
      await renderOnce();
      expect(app.debugUiState.kind).not.toBe("memory");
      expect(captureCharFrame()).not.toContain("[m] Memory");
    } finally {
      clearSlot(SLOT);
    }
  });
});
