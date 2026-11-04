import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../../src/ui/app";
import { Game } from "../../src/engine/game";
import { Rng } from "../../src/engine/rng";
import { getRoom } from "../../src/engine/dungeon";
import { saveRun, loadSave, gameFromSave } from "../../src/engine/save";
import { SAVE_DIR } from "../../src/engine/paths";
import { ABILITIES } from "../../src/data/abilities";
import { BOSS_FLOOR_INTERVAL } from "../../src/data/levelGrowth";
import { t } from "../../src/data/strings";
import type { Id } from "../../src/types";
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
import { levelAt, type GuardTier } from "./curve";
import { TeamPolicy, type Team } from "./team";
import { screenKeyOf, screenLabel } from "./evidence";

export interface Size {
  width: number;
  height: number;
}

/** Tall enough that every panel fits on screen. */
export const PLAY_SIZES: Size[] = [
  { width: 150, height: 70 },
  { width: 180, height: 70 },
  { width: 220, height: 70 },
];
/** The smallest supported terminal; each new screen is also checked once at this size. */
export const MIN_SIZE: Size = { width: 150, height: 45 };

/** The first elite and first boss of each ten floors, below the ending checkpoint. */
export const GUARD_FLOORS = Array.from({ length: 10 }, (_, i) => [i * 10 + 1, i * 10 + 5]).flat();
/** Fresh runs keep the opening scenes in play; the rest start on a guard floor at that floor's average level. */
const FRESH_RUN_CHANCE = 0.25;
const ABILITY_SLOTS = 4;
const SAVE_SLOT = "slot1";
const RECENT_STEPS = 50;
const SOFT_LOCK_STEPS = 300;
const LOOP_BREAK_STEPS = 30;
/** How often the bot plays the team's choice rather than a random footer key: high in a fight so guards get beaten, lower elsewhere so menus get mashed. */
const SENSIBLE_CHANCE = { combat: 0.95, other: 0.7 };
/** While looping: chance to back out of a screen that offers Esc, and how much likelier a digit or Enter is than any other footer key. */
const LOOP_ESCAPE_CHANCE = 0.5;
const LOOP_PROGRESS_WEIGHT = 8;
const HIDDEN_KEY_PROBE_CHANCE = 0.1;
const SAVE_ROUND_TRIP_CHANCE = { combat: 0.05, other: 0.02 };
const RESIZE_CHANCE = 0.05;
const MAX_REVEAL_TICKS = 1000;
const ESCAPE_DELIVERY_MS = 40;

export const FLOOR_CLEARED = "floor cleared";
export const ROOM_LEFT = "room left";

/** Evidence runs play at one size, so each screen is captured the same way every time. */
export const EVIDENCE_SIZE: Size = { width: 180, height: 70 };
/** A floor may lack the room a scenario asks for; this many floors further down are tried in turn. */
const SCENARIO_FLOOR_TRIES = 20;

/**
 * A fixed start for an evidence run. It also turns off the random save round trips, resizes and
 * hidden-key probes, so the same code captures the same screens.
 */
export interface Scenario {
  name: string;
  depth: number;
  level: number;
  roomArg: string;
  forceEventId?: Id;
  fresh?: boolean;
  /** Ends the run once the party leaves the room it started in. */
  stopOnLeavingRoom?: boolean;
}

export interface RunOptions {
  gameSeed: number;
  botSeed: number;
  maxSteps: number;
  team: Team;
  scenario?: Scenario;
}

export interface GuardResult {
  depth: number;
  tier: GuardTier;
  won: boolean;
}

export interface RunStats {
  team: string;
  startDepth: number;
  rooms: number;
  guards: GuardResult[];
  /** Each room entered: the party's highest fear, and satiety. */
  samples: { fear: number; satiety: number }[];
  itemsUsed: number;
  starvedTurns: number;
}

