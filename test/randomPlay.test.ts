import { describe, test, expect } from "bun:test";
import { Game } from "../src/engine/game";
import {
  findTextLeaks,
  findLongDecimals,
  findInvariantViolations,
  footerText,
  parseFooter,
  classifyKeyEffect,
  findFooterIssues,
  findLayoutIssues,
} from "../tools/random-play/checks";
import { spansToHtml } from "../tools/random-play/report";
import { playRun, loopBreakKey } from "../tools/random-play/bot";
import { Rng } from "../src/engine/rng";

const FOOTER = "[1-2] Action   │   [b] Party   [l] Log   [q] Save   [s] Quicksave   [Ctrl+C] Quit";

describe("random-play checks", () => {
  test("text leaks catch raw ANSI, NaN and unfilled templates, not ordinary text", () => {
    expect(findTextLeaks("│HP 40/40  Fear 2.5│")).toEqual([]);
    expect(findTextLeaks("│Vanguard [31mLv.1[0m│").map((f) => f.detail)).toEqual([expect.stringContaining("raw ANSI color code")]);
    expect(findTextLeaks("│HP NaN/40│")[0]!.detail).toContain("NaN");
    expect(findTextLeaks("│Entered {{room}}│")[0]!.detail).toContain("template");
  });

  test("long decimals are flagged, one-decimal fear is not", () => {
    expect(findLongDecimals("Fear 12.5")).toEqual([]);
    expect(findLongDecimals("Fear 12.300000001")).toHaveLength(1);
  });

  test("a fresh run breaks no invariant", () => {
    const game = new Game(7);
    expect(findInvariantViolations(game.state, game.ctx)).toEqual([]);
  });

  test("invariants catch duplicate summon ids, an open combat after defeat and NaN stats", () => {
    const game = new Game(7);
    const summon = { id: "s1", hp: 10, maxHp: 10, attack: 1, defense: 1, magicPower: 1, speed: 1 };
    game.ctx.summons.push({ ...summon } as never, { ...summon } as never);
    game.state.gameOver = "defeat";
    game.state.party[0]!.attack = Number.NaN;
    const details = findInvariantViolations(game.state, game.ctx).map((f) => f.detail);
    expect(details).toContain("two summons share an id");
    expect(details).toContain("character.attack is NaN");
    expect(game.state.combat).not.toBeNull(); // seed 7 opens on an entry-room ambush
    expect(details).toContain("run is over but a combat is still open");
  });

  test("footer is read from the rows below the last panel and parsed into pressable keys", () => {
    const frame = ["┌─Log──┐", "│ x    │", "└──────┘", FOOTER, "", ""].join("\n");
    expect(footerText(frame)).toBe(FOOTER);
    const footer = parseFooter(FOOTER);
    expect([...footer.digits]).toEqual([1, 2]);
    expect(footer.keys).toEqual(expect.arrayContaining(["1", "2", "b", "l", "q", "s"]));
    expect(footer.keys).not.toContain("Ctrl+C");
    expect(parseFooter("[Enter] Continue   [Esc] Back   [←/→] Page").keys).toEqual(["RETURN", "ESCAPE", "ARROW_LEFT", "ARROW_RIGHT"]);
  });

  test("a footer pushed off screen or cut short is reported", () => {
    expect(findFooterIssues(parseFooter(""))[0]!.type).toBe("missingFooter");
    expect(findFooterIssues(parseFooter("[1-2] Action   │   [b] Party   [l] Lo")).map((f) => f.type)).toEqual(["footerTruncated"]);
    expect(findFooterIssues(parseFooter("[1-2] Action   │   [Ctrl+C] Quit   [")).map((f) => f.type)).toEqual(["footerTruncated"]);
    expect(findFooterIssues(parseFooter(FOOTER))).toEqual([]);
  });

  test("an advertised key that changes nothing is dead; an unadvertised digit that acts is hidden", () => {
    const footer = parseFooter(FOOTER);
    const still = { frameChanged: false, uiChanged: false, stateChanged: false, saveWritten: false };
    const types = (r: ReturnType<typeof classifyKeyEffect>) => ({ failures: r.failures.map((f) => f.type), warnings: r.warnings.map((f) => f.type) });
    expect(types(classifyKeyEffect({ key: "l", advertised: true, ...still }, footer))).toEqual({ failures: ["deadKey"], warnings: [] });
    expect(types(classifyKeyEffect({ key: "1", advertised: true, ...still }, footer))).toEqual({ failures: [], warnings: ["deadKey"] });
    expect(types(classifyKeyEffect({ key: "1", advertised: true, ...still, frameChanged: true }, footer))).toEqual({ failures: [], warnings: [] });
    expect(types(classifyKeyEffect({ key: "s", advertised: true, ...still, saveWritten: true }, footer))).toEqual({ failures: [], warnings: ["noFeedback"] });
    expect(types(classifyKeyEffect({ key: "3", advertised: false, ...still, stateChanged: true }, footer))).toEqual({ failures: ["hiddenKey"], warnings: [] });
    expect(types(classifyKeyEffect({ key: "3", advertised: false, ...still, frameChanged: true }, footer))).toEqual({ failures: [], warnings: [] });
  });

  test("layout reports a missing panel and a main panel with no rows", () => {
    const req = { panelTitles: ["Path", "Dungeon"], mainPanelTitle: "Dungeon", minMainRows: 1 };
    expect(findLayoutIssues("┌─Path──┐\n└───────┘", req).failures.map((f) => f.detail)).toEqual(['panel "Dungeon" is not on screen']);
    const squeezed = "┌─Path──┐┌─Dungeon──┐\n└───────┘└──────────┘";
    expect(findLayoutIssues(squeezed, req).failures[0]!.detail).toContain("0 content rows");
    const ok = "┌─Path──┐┌─Dungeon──┐\n│       ││ [1] Fight│\n└───────┘└──────────┘";
    const result = findLayoutIssues(ok, req);
    expect(result.failures).toEqual([]);
    expect(result.warnings.map((w) => w.type)).toEqual(["possibleClip"]);
  });
});

