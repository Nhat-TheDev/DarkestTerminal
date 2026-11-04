import { afterEach, describe, expect, test } from "bun:test";
import { Game } from "../src/engine/game";
import { clearSlot, gameFromSave, loadSave, saveRun } from "../src/engine/save";
import { loadProfile, saveProfile } from "../src/engine/profile";
import { ABILITIES } from "../src/data/abilities";
import { MEMORY_LIST_ROWS, MEMORY_LIST_WIDTH, MEMORY_PAGE_SIZE, memoryPages, renderMain } from "../src/ui/screens/memory";
import { getRoom } from "../src/engine/dungeon";
import { startCombat } from "../src/engine/combat";
import { spawnMonster } from "../src/data/monsters";

const SLOTS = ["slot1", "slot2"];

afterEach(() => {
  for (const id of SLOTS) clearSlot(id);
});

function slotGame(slot: string | null, seed = 1): Game {
  return new Game(seed, ["knight", "mage", "rogue", "acolyte"], undefined, undefined, false, slot);
}

/** A guard-room fight against one 1-HP monster of `tier`, won with a single attack, then cleared as the UI does. */
function winGuardFight(game: Game, tier: "boss" | "elite"): Game {
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  room.type = "boss";
  room.cleared = false;
  const guard = spawnMonster("skeleton-guard", 1, { tier });
  guard.hp = 1;
  guard.attack = 0;
  game.ctx.monsters.push(guard);
  room.monsterIds = [guard.id];
  game.state.combat = startCombat(room.id, [guard.id], game.ctx, true);
  const attacker = game.state.party[0]!;
  game.queue({ kind: "character", id: attacker.id }, attacker.unlockedSkillIds[0]!, [{ kind: "monster", id: guard.id }]);
  game.resolve();
  expect(game.state.combat?.outcome).toBe("victory");
  game.clearFinishedCombat();
  return game;
}

describe("Memory unlock", () => {
  test("the slot's first boss-tier kill unlocks Memory and queues the intro", () => {
    const game = slotGame("slot1");
    expect(game.memoryUnlocked).toBe(false);
    winGuardFight(game, "boss");
    expect(game.memoryUnlocked).toBe(true);
    expect(game.memoryIntroPending).toBe(true);
    expect(loadProfile("slot1").memoryUnlocked).toBe(true);
  });

  test("an elite guarding a guard room (floors before the first boss floor) does not unlock it", () => {
    const game = winGuardFight(slotGame("slot1"), "elite");
    expect(game.memoryUnlocked).toBe(false);
    expect(game.memoryIntroPending).toBe(false);
    expect(loadProfile("slot1").memoryUnlocked).toBe(false);
  });

  test("the intro is still pending after quitting before it was read", () => {
    winGuardFight(slotGame("slot1"), "boss");
    const reloaded = slotGame("slot1", 2);
    expect(reloaded.memoryUnlocked).toBe(true);
    expect(reloaded.memoryIntroPending).toBe(true);
  });

  test("reading the intro is kept in the slot profile, so later runs and boss kills never raise it again", () => {
    const game = winGuardFight(slotGame("slot1"), "boss");
    game.dismissMemoryIntro();
    expect(game.memoryIntroPending).toBe(false);
    expect(loadProfile("slot1").memoryIntroShown).toBe(true);
    winGuardFight(game, "boss");
    expect(game.memoryIntroPending).toBe(false);
    const next = slotGame("slot1", 2);
    expect(next.memoryUnlocked).toBe(true);
    expect(next.memoryIntroPending).toBe(false);
  });

  test("a game restored from a save in the slot is unlocked", () => {
    winGuardFight(slotGame("slot1"), "boss");
    saveRun(slotGame("slot1", 3));
    const restored = gameFromSave(loadSave("slot1"), "slot1");
    expect(restored.currentSaveSlot).toBe("slot1");
    expect(restored.memoryUnlocked).toBe(true);
  });

  test("another slot stays locked", () => {
    winGuardFight(slotGame("slot1"), "boss");
    expect(slotGame("slot2", 2).memoryUnlocked).toBe(false);
  });

  test("a run with no slot unlocks for the session but keeps nothing", () => {
    const game = winGuardFight(slotGame(null), "boss");
    expect(game.memoryUnlocked).toBe(true);
    expect(slotGame(null, 2).memoryUnlocked).toBe(false);
  });

  test("clearSlot wipes it", () => {
    winGuardFight(slotGame("slot1"), "boss");
    clearSlot("slot1");
    expect(slotGame("slot1", 2).memoryUnlocked).toBe(false);
  });
});

describe("memoryAbilityIds", () => {
  test("follows the slot profile in catalog order and leaves commons out", () => {
    const [first, second] = ABILITIES.filter((a) => a.rarity !== "common").map((a) => a.id) as [string, string];
    const common = ABILITIES.find((a) => a.rarity === "common")!.id;
    const profile = loadProfile("slot1");
    profile.unlockedAbilityIds = [second, common, first];
    saveProfile("slot1", profile);
    expect(slotGame("slot1").memoryAbilityIds()).toEqual([first, second]);
  });

  test("is empty for a slot that holds nothing", () => {
    expect(slotGame("slot1").memoryAbilityIds()).toEqual([]);
  });
});

describe("Memory list paging", () => {
  const entryLine = /^ {2}\S.*\((rare|unique|epic)\)$/;

  test("every page fits the Dungeon panel at the minimum terminal size and holds at most five entries", () => {
    const ids = ABILITIES.filter((a) => a.rarity !== "common").map((a) => a.id);
    const pages = memoryPages(ids);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(MEMORY_LIST_ROWS);
      expect(page.filter((line) => entryLine.test(line)).length).toBeLessThanOrEqual(MEMORY_PAGE_SIZE);
      for (const line of page) expect(line.length).toBeLessThanOrEqual(MEMORY_LIST_WIDTH);
    }
    expect(pages.flat().filter((line) => entryLine.test(line))).toHaveLength(ids.length);
  });

  test("a wrapped effect stays indented under its entry", () => {
    const long = ABILITIES.find((a) => a.id === "arcane-font")!;
    const ui = { kind: "memory" as const, previous: { kind: "room" as const }, previousPage: 0, pages: memoryPages([long.id]) };
    const lines = renderMain(ui, 0).split("\n").slice(3);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.startsWith("      ")).toBe(true);
  });

  test("a slot holding nothing shows the empty line", () => {
    const ui = { kind: "memory" as const, previous: { kind: "room" as const }, previousPage: 0, pages: memoryPages([]) };
    expect(renderMain(ui, 0)).toContain("Nothing is held yet.");
  });
});