export interface RunResult {
  stats: RunStats;
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

export const hasLeftFloor = (game: Game, startDepth: number) => game.state.floor.depth !== startDepth;

/** Called once per step: notes each new room and the end of each guard fight. */
function watchRun(game: Game, stats: RunStats, watch: { room: string; guard: number | null }): void {
  const s = game.state;
  const depth = s.floor.depth;
  const room = getRoom(s.floor, s.currentRoomId);
  const roomKey = `${depth}/${room.id}`;
  if (roomKey !== watch.room) {
    watch.room = roomKey;
    stats.rooms++;
    stats.samples.push({ fear: Math.max(...s.party.filter((c) => c.isAlive).map((c) => c.survival.fear), 0), satiety: s.satiety });
  }
  if (watch.guard === null && s.combat && !s.combat.outcome && room.type === "boss") watch.guard = depth;
  if (watch.guard === null) return;
  const lost = s.combat?.outcome === "defeat" || s.gameOver === "defeat";
  const won = s.combat?.outcome === "victory" || depth !== watch.guard;
  if (!lost && !won) return;
  stats.guards.push({ depth: watch.guard, tier: watch.guard % BOSS_FLOOR_INTERVAL === 0 ? "boss" : "elite", won: !lost });
  watch.guard = null;
}

/** A looping bot is usually stuck in a submenu, so it backs out and favours keys that move the run forward. */
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
  const { gameSeed, botSeed, maxSteps, team, scenario } = options;
  const rng = new Rng(botSeed);
  rmSync(SAVE_DIR, { recursive: true, force: true });
  mkdirSync(SAVE_DIR, { recursive: true });

  const classIds: Id[] = team.members.map((m) => m.classId);
  const abilityIds: (Id | null)[] = shuffled(rng, ABILITIES.map((a) => a.id)).slice(0, ABILITY_SLOTS).map((id) => (rng.next() < 0.5 ? id : null));
  const fresh = scenario ? !!scenario.fresh : rng.next() < FRESH_RUN_CHANCE;
  let floorDepth = scenario ? scenario.depth : fresh ? 1 : pick(rng, GUARD_FLOORS);
  const level = scenario ? scenario.level : Math.round(levelAt(floorDepth));
  let size = scenario ? EVIDENCE_SIZE : pick(rng, PLAY_SIZES);

  const startGame = (depth: number) => {
    const g = new Game(gameSeed, classIds, undefined, abilityIds, fresh);
    if (!fresh) applyDump(g, { level, floorDepth: depth, roomArg: scenario?.roomArg ?? "entry", forceEventId: scenario?.forceEventId });
    return g;
  };
  let game: Game | null = null;
  for (let tries = 0; !game; tries++) {
    try {
      game = startGame(floorDepth + tries);
      floorDepth += tries;
    } catch (error) {
      if (!scenario || tries >= SCENARIO_FLOOR_TRIES) throw error;
    }
  }
  game.currentSaveSlot = SAVE_SLOT;
  const start = scenario ? `${scenario.name}, floor ${floorDepth}, level ${level}` : fresh ? "fresh run" : `floor ${floorDepth}, level ${level}`;
  const startRoomId = game.state.currentRoomId;

  const policy = new TeamPolicy(team);
  const stats: RunStats = { team: team.name, startDepth: floorDepth, rooms: 0, guards: [], samples: [], itemsUsed: 0, starvedTurns: 0 };
  const watch = { room: "", guard: null as number | null };

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
  const reproduce = `bun run random-play --game-seed ${gameSeed} --bot-seed ${botSeed} --max-steps ${maxSteps} --team ${team.name}`;

