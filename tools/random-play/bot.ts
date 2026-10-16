import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../../src/ui/app";
import { Game } from "../../src/engine/game";
import { Rng } from "../../src/engine/rng";
import { getActorByRef } from "../../src/engine/combat";
import { saveRun, loadSave, gameFromSave } from "../../src/engine/save";
import { SAVE_DIR } from "../../src/engine/paths";
import { CLASSES, getSkill } from "../../src/data/classes";
import { ABILITIES } from "../../src/data/abilities";
import { MAX_LEVEL } from "../../src/data/levelGrowth";
import { t } from "../../src/data/strings";
import type { Character, Id } from "../../src/types";
import { applyDump } from "../dev-save-dump/applyDump";
import { rmSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  findTextLeaks,
  findLongDecimals,
  findInvariantViolations,
  footerText,
  parseFooter,
  classifyKeyEffect,
  findFooterIssues,
  findLayoutIssues,
  type Finding,
  type FooterInfo,
  type LayoutRequirement,
} from "./checks";
import { toFrameCapture, type FrameCapture, type ReportFinding, type GalleryEntry } from "./report";

export interface Size {
  width: number;
  height: number;
}

/** Every check and every gallery shot runs at full height so the whole party and every panel is on screen. */
export const PLAY_SIZES: Size[] = [
  { width: 150, height: 70 },
  { width: 180, height: 70 },
  { width: 220, height: 70 },
];
/** The smallest terminal the game supports; each new screen is also checked once at this size. */
export const MIN_SIZE: Size = { width: 150, height: 45 };

const START_DEPTHS = [1, 1, 1, 5, 15, 40, 80, 99];
/** Party level relative to floor depth: over-levelled runs reach deep content, under-levelled ones reach defeat and high fear. */
const LEVEL_OFFSETS = [-3, 0, 0, 10, 25];
const PARTY_SIZE = 4;
const SAVE_SLOT = "slot1";
const RECENT_STEPS = 50;
const SOFT_LOCK_STEPS = 300;
const LOOP_BREAK_STEPS = 30;
const SENSIBLE_CHANCE = 0.7;
/** While looping: chance to back out of a screen that offers Esc, and how much likelier a digit or Enter is than any other footer key. */
const LOOP_ESCAPE_CHANCE = 0.5;
const LOOP_PROGRESS_WEIGHT = 8;
const HIDDEN_KEY_PROBE_CHANCE = 0.1;
const SAVE_ROUND_TRIP_CHANCE = { combat: 0.05, other: 0.02 };
const RESIZE_CHANCE = 0.05;
const MAX_REVEAL_TICKS = 1000;
const ESCAPE_DELIVERY_MS = 40;

export interface RunOptions {
  gameSeed: number;
  botSeed: number;
  maxSteps: number;
}

export interface RunResult {
  failures: ReportFinding[];
  warnings: ReportFinding[];
  gallery: GalleryEntry[];
  steps: number;
  outcome: string;
}

const sizeLabel = (s: Size) => `${s.width}x${s.height}`;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)]!;
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function layoutRequirement(uiKind: string, atMinSize: boolean): LayoutRequirement {
  const main = t("ui.panelMain");
  if (uiKind === "fullLog") return { panelTitles: [], mainPanelTitle: main, minMainRows: 0 };
  // At the minimum size the party list may scroll, but the choices panel must keep at least one row.
  if (atMinSize) return { panelTitles: [main], mainPanelTitle: main, minMainRows: 1 };
  const panels = ["ui.headerTitle", "ui.panelProgress", "ui.panelBattlefield", "ui.panelParty", "ui.panelMain", "ui.panelMonsters", "ui.panelLog"];
  return { panelTitles: panels.map((key) => t(key)), mainPanelTitle: main, minMainRows: 1 };
}

/** The key a cautious player would press, so runs get past the first fights often enough to reach later content. */
function sensibleKey(app: App, footer: FooterInfo): string | null {
  const ui = app.debugUiState;
  const game = app.debugGame;
  const offer = (key: string) => (footer.keys.includes(key) ? key : null);
  if (ui.kind === "room") {
    const idx = game.connectedRoomChoices().findIndex((r) => !r.cleared);
    return offer(String((idx >= 0 ? idx : 0) + 1));
  }
  if (ui.kind === "pickSkill") {
    const actor = getActorByRef(ui.actorRef, game.ctx) as Character;
    const idx = actor.unlockedSkillIds.map(getSkill).findIndex((s) => s.target === "singleEnemy" && actor.mp >= s.mpCost);
    if (idx >= 0 && offer(String(idx + 1))) return String(idx + 1);
  }
  return offer("1") ?? offer("RETURN");
}

/**
 * A looping bot is usually stuck in a submenu that never changes the run (character sheet, log, save menu…),
 * so it backs out and favours the keys that move a run forward over global ones like [b] [l] [s].
 */