describe("random-play report", () => {
  test("a captured frame keeps its colours and escapes markup", () => {
    const html = spansToHtml({
      cols: 6,
      rows: 1,
      lines: [[{ text: "<b>&", fg: [255, 0, 0, 255], bg: [0, 0, 0, 0], attributes: 0 }, { text: "ok", fg: [0, 255, 0, 255], bg: [10, 20, 30, 255], attributes: 0 }]],
    });
    expect(html).toContain("&lt;b&gt;&amp;");
    expect(html).toContain("color:rgba(255,0,0,1.00)");
    expect(html).toContain("background:rgba(10,20,30,1.00)");
    expect(html).not.toContain("background:rgba(0,0,0,0.00)");
  });
});

describe("random-play bot", () => {
  test("plays a short run end to end and collects a gallery", async () => {
    const result = await playRun({ gameSeed: 1, botSeed: 7920, maxSteps: 200 });
    expect(result.steps).toBeGreaterThan(50);
    expect(result.gallery.length).toBeGreaterThan(3);
    expect(result.gallery.every((g) => g.size.endsWith("x70"))).toBe(true);
    // Only the known 120x40 layout gap may show up; anything else means the bot or the game broke.
    expect(result.failures.filter((f) => !(f.type === "panelMissing" && f.size === "120x40"))).toEqual([]);
  }, 30000);

  test("a looping bot backs out of submenus and favours progress keys, but never leaves the footer", () => {
    const rng = new Rng(1);
    const count = (footer: string, n = 2000) => {
      const info = parseFooter(footer);
      const tally: Record<string, number> = {};
      for (let i = 0; i < n; i++) {
        const key = loopBreakKey(rng, info);
        tally[key] = (tally[key] ?? 0) + 1;
      }
      return tally;
    };
    const submenu = count("[1-3] Tab   [Esc] Back   │   [b] Party   [l] Log   [q] Save   [s] Quicksave");
    expect(submenu.ESCAPE!).toBeGreaterThan(900);
    const room = count(FOOTER);
    expect(Object.keys(room).sort()).toEqual(["1", "2", "b", "l", "q", "s"]);
    // Each digit is 8x as likely as each global key, so the two digits take 16 of every 20 presses.
    expect(room["1"]! + room["2"]!).toBeGreaterThan(1400);
    // With nothing but global keys on offer it still only presses those, so a screen where no key acts still runs into softLock.
    expect(Object.keys(count("[b] Party   [l] Log")).sort()).toEqual(["b", "l"]);
  });
});
