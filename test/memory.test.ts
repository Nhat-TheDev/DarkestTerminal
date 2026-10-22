import { afterEach, describe, expect, test } from "bun:test";
import { Game } from "../src/engine/game";
import { clearSlot, gameFromSave, loadSave, saveRun } from "../src/engine/save";
import { loadProfile, saveProfile } from "../src/engine/profile";
import { ABILITIES } from "../src/data/abilities";
import { MEMORY_LIST_ROWS, MEMORY_PAGE_SIZE, memoryPages, renderMain } from "../src/ui/screens/memory";
import type { CombatState, Floor } from "../src/types";

const SLOTS = ["slot1", "slot2"];

afterEach(() => {
  for (const id of SLOTS) clearSlot(id);
});

function slotGame(slot: string | null, seed = 1): Game {
  return new Game(seed, ["knight", "mage", "rogue", "acolyte"], undefined, undefined, false, slot);
}

function setUpVictory(game: Game, roomType: "boss" | "combat" = "boss"): Game {
  const floor: Floor = {
    depth: 5,
    rooms: [{ id: "r1", name: "Test Room", type: roomType, connectedRoomIds: [], monsterIds: [], cleared: false }],
    entryRoomId: "r1",
  };
  (game.state as { floor: Floor }).floor = floor;
  const combat: CombatState = {
    roomId: "r1",
    combatants: [],
    roundNumber: 1,
    phase: "over",
    queuedActions: [],
    turnQueue: [],
    activeTurnIndex: 0,
    isBossFight: roomType === "boss",
    log: [],
    outcome: "victory",
  };
  (game.state as { combat: CombatState | null }).combat = combat;
  return game;
}

describe("Memory unlock", () => {
  test("the slot's first boss-room victory unlocks Memory and queues the intro", () => {
    const game = setUpVictory(slotGame("slot1"));
    expect(game.memoryUnlocked).toBe(false);
    game.clearFinishedCombat();
    expect(game.memoryUnlocked).toBe(true);
    expect(game.state.pendingMemoryIntro).toBe(true);
    expect(loadProfile("slot1").memoryUnlocked).toBe(true);
  });

  test("a non-boss victory does not unlock it", () => {
    const game = setUpVictory(slotGame("slot1"), "combat");
    game.clearFinishedCombat();
    expect(game.memoryUnlocked).toBe(false);
    expect(game.state.pendingMemoryIntro).toBeFalsy();
  });

  test("a second boss victory does not raise the intro again", () => {
    const game = setUpVictory(slotGame("slot1"));
    game.clearFinishedCombat();
    game.dismissMemoryIntro();
    expect(game.state.pendingMemoryIntro).toBe(false);
    setUpVictory(game);
    game.clearFinishedCombat();
    expect(game.state.pendingMemoryIntro).toBe(false);
  });

  test("a new run in the same slot starts unlocked with no intro", () => {
    setUpVictory(slotGame("slot1")).clearFinishedCombat();
    const next = slotGame("slot1", 2);
    expect(next.memoryUnlocked).toBe(true);
    expect(next.state.pendingMemoryIntro).toBe(false);
  });

  test("a game restored from a save in the slot is unlocked", () => {
    setUpVictory(slotGame("slot1")).clearFinishedCombat();
    saveRun(slotGame("slot1", 3));
    const restored = gameFromSave(loadSave("slot1"), "slot1");
    expect(restored.currentSaveSlot).toBe("slot1");
    expect(restored.memoryUnlocked).toBe(true);
  });

  test("another slot stays locked", () => {
    setUpVictory(slotGame("slot1")).clearFinishedCombat();
    expect(slotGame("slot2", 2).memoryUnlocked).toBe(false);
  });

  test("a run with no slot unlocks for the session but keeps nothing", () => {
    const game = setUpVictory(slotGame(null));
    game.clearFinishedCombat();
    expect(game.memoryUnlocked).toBe(true);
    expect(slotGame(null, 2).memoryUnlocked).toBe(false);
  });

  test("clearSlot wipes it", () => {
    setUpVictory(slotGame("slot1")).clearFinishedCombat();
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
      for (const line of page) expect(line.length).toBeLessThanOrEqual(79);
    }
    expect(pages.flat().filter((line) => entryLine.test(line))).toHaveLength(ids.length);
  });

  test("a wrapped effect stays indented under its entry", () => {
    const long = ABILITIES.find((a) => a.id === "arcane-font")!;
    const ui = { kind: "memory" as const, previous: { kind: "room" as const }, previousPage: 0, abilityIds: [long.id] };
    const lines = renderMain(ui, 0).split("\n").slice(3);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.startsWith("      ")).toBe(true);
  });
});
