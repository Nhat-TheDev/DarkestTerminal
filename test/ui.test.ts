import { describe, test, expect } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { getSkill } from "../src/data/classes";
import type { Character, SkillEffect } from "../src/types";
import { getActorByRef, startCombat } from "../src/engine/combat";
import { spawnMonster } from "../src/data/monsters";
import { getRoom } from "../src/engine/dungeon";
import { ARTIFACTS } from "../src/data/artifacts";
import { showMainMenu } from "../src/ui/mainMenu";
import { CLASSES } from "../src/data/classes";
import { skillEffectLine } from "../src/ui/screens/combat";

describe("headless UI smoke test", () => {
  test("plays a scripted run via keypresses without crashing", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 100, height: 40 });
    const app = new App(renderer, new Game(7));
    await renderOnce();

    const firstFrame = captureCharFrame();
    expect(firstFrame).toContain("DARKEST-TERMINAL");
    const startingDepth = app.debugGame.state.floor.depth;

    let guard = 0;
    while (app.debugUiState.kind !== "gameover" && guard < 800) {
      guard++;
      const ui = app.debugUiState;

      if (ui.kind === "roomReward" || ui.kind === "skillDetail") {
        mockInput.pressKey("RETURN");
        await renderOnce();
        continue;
      }

      let key = "1";
      if (ui.kind === "room") {
        const choices = app.debugGame.connectedRoomChoices();
        const idx = choices.findIndex((r) => !r.cleared);
        key = String((idx >= 0 ? idx : 0) + 1);
      } else if (ui.kind === "pickAction") {
        key = "1";
      } else if (ui.kind === "pickSkill") {
        const actor = getActorByRef(ui.actorRef, app.debugGame.ctx) as Character;
        const skills = actor.unlockedSkillIds.map(getSkill);
        const attackIdx = skills.findIndex((s) => s.target === "singleEnemy" && actor.mp >= s.mpCost);
        key = String((attackIdx >= 0 ? attackIdx : 0) + 1);
      } else if (ui.kind === "pickTarget") {
        key = "1";
      } else {
        key = "1";
      }

      mockInput.pressKey(key);
      await renderOnce();
    }

    const outcome = app.debugGame.state.gameOver;
    expect(outcome).not.toBe("victory");
    if (outcome === null) {
      expect(app.debugGame.state.floor.depth).toBeGreaterThan(startingDepth);
    } else {
      expect(outcome).toBe("defeat");
    }

    const finalFrame = captureCharFrame();
    expect(finalFrame.length).toBeGreaterThan(0);
  }, 20000);

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
    while (app.debugUiState.kind !== "artifactDecision" && guard < 40) {
      guard++;
      if (app.debugUiState.kind === "roomReward" || app.debugUiState.kind === "skillDetail") mockInput.pressKey("RETURN");
      else mockInput.pressKey("1");
      await renderOnce();
    }
    expect(app.debugUiState.kind).toBe("artifactDecision");
    expect(game.state.floor.depth).toBe(1); // must not have advanced yet — the decision comes first

    mockInput.pressKey("1"); // Equip
    await renderOnce();
    mockInput.pressKey("1"); // pick character 1
    await renderOnce();

    expect(game.state.pendingArtifactDecision).toBeNull();
    expect(app.debugUiState.kind).toBe("campPrompt"); // Camp offer comes after the decision, before the floor advances
    expect(game.state.floor.depth).toBe(1);

    mockInput.pressKey("RETURN"); // skip Camp
    await renderOnce();

    expect(game.state.floor.depth).toBe(2); // now it advances
  }, 20000);

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

    expect(app.debugUiState.kind).toBe("eventMerchant");

    mockInput.pressKey("1"); // view the first offer's detail
    await renderOnce();
    let ui = app.debugUiState;
    if (ui.kind !== "eventMerchant") throw new Error(`expected eventMerchant, got ${ui.kind}`);
    expect(ui.viewingOfferIndex).toBe(0);

    mockInput.pressKey("2"); // cancel back to the offer list
    await renderOnce();
    ui = app.debugUiState;
    if (ui.kind !== "eventMerchant") throw new Error(`expected eventMerchant, got ${ui.kind}`);
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

    // `.once("keypress", ...)` looks right here but never removes itself under
    // InternalKeyHandler.emit, which left the menu re-registering a handler on every single
    // keypress for the rest of the run.
    const settled = listeners();
    for (const key of ["b", "b", "1", "2", "b"]) await press(key);

    expect(listeners()).toBe(settled);
  });
});

