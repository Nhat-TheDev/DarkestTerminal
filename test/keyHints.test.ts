import { describe, test, expect } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { STRINGS } from "../src/data/strings";
import { composeFooter, globalHints, withPageHint, digitRange, digitHint, HINT_GAP } from "../src/ui/keyHints";

/** Every string whose job is to advertise keys — see `docs/developer-guide.md` §"Key hints". */
const FOOTER_KEYS = Object.keys(STRINGS).filter(
  (k) =>
    k.startsWith("ui.footer") ||
    k.startsWith("ui.hint") ||
    ["ui.detailFooter", "ui.saveMenuFooter", "ui.roomRewardFooter", "ui.characterInfoFooter", "mainMenu.chooseHint", "mainMenu.continueHint", "mainMenu.pressAnyKey", "charSelect.hint", "charSelect.readyHint", "abilitySelect.hint", "saveSelect.hint"].includes(k)
);

describe("key-hint grammar (R2/R3)", () => {
  test("covers every footer string in the catalog", () => {
    expect(FOOTER_KEYS.length).toBeGreaterThan(20);
  });

  for (const key of FOOTER_KEYS) {
    test(`${key} follows the footer grammar`, () => {
      const value = STRINGS[key]!;
      if (value === "") return; // a screen may contribute nothing but the globals

      // R2 — tokens, not prose.
      expect(value).not.toContain("Press ");
      expect(value.endsWith(".")).toBe(false);
      expect(value).toBe(value.trim());

      // R2 — hints are separated by exactly HINT_GAP, and every one is `[key] Label`.
      // `{{keys}}` is the digit-range placeholder each screen fills in from its own option count.
      for (const hint of value.replace("{{keys}}", "1-4").split(HINT_GAP)) {
        expect(hint).toMatch(/^\[[^\]]+\] [^\[\]]+$/);
      }

      // R3 — one bracket, one key: no alternates crammed in with a slash (arrows excepted).
      for (const bracket of value.match(/\[[^\]]+\]/g) ?? []) {
        if (bracket === "[←/→]" || bracket === "[{{keys}}]") continue;
        expect(bracket).not.toContain("/");
      }

      // R6 — a hard-coded [1-9] would advertise digits most screens never accept.
      expect(value).not.toContain("[1-9]");
    });
  }

  test("no key hint leaks into a body string", () => {
    const bodyKeyHints = Object.entries(STRINGS).filter(
      ([k, v]) => !FOOTER_KEYS.includes(k) && /^Press \[/.test(v)
    );
    expect(bodyKeyHints).toEqual([]);
  });
});

describe("global hints (R5)", () => {
  test("room offers party info, saving and quicksaving", () => {
    expect(globalHints("room")).toBe("[b] Party   [q] Save   [s] Quicksave   [Ctrl+C] Quit");
  });

  test("the save menu hides [q], since [q] is what opened it", () => {
    expect(globalHints("saveMenu")).toBe("[s] Quicksave   [Ctrl+C] Quit");
  });

  test("game over leaves only the quit key", () => {
    expect(globalHints("gameover")).toBe("[Ctrl+C] Quit");
  });

  test("character info drops [b] — that screen is where [b] leads", () => {
    expect(globalHints("characterInfo")).toBe("[q] Save   [s] Quicksave   [Ctrl+C] Quit");
  });

  test("party info can be suppressed for a screen that swallows the key", () => {
    expect(globalHints("room", false)).toBe("[q] Save   [s] Quicksave   [Ctrl+C] Quit");
  });
});

describe("page hint placement (R4)", () => {
  test("is spliced in before a trailing back hint, never after it", () => {
    expect(withPageHint("[1-9] Item   [Esc] Back", true)).toBe("[1-9] Item   [←/→] Page   [Esc] Back");
  });

  test("is appended when the screen has no back hint", () => {
    expect(withPageHint("[1-9] Choose", true)).toBe("[1-9] Choose   [←/→] Page");
  });

  test("is left out entirely on a single-page list", () => {
    expect(withPageHint("[1-9] Item   [Esc] Back", false)).toBe("[1-9] Item   [Esc] Back");
  });

  test("composeFooter divides the screen's hints from the global ones", () => {
    expect(composeFooter("[1-9] Action", "pickAction", false)).toBe("[1-9] Action   │   [b] Party   [q] Save   [s] Quicksave   [Ctrl+C] Quit");
  });

  test("a screen contributing no hints still renders the globals alone", () => {
    expect(composeFooter("", "gameover", false)).toBe("[Ctrl+C] Quit");
  });
});