  const record = (into: ReportFinding[], findings: Finding[], frame: FrameCapture | null, at: Size, uiKind: string, stack?: string) => {
    for (const f of findings) {
      const key = `${f.type}|${f.detail}|${uiKind}|${sizeLabel(at)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      into.push({ ...f, uiKind, size: sizeLabel(at), gameSeed, botSeed, start, recentSteps: [...recent], stack, frame, reproduce });
    }
  };
  const capture = () => toFrameCapture(setup.captureSpans());
  const screenContent = () => {
    const rows = setup.captureCharFrame().split("\n");
    const cut = (id: string) => {
      const box = setup.renderer.root.findDescendantById(id)!;
      return rows.slice(box.y, box.y + box.height).map((row) => Array.from(row).slice(box.x, box.x + box.width).join("").trimEnd());
    };
    const fullLog = setup.renderer.root.findDescendantById("full-log-box")!.visible;
    return [...cut(fullLog ? "full-log-box" : "main-box"), ...cut("footer-box")].join("\n");
  };

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
      watchRun(game, stats, watch);
      if (hasLeftFloor(game, floorDepth)) {
        outcome = FLOOR_CLEARED;
        break;
      }
      if (scenario?.stopOnLeavingRoom && game.state.currentRoomId !== startRoomId) {
        outcome = ROOM_LEFT;
        break;
      }
      const kind = app.debugUiState.kind;
      const frameBefore = setup.captureCharFrame();
      const footer = parseFooter(footerText(frameBefore));

      const screen = screenKeyOf(app.debugUiState, game);
      const label = screenLabel(screen);
      const roomCleared = getRoom(game.state.floor, game.state.currentRoomId).cleared;
      const addShot = (at: Size, frame: () => FrameCapture) => {
        const shot = gallery.get(`${label}@${sizeLabel(at)}`);
        if (shot) shot.count++;
        else gallery.set(`${label}@${sizeLabel(at)}`, { uiKind: kind, event: screen.event, screenCase: screen.screenCase, size: sizeLabel(at), count: 1, frame: frame(), content: screenContent(), roomCleared });
      };
      addShot(size, capture);

      const frameFindings = [...findTextLeaks(frameBefore), ...findLongDecimals(frameBefore), ...findFooterIssues(footer)];
      const layout = findLayoutIssues(frameBefore, layoutRequirement(kind, false));
      const stateFindings = findInvariantViolations(game.state, game.ctx);
      const needsEvidence = frameFindings.length + layout.failures.length + layout.warnings.length + stateFindings.length > 0;
      const evidence = needsEvidence ? capture() : null;
      record(failures, [...frameFindings, ...layout.failures, ...stateFindings], evidence, size, kind);
      record(warnings, layout.warnings, evidence, size, kind);

      if (!probedAtMinSize.has(label)) {
        probedAtMinSize.add(label);
        setup.resize(MIN_SIZE.width, MIN_SIZE.height);
        await setup.renderOnce();
        const small = setup.captureCharFrame();
        const smallShot = capture();
        addShot(MIN_SIZE, () => smallShot);
        const smallFindings = [...findFooterIssues(parseFooter(footerText(small))), ...findLayoutIssues(small, layoutRequirement(kind, true)).failures];
        record(failures, smallFindings, smallFindings.length > 0 ? smallShot : null, MIN_SIZE, kind);
        setup.resize(size.width, size.height);
        await setup.renderOnce();
      }

      if (game.state.gameOver !== null && kind === "gameover") {
        outcome = game.state.gameOver;
        break;
      }

      const saveAllowed = game.state.gameOver === null && kind !== "abilityBuyback" && kind !== "gameover";
      if (saveAllowed && !scenario && rng.next() < (game.state.combat ? SAVE_ROUND_TRIP_CHANCE.combat : SAVE_ROUND_TRIP_CHANCE.other)) {
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

      if (!scenario && rng.next() < RESIZE_CHANCE) {
        size = pick(rng, PLAY_SIZES);
        recent.push(`[${kind}] resize to ${sizeLabel(size)}`);
        setup.resize(size.width, size.height);
        await setup.renderOnce();
        continue;
      }

      const maxDigit = Math.max(0, ...footer.digits);
      let key: string;
      if (!scenario && maxDigit > 0 && maxDigit < 9 && rng.next() < HIDDEN_KEY_PROBE_CHANCE) {
        key = String(maxDigit + 1);
      } else {
        // The cautious choice can loop on a screen (re-picking the shown tab); once nothing has moved for a while, break out instead.
        if (step - lastProgressStep >= LOOP_BREAK_STEPS) {
          key = loopBreakKey(rng, footer);
        } else {
          const wanted = rng.next() < (game.state.combat ? SENSIBLE_CHANCE.combat : SENSIBLE_CHANCE.other) ? (policy.chooseKey(app, footer) ?? footer.keys.find((k) => k === "1" || k === "RETURN") ?? null) : null;
          const sensible = wanted !== null && footer.keys.includes(wanted) ? wanted : null;
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
  stats.itemsUsed = policy.itemsUsed;
  stats.starvedTurns = policy.starvedTurns;
  return { stats, failures, warnings, gallery: [...gallery.values()], steps: step, outcome };
}
