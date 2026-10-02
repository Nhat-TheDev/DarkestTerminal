import { describe, test, expect } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { getSkill } from "../src/data/classes";
import type { Character, SkillDefinition, SkillEffect } from "../src/types";
import { getActorByRef, startCombat } from "../src/engine/combat";
import { spawnMonster } from "../src/data/monsters";
import { getRoom } from "../src/engine/dungeon";
import { ARTIFACTS } from "../src/data/artifacts";
import { showMainMenu } from "../src/ui/mainMenu";
import { CLASSES } from "../src/data/classes";
import { renderMain as renderCombat, skillEffectLine, skillMechanicLines } from "../src/ui/screens/combat";
import * as runnerScreen from "../src/ui/screens/runner";
import { getStatusEffect } from "../src/data/statusEffects";
import { getSummonArchetype, getSummonCast, getSummonSkill } from "../src/data/summons";

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

      if (ui.kind === "roomReward" || ui.kind === "skillDetail" || ui.kind === "runnerNotice" || ui.kind === "runnerShop") {
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

describe("skillMechanicLines: skill-level mechanics derived from the skill's own data", () => {
  test("an ultimate shows the always-hit / fear rule", () => {
    expect(skillMechanicLines(getSkill("vanguard-sword-judgment"))).toEqual(["  • Always hits; effectiveness is reduced by fear"]);
  });

  test("executeBonus shows its bonus and HP threshold", () => {
    const { hpPercentThreshold, bonusDamageFlat } = getSkill("ninja-death-mark").executeBonus!;
    expect(skillMechanicLines(getSkill("ninja-death-mark"))).toContain(`  • +${bonusDamageFlat} damage against targets below ${hpPercentThreshold}% HP`);
  });

  test("conditionalBonus shows the defense ignored, and a consumed status gets its own line", () => {
    const frenzied = getSkill("viking-frenzied-slash");
    expect(skillMechanicLines(frenzied)).toEqual([`  • Ignores ${frenzied.conditionalBonus!.ignoreDefensePercentBonus}% more defense while Storm-Empowered`]);
    expect(skillMechanicLines(getSkill("viking-thunder-god-fury"))).toContain("  • Consumes Storm-Empowered");
  });

  test("a damage effect's critChance is shown as a percent", () => {
    const { critChance } = getSkill("archer-deadeye-shot").effects!.find((e) => e.kind === "damage")!;
    expect(skillMechanicLines(getSkill("archer-deadeye-shot"))).toContain(`  • Critical chance: ${Math.round(critChance! * 100)}%`);
  });

  test("a skill with none of these mechanics yields no lines", () => {
    expect(skillMechanicLines(getSkill("vanguard-slash"))).toEqual([]);
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
    for (const id of ["summoner-summon-goblin", "summoner-summon-spirit"]) {
      const { cast, archetype, skills } = minion(id);
      expect(skills.length).toBeGreaterThan(0);
      expect(summonLine(id)).toBe(`  • Summons ${archetype.name}: acts up to ${cast.maxActions} times, aggro ${cast.aggro}\n      Skills: ${skills.join(", ")}`);
    }
  });

  test("a minion with no signature skills gets a single line", () => {
    const { cast, archetype, skills } = minion("ninja-shadow-clone");
    expect(skills).toEqual([]);
    expect(summonLine("ninja-shadow-clone")).toBe(`  • Summons ${archetype.name}: acts up to ${cast.maxActions} times, aggro ${cast.aggro}`);
  });

  test("a passive minion has no action count", () => {
    const { cast, archetype } = minion("summoner-totem-recall");
    expect(archetype.passive).toBe(true);
    expect(summonLine("summoner-totem-recall")).toBe(`  • Summons ${archetype.name}: aggro ${cast.aggro}`);
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
    const skill = getSkill("summoner-totem-recall");
    const effect = skill.effects!.find((e) => e.kind === "applyStatusEffect")!;
    expect(skillEffectLine(effect, skill)).toContain(`\n      +${effect.amount} attack (or ${effect.minPercent}% of the bearer's attack if larger)`);
  });

  test("Storm-Empowered shows its splash with the multiplier and the defense it ignores", () => {
    const skill = getSkill("viking-lightning-axe");
    const effect = skill.effects!.find((e) => e.kind === "applyStatusEffect" && e.statusEffectId?.startsWith("storm-empowered"))!;
    const aoe = getStatusEffect(effect.statusEffectId!).onHitAoeDamage!;
    expect(skillEffectLine(effect, skill)).toContain(
      `splashes ${aoe.amount} damage plus ${aoe.offenseMultiplierPercent}% of the bearer's magic power to all enemies, ignoring ${aoe.ignoreDefensePercent}% of their defense`
    );
  });

  test("Poison Coat says that its hits also poison", () => {
    const skill = getSkill("rogue-poison-coat");
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
    const text = detail(getSkill("vanguard-sword-judgment"));
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
    check("archer-quick-shot", "attack", 20);
    check("summoner-hollow-pulse", "magicPower", 30);
  });

  test("an executeBonus shows a percent bonus, both bonuses, and nothing when it carries no bonus", () => {
    const withBonus = (executeBonus: NonNullable<SkillDefinition["executeBonus"]>) => ({ ...getSkill("ninja-death-mark"), executeBonus });
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
    expect(app.debugUiState.kind).toBe("runnerShop"); // buying doesn't throw the player back to the Rest screen
    expect(game.state.restRunner?.offers[0]?.sold).toBe(true);

    mockInput.pressKey("r"); // refresh costs 10
    await renderOnce();
    expect(game.state.coins).toBe(75);
    expect(app.debugUiState.kind).toBe("runnerShop");

    mockInput.pressKey("RETURN"); // leave: trading replaces the rest action
    await renderOnce();
    expect(room.cleared).toBe(true);
    expect(game.state.restRunner).toBeNull();
    expect(app.debugUiState.kind).toBe("campReflection"); // the reflection comes after the choice
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