describe("hints render into the footer, never into the body (R1)", () => {
  test("the room screen lists paths only — the [i]/[a] keys live in the footer", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 45 });
    const game = new Game(7);
    // Every run opens on an ambush; softening it just lets the test reach the room screen quickly.
    game.ctx.monsters.forEach((m) => (m.hp = 1));
    const app = new App(renderer, game);
    await renderOnce();

    let guard = 0;
    while (app.debugUiState.kind !== "room" && guard < 200) {
      guard++;
      const kind = app.debugUiState.kind;
      mockInput.pressKey(kind === "roundResolved" || kind === "combatOver" || kind === "skillDetail" || kind === "roomReward" ? "RETURN" : "1");
      await renderOnce();
    }
    expect(app.debugUiState.kind).toBe("room");

    const frame = captureCharFrame();
    expect(frame).toContain("Paths:");
    expect(frame).not.toContain("Press [i]");
    expect(frame).not.toContain("Press [a]");
    expect(frame).toMatch(/\[1(-\d)?\] Move {3}\[i\] Items {3}\[a\] Artifacts {3}│ {3}\[b\] Party/);
  }, 20000);
});

describe("digit ranges match the options actually on screen (R6)", () => {
  test("a single option is [1], never [1-1]", () => {
    expect(digitRange(1)).toBe("1");
  });

  test("several options span the real range", () => {
    expect(digitRange(4)).toBe("1-4");
  });

  test("no numbered option at all yields no range", () => {
    expect(digitRange(0)).toBeNull();
  });

  test("digitHint fills the placeholder rather than leaving it raw", () => {
    expect(digitHint("ui.footerRoom", 3)).toBe("[1-3] Move   [i] Items   [a] Artifacts");
  });

  test("digitHint falls back instead of printing an empty [] bracket", () => {
    expect(digitHint("ui.footerChooseArtifact", 0)).toBe("[Esc] Back");
  });
});

describe("footers resolve against a live game", () => {
  test("the room screen counts its actual exits, and combat its actual options", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 45 });
    const game = new Game(7);
    game.ctx.monsters.forEach((m) => (m.hp = 1));
    const app = new App(renderer, game);
    await renderOnce();

    // The opening ambush puts the action picker on screen: Fight + Use item, never 9 of anything.
    mockInput.pressKey("RETURN");
    await renderOnce();
    expect(app.debugUiState.kind).toBe("pickAction");
    expect(captureCharFrame()).toContain("[1-2] Action");

    let guard = 0;
    while (app.debugUiState.kind !== "room" && guard < 200) {
      guard++;
      const kind = app.debugUiState.kind;
      mockInput.pressKey(kind === "roundResolved" || kind === "combatOver" || kind === "skillDetail" || kind === "roomReward" ? "RETURN" : "1");
      await renderOnce();
    }
    expect(app.debugUiState.kind).toBe("room");

    // An empty bag must not advertise [i] — handleKey ignores the key there.
    expect(app.debugGame.state.inventory).toBeDefined();
    const exits = app.debugGame.connectedRoomChoices().length;
    expect(exits).toBeLessThan(9);
    expect(captureCharFrame()).toContain(`[${exits === 1 ? "1" : `1-${exits}`}] Move`);
  }, 20000);

  test("no screen ever renders an unresolved template or an empty bracket", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 45 });
    const app = new App(renderer, new Game(7));
    await renderOnce();

    let guard = 0;
    while (app.debugUiState.kind !== "gameover" && guard < 600) {
      guard++;
      const frame = captureCharFrame();
      expect(frame).not.toContain("{{");
      expect(frame).not.toContain("[] ");
      const kind = app.debugUiState.kind;
      mockInput.pressKey(kind === "roomReward" || kind === "skillDetail" ? "RETURN" : "1");
      await renderOnce();
    }
  }, 30000);
});

describe("room footer tracks what the room can actually do", () => {
  /** Clears the opening ambush so the dungeon room screen itself is on show. */
  async function reachRoom(mockInput: { pressKey: (k: string) => void }, renderOnce: () => Promise<void>, app: App) {
    let guard = 0;
    while (app.debugUiState.kind !== "room" && guard < 200) {
      guard++;
      const kind = app.debugUiState.kind;
      mockInput.pressKey(kind === "roundResolved" || kind === "combatOver" || kind === "skillDetail" || kind === "roomReward" ? "RETURN" : "1");
      await renderOnce();
    }
    expect(app.debugUiState.kind).toBe("room");
  }

  test("[i] is dropped when the bag is empty, since the key does nothing then", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 45 });
    const game = new Game(7);
    game.ctx.monsters.forEach((m) => (m.hp = 1));
    const app = new App(renderer, game);
    await renderOnce();
    await reachRoom(mockInput, renderOnce, app);

    app.debugGame.state.inventory = {};
    mockInput.pressKey("9"); // an out-of-range path digit: repaints the screen without leaving the room
    await renderOnce();

    const frame = captureCharFrame();
    expect(frame).toContain("] Move   [a] Artifacts");
    expect(frame).not.toContain("[i] Items");
  }, 20000);

  test("[i] comes back once the party is carrying something", async () => {
    const { renderer, mockInput, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 45 });
    const game = new Game(7);
    game.ctx.monsters.forEach((m) => (m.hp = 1));
    const app = new App(renderer, game);
    await renderOnce();
    await reachRoom(mockInput, renderOnce, app);

    app.debugGame.state.inventory = { "small-potion": 1 };
    mockInput.pressKey("9");
    await renderOnce();

    expect(captureCharFrame()).toContain("[i] Items   [a] Artifacts");
  }, 20000);
});
