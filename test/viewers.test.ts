import { describe, test, expect } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { getRoom } from "../src/engine/dungeon";
import { startCombat } from "../src/engine/combat";
import { spawnMonster, MONSTER_ARCHETYPES } from "../src/data/monsters";
import { loadProfile, parseProfile, saveProfile } from "../src/engine/profile";
import { t } from "../src/data/strings";

async function boot(game: Game) {
  const setup = await createTestRenderer({ width: 150, height: 45 });
  const app = new App(setup.renderer, game);
  await setup.renderOnce();
  const press = async (key: string) => {
    setup.mockInput.pressKey(key);
    await setup.renderOnce();
  };
  const escape = async () => {
    setup.mockInput.pressEscape();
    // A lone Esc reaches the handler only once the parser stops waiting for an escape sequence.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await setup.renderOnce();
  };
  return { app, frame: setup.captureCharFrame, press, escape };
}

function gameInFight(seed: number, archetypeIds: string[]): Game {
  const game = new Game(seed);
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  const monsters = archetypeIds.map((id) => spawnMonster(id, 1));
  game.ctx.monsters.push(...monsters);
  room.type = "combat";
  room.monsterIds = monsters.map((m) => m.id);
  room.cleared = false;
  game.state.combat = startCombat(room.id, room.monsterIds, game.ctx, false);
  return game;
}

describe("floor map viewer", () => {
  test("[p] on the room screen opens the whole floor full-screen, and [Esc] goes back", async () => {
    const game = new Game(11);
    game.state.combat = null;
    getRoom(game.state.floor, game.state.currentRoomId).cleared = true;
    const { app, frame, press, escape } = await boot(game);
    expect(app.debugUiState.kind).toBe("room");
    expect(frame()).toContain(t("ui.hintMap"));

    await press("p");
    expect(app.debugUiState.kind).toBe("floorMap");
    const shown = frame();
    expect(shown).toContain(t("ui.panelFloorMap"));
    expect(shown).toContain(t("ui.floorMapTitle", { depth: game.state.floor.depth }));
    expect(shown).toContain(t("ui.floorMapExitsLabel"));
    expect(shown).not.toContain(t("ui.panelParty"));

    await escape();
    expect(app.debugUiState.kind).toBe("room");
  });

  test("an unknown room ahead stays unknown on the map's list of ways on", async () => {
    const game = new Game(11);
    game.state.combat = null;
    const here = getRoom(game.state.floor, game.state.currentRoomId);
    here.cleared = true;
    const next = getRoom(game.state.floor, here.connectedRoomIds[0]!);
    next.hidden = true;
    const { app, frame, press } = await boot(game);
    expect(app.debugUiState.kind).toBe("room");
    await press("p");
    expect(frame()).toContain(t("ui.floorMapExitUnknown").trim());
    expect(frame()).not.toContain(next.name);
  });
});

describe("monster viewer", () => {
  test("[v] in a fight shows the monsters one at a time, a digit picks one, [Esc] returns to the fight", async () => {
    const [first, second] = MONSTER_ARCHETYPES.filter((a) => a.roles.includes("normal"));
    const game = gameInFight(3, [first!.id, second!.id]);
    const { app, frame, press, escape } = await boot(game);
    const before = app.debugUiState.kind;
    expect(frame()).toContain(t("ui.hintMonsters"));

    await press("v");
    expect(app.debugUiState.kind).toBe("monsterInfo");
    expect(frame()).toContain(t("ui.monsterInfoHeading", { name: first!.name, tier: t("ui.monsterTierNormal") }));
    expect(frame()).toContain(t("ui.monsterSkillsLabel"));

    await press("2");
    expect(frame()).toContain(t("ui.monsterInfoHeading", { name: second!.name, tier: t("ui.monsterTierNormal") }));

    await escape();
    expect(app.debugUiState.kind).toBe(before);
  });

  test("a fight adds its monsters to the slot's bestiary, kept in the profile, without any screen", () => {
    const archetype = MONSTER_ARCHETYPES.find((a) => a.roles.includes("normal"))!;
    const game = gameInFight(5, [archetype.id]);
    game.currentSaveSlot = "slot5";
    saveProfile("slot5", { ...loadProfile("slot5"), seenMonsterIds: [] });
    game.seenMonsterIds = [];
    game.resolve();
    expect(game.seenMonsterIds).toEqual([archetype.id]);
    expect(loadProfile("slot5").seenMonsterIds).toEqual([archetype.id]);
  });

  test("a run loaded mid-fight notes the monsters it is fighting", () => {
    const archetype = MONSTER_ARCHETYPES.find((a) => a.roles.includes("normal"))!;
    const fighting = gameInFight(9, [archetype.id]);
    const loaded = new Game(9, undefined, { state: fighting.state, monsters: fighting.ctx.monsters, summons: fighting.ctx.summons, rngState: 1, playTimeSec: 0 });
    expect(loaded.seenMonsterIds).toContain(archetype.id);
  });

  test("the bestiary lists what was fought, opens an entry, and backs out one step at a time", async () => {
    const game = new Game(11);
    game.state.combat = null;
    getRoom(game.state.floor, game.state.currentRoomId).cleared = true;
    const known = MONSTER_ARCHETYPES.slice(0, 2);
    game.seenMonsterIds = known.map((a) => a.id);
    const { app, frame, press, escape } = await boot(game);
    expect(app.debugUiState.kind).toBe("room");

    await press("p");
    await press("v");
    expect(app.debugUiState.kind).toBe("bestiary");
    expect(frame()).toContain(t("ui.bestiaryHeading", { seen: 2, total: MONSTER_ARCHETYPES.length }));
    expect(frame()).not.toContain(MONSTER_ARCHETYPES[2]!.name);

    await press("1");
    expect(frame()).toContain(t("ui.monsterBaseStatsLine", { hp: known[0]!.baseHp, attack: known[0]!.baseAttack, defense: known[0]!.baseDefense, speed: known[0]!.baseSpeed }).trim());

    await escape();
    expect(app.debugUiState.kind).toBe("bestiary");
    await escape();
    expect(app.debugUiState.kind).toBe("room");
  });

  test("a profile keeps only monsters still in the catalog, each once", () => {
    const id = MONSTER_ARCHETYPES[0]!.id;
    expect(parseProfile(JSON.stringify({ seenMonsterIds: [id, "no-such-monster", id] })).seenMonsterIds).toEqual([id]);
    expect(parseProfile(JSON.stringify({})).seenMonsterIds).toEqual([]);
  });
});
