import { describe, test, expect } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { App, type RunExit } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { saveRun, loadSave, gameFromSave, listSlots, clearSlot } from "../src/engine/save";
import { getSkill } from "../src/data/classes";
import { ABILITIES } from "../src/data/abilities";
import { loadProfile, saveProfile } from "../src/engine/profile";
import type { Character, SkillDefinition, SkillEffect } from "../src/types";
import { getActorByRef, startCombat } from "../src/engine/combat";
import { spawnMonster, MONSTER_ARCHETYPES } from "../src/data/monsters";
import { resolveSkillEffect } from "../src/engine/resolver";
import { getRoom, enterRoom } from "../src/engine/dungeon";
import { ARTIFACTS } from "../src/data/artifacts";
import { showMainMenu } from "../src/ui/mainMenu";
import { showSlotSelect } from "../src/ui/saveSelect";
import { t } from "../src/data/strings";
import { CLASSES } from "../src/data/classes";
import { renderMain as renderCombat, skillEffectLine, skillMechanicLines } from "../src/ui/screens/combat";
import { BALANCE } from "../src/data/balanceConfig";
import * as runnerScreen from "../src/ui/screens/runner";
import * as artifactsScreen from "../src/ui/screens/artifacts";
import * as inventoryScreen from "../src/ui/screens/inventory";
import { TROPHY_ICON } from "../src/ui/state";
import { getStatusEffect } from "../src/data/statusEffects";
import { ITEMS, describeItemEffects, getItem } from "../src/data/items";
import { getSummonArchetype, getSummonCast, getSummonSkill } from "../src/data/summons";
import { UNIT_BLOCK_HEIGHT } from "../src/ui/layout";
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
    expect(skillEffectLine(effect, skill)).toBe("  • Heals: 90% Base Magic Power + 16 HP to an ally");
  });
});

describe("skillEffectLine: per-effect target overrides (replaces the old effectsByRelation)", () => {
  test("appliesToRelation on a singleAllyOrEnemy skill (Purify) shows the singular ally/enemy suffix per effect", () => {
    const skill = getSkill("purify");
    const [removeStatus, damage] = skill.effects!;
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
    expect(panelRows(frame, t("ui.panelProgress"))).toBe(1);
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