describe("character info screen", () => {
  test("shows which digit switches to which party member, and switches on that digit", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 45 });
    const classIds = CLASSES.slice(0, 4).map((c) => c.id);
    const app = new App(renderer, new Game(7, classIds));
    await renderOnce();
    mockInput.pressKey("RETURN"); // skip the ambush reveal
    await renderOnce();
    mockInput.pressKey("b");
    await renderOnce();

    const opened = captureCharFrame();
    expect(opened).toContain("[2] Mage");
    expect(opened).toContain("Vanguard (Level 1 Vanguard)");
    expect(opened).toContain("[1-4] Character");

    mockInput.pressKey("3");
    await renderOnce();
    expect(captureCharFrame()).toContain("Rogue (Level 1 Rogue)");
  });
});

describe("skillEffectLine: damage/heal scaling description shows the effect's real offenseMultiplierPercent", () => {
  test("a damage effect below 100% shows its own percent, not a hardcoded 100%", () => {
    const skill = getSkill("archer-volley-shot");
    const effect = skill.effects![0]!; // amount:10, offenseMultiplierPercent:60
    expect(skillEffectLine(effect, skill)).toBe("  • 60% Base Attack + 10 Attack to all enemies");
  });

  test("a damage effect above 100% shows its own percent too", () => {
    const skill = getSkill("viking-throw-axe");
    const effect = skill.effects![0]!; // amount:16, offenseMultiplierPercent:100 (rank 1)
    expect(skillEffectLine(effect, skill)).toBe("  • 100% Base Attack + 16 Attack to an enemy");
  });

  test("a flat-amount-only damage effect (e.g. a basic attack) with no offenseMultiplierPercent falls back to 100%", () => {
    const skill = getSkill("vanguard-slash");
    const effect = skill.effects![0]!; // amount:0
    expect(effect.offenseMultiplierPercent).toBeUndefined();
    expect(skillEffectLine(effect, skill)).toBe("  • 100% Base Attack to an enemy");
  });

  test("a heal effect with a non-100% offenseMultiplierPercent shows its own percent", () => {
    const skill = getSkill("acolyte-heal");
    const effect = skill.effects![0]!; // amount:16, offenseMultiplierPercent:90 (rank 1)
    expect(skillEffectLine(effect, skill)).toBe("  • Heals: 90% Base Magic Power + 16 HP to an ally");
  });
});

describe("skillEffectLine: per-effect target overrides (replaces the old effectsByRelation)", () => {
  test("appliesToRelation on a singleAllyOrEnemy skill (Purify) shows the singular ally/enemy suffix per effect", () => {
    const skill = getSkill("acolyte-purify");
    const [removeStatus, damage] = skill.effects!;
    expect(removeStatus!.appliesToRelation).toBe("ally");
    expect(skillEffectLine(removeStatus!, skill)).toBe("  • 100%: Removes 1 debuff to an ally");
    expect(damage!.appliesToRelation).toBe("enemy");
    expect(skillEffectLine(damage!, skill)).toBe("  • 100% Base Magic Power + 15 Magic Power to an enemy");
  });

  test("appliesToRelation on an allAlliesAndEnemies skill (Total Plague) shows the plural party/all-enemies suffix per effect", () => {
    const skill = getSkill("plaguedoc-total-plague");
    const heal = skill.effects!.find((e) => e.kind === "heal")!;
    const damage = skill.effects!.find((e) => e.kind === "damage")!;
    expect(skillEffectLine(heal, skill)).toContain("to your party");
    expect(skillEffectLine(damage, skill)).toContain("to all enemies");
  });

  test("effect.target overrides the skill's own target for that 1 effect's suffix", () => {
    const skill = getSkill("mage-fireball"); // any allEnemies-less singleEnemy skill works as a stand-in host
    const overriddenEffect: SkillEffect = { kind: "damage", amount: 5, target: "self" };
    expect(skillEffectLine(overriddenEffect, skill)).toContain("to yourself");
  });
});