export function loopBreakKey(rng: Rng, footer: FooterInfo): string {
  if (footer.keys.length === 0) return pick(rng, ["RETURN", "ESCAPE", "1"]);
  if (footer.keys.includes("ESCAPE") && rng.next() < LOOP_ESCAPE_CHANCE) return "ESCAPE";
  const weight = (key: string) => (/^\d$/.test(key) || key === "RETURN" ? LOOP_PROGRESS_WEIGHT : 1);
  let roll = rng.next() * footer.keys.reduce((sum, key) => sum + weight(key), 0);
  for (const key of footer.keys) {
    roll -= weight(key);
    if (roll < 0) return key;
  }
  return footer.keys[footer.keys.length - 1]!;
}

function saveFileStamp(): number {
  const path = join(SAVE_DIR, `${SAVE_SLOT}.json`);
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

function stateSignature(game: Game): string {
  return JSON.stringify([game.state, game.ctx.monsters, game.ctx.summons]);
}

export async function playRun(options: RunOptions): Promise<RunResult> {
  const { gameSeed, botSeed, maxSteps } = options;
  const rng = new Rng(botSeed);
  rmSync(SAVE_DIR, { recursive: true, force: true });
  mkdirSync(SAVE_DIR, { recursive: true });

  const classIds: Id[] = shuffled(rng, CLASSES.map((c) => c.id)).slice(0, PARTY_SIZE);
  const abilityIds: (Id | null)[] = shuffled(rng, ABILITIES.map((a) => a.id)).slice(0, PARTY_SIZE).map((id) => (rng.next() < 0.5 ? id : null));
  const floorDepth = pick(rng, START_DEPTHS);
  const levelOffset = pick(rng, LEVEL_OFFSETS);
  let size = pick(rng, PLAY_SIZES);
  const start = floorDepth === 1 && levelOffset === 0 ? "fresh run" : `floor ${floorDepth}, level ${Math.max(1, Math.min(MAX_LEVEL, floorDepth + levelOffset))}`;

  let game = new Game(gameSeed, classIds, undefined, abilityIds);
  if (start !== "fresh run") applyDump(game, { level: floorDepth + levelOffset, floorDepth, roomArg: "entry" });
  game.currentSaveSlot = SAVE_SLOT;

  let setup = await createTestRenderer(size);
  let app = new App(setup.renderer, game, { autoReveal: false });
  let quitRequested = false;
  const stubQuit = () => {
    app.quit = () => {
      quitRequested = true;
    };
  };
  stubQuit();
  await setup.renderOnce();

  const failures: ReportFinding[] = [];
  const warnings: ReportFinding[] = [];
  const seen = new Set<string>();
  const gallery = new Map<string, GalleryEntry>();
  const probedAtMinSize = new Set<string>();
  const recent: string[] = [];
  const reproduce = `bun run random-play --game-seed ${gameSeed} --bot-seed ${botSeed} --max-steps ${maxSteps}`;

  const record = (into: ReportFinding[], findings: Finding[], frame: FrameCapture | null, at: Size, uiKind: string, stack?: string) => {
    for (const f of findings) {
      const key = `${f.type}|${f.detail}|${uiKind}|${sizeLabel(at)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      into.push({ ...f, uiKind, size: sizeLabel(at), gameSeed, botSeed, start, recentSteps: [...recent], stack, frame, reproduce });
    }
  };
  const capture = () => toFrameCapture(setup.captureSpans());

  // OpenTUI's KeyHandler catches anything a keypress handler throws and only logs it, so the
  // game carries on with a half-drawn screen; route those logs into findings instead.
  const swallowed: Error[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const error = args.find((a): a is Error => a instanceof Error);
    if (error) swallowed.push(error);
    else originalConsoleError(...args);
  };
  const settle = async () => {
    for (let i = 0; i < MAX_REVEAL_TICKS && app.debugRevealActive; i++) app.tickReveal();
    await setup.renderOnce();
  };

  let outcome = "max steps";
  let lastProgressStep = 0;
  let step = 0;
  for (; step < maxSteps; step++) {
    try {
      const kind = app.debugUiState.kind;
      const frameBefore = setup.captureCharFrame();
      const footer = parseFooter(footerText(frameBefore));

      const galleryKey = `${kind}@${sizeLabel(size)}`;
      const shot = gallery.get(galleryKey);
      if (shot) shot.count++;
      else gallery.set(galleryKey, { uiKind: kind, size: sizeLabel(size), count: 1, frame: capture() });

      const frameFindings = [...findTextLeaks(frameBefore), ...findLongDecimals(frameBefore), ...findFooterIssues(footer)];
      const layout = findLayoutIssues(frameBefore, layoutRequirement(kind, false));
      const stateFindings = findInvariantViolations(game.state, game.ctx);
      const needsEvidence = frameFindings.length + layout.failures.length + layout.warnings.length + stateFindings.length > 0;
      const evidence = needsEvidence ? capture() : null;
      record(failures, [...frameFindings, ...layout.failures, ...stateFindings], evidence, size, kind);
      record(warnings, layout.warnings, evidence, size, kind);

      if (!probedAtMinSize.has(kind)) {
        probedAtMinSize.add(kind);
        setup.resize(MIN_SIZE.width, MIN_SIZE.height);
        await setup.renderOnce();
        const small = setup.captureCharFrame();
        const smallFindings = [...findFooterIssues(parseFooter(footerText(small))), ...findLayoutIssues(small, layoutRequirement(kind, true)).failures];
        record(failures, smallFindings, smallFindings.length > 0 ? capture() : null, MIN_SIZE, kind);
        setup.resize(size.width, size.height);
        await setup.renderOnce();
      }

      if (game.state.gameOver !== null && kind === "gameover") {
        outcome = game.state.gameOver;
        break;
      }

      const saveAllowed = game.state.gameOver === null && kind !== "abilityBuyback" && kind !== "gameover";
      if (saveAllowed && rng.next() < (game.state.combat ? SAVE_ROUND_TRIP_CHANCE.combat : SAVE_ROUND_TRIP_CHANCE.other)) {
        recent.push(`[${kind}] save + reload${game.state.combat ? " (mid-combat)" : ""}`);
        saveRun(game);
        game = gameFromSave(loadSave(SAVE_SLOT), SAVE_SLOT, gameSeed);
        setup.renderer.destroy();
        setup = await createTestRenderer(size);
        app = new App(setup.renderer, game, { autoReveal: false });
        stubQuit();
        await settle();
        continue;
      }

      if (rng.next() < RESIZE_CHANCE) {
        size = pick(rng, PLAY_SIZES);
        recent.push(`[${kind}] resize to ${sizeLabel(size)}`);
        setup.resize(size.width, size.height);
        await setup.renderOnce();
        continue;
      }

      const maxDigit = Math.max(0, ...footer.digits);
      let key: string;
      if (maxDigit > 0 && maxDigit < 9 && rng.next() < HIDDEN_KEY_PROBE_CHANCE) {
        key = String(maxDigit + 1);
      } else {
        // The cautious choice can loop on a screen (re-picking the shown tab); once nothing has moved for a while, break out instead.
        if (step - lastProgressStep >= LOOP_BREAK_STEPS) {
          key = loopBreakKey(rng, footer);
        } else {
          const sensible = rng.next() < SENSIBLE_CHANCE ? sensibleKey(app, footer) : null;
          key = sensible ?? (footer.keys.length > 0 ? pick(rng, footer.keys) : pick(rng, ["RETURN", "ESCAPE", "1"]));
        }
      }
      const advertised = footer.keys.includes(key);

      const stateBefore = stateSignature(game);
      const savedBefore = saveFileStamp();
      recent.push(`[${kind}] press ${key}${advertised ? "" : " (not in footer)"}`);
      if (recent.length > RECENT_STEPS) recent.shift();
      setup.mockInput.pressKey(key);
      // A lone ESC byte is only delivered once the input parser's escape-sequence timeout passes.
      if (key === "ESCAPE") await Bun.sleep(ESCAPE_DELIVERY_MS);
      await settle();
      // Quitting is stubbed out so the run keeps going; the press did its job, so it is not judged as a key.
      if (quitRequested) {
        quitRequested = false;
        recent.push(`[${kind}] quit requested (ignored)`);
        if (app.debugUiState.kind === kind) {
          setup.mockInput.pressKey("ESCAPE");
          await Bun.sleep(ESCAPE_DELIVERY_MS);
          await settle();
        }
        continue;
      }

      for (const error of swallowed.splice(0)) {
        record(failures, [{ type: "crash", detail: `thrown inside a key handler: ${error.message}` }], capture(), size, kind, error.stack);
      }

      const stateAfter = stateSignature(game);
      const effect = {
        key,
        advertised,
        frameChanged: setup.captureCharFrame() !== frameBefore,
        uiChanged: app.debugUiState.kind !== kind,
        stateChanged: stateAfter !== stateBefore,
        saveWritten: saveFileStamp() !== savedBefore,
      };
      // Named after the screen the key was pressed on, not the one it led to.
      const keyFindings = classifyKeyEffect(effect, footer);
      if (keyFindings.failures.length + keyFindings.warnings.length > 0) {
        const evidence = capture();
        record(failures, keyFindings.failures, evidence, size, kind);
        record(warnings, keyFindings.warnings, evidence, size, kind);
      }

      if (effect.stateChanged) lastProgressStep = step;
      if (step - lastProgressStep >= SOFT_LOCK_STEPS) {
        record(failures, [{ type: "softLock", detail: `the run did not change for ${SOFT_LOCK_STEPS} keypresses` }], capture(), size, app.debugUiState.kind);
        outcome = "soft-lock";
        break;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      let frame: FrameCapture | null = null;
      try {
        frame = capture();
      } catch {
        frame = null;
      }
      record(failures, [{ type: "crash", detail: err.message }], frame, size, app.debugUiState.kind, err.stack);
      outcome = "crash";
      break;
    }
  }

  console.error = originalConsoleError;
  setup.renderer.destroy();
  return { failures, warnings, gallery: [...gallery.values()], steps: step, outcome };
}
