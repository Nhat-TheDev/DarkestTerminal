import { BoxRenderable, ScrollBoxRenderable, TextRenderable, StyledText, type CliRenderer, type KeyEvent, type TextChunk } from "@opentui/core";
import type { Character, Monster, Id, LogEntry, LogSession, CombatantSnapshot, CombatState, PartyStateSnapshot, RoomType, Floor } from "../types";
import { Game } from "../engine/game";
import { getActorByRef } from "../engine/combat";
import { getArtifact } from "../data/artifacts";
import { getAbility } from "../data/abilities";
import { getEvent } from "../data/events";
import { getRoom } from "../engine/dungeon";
import { getFearTier, isHelpfulStatusEffect } from "../engine/resolver";
import { getStatusEffect, statusDisplayName } from "../data/statusEffects";
import { isPartyExhausted, isPartyDying } from "../engine/survival";
import { expCostForLevel, MAX_LEVEL } from "../data/levelGrowth";
import { t } from "../data/strings";
import { saveRun, deleteSlot } from "../engine/save";
import {
  PALETTE,
  CLASS_STYLE,
  chip,
  plainChunk,
  colorChunk,
  boldColorChunk,
  hpColorFor,
  fearColorFor,
  joinLines,
  progressBar,
  highlightKeyHints,
} from "./theme";
import {
  spriteForClass,
  spriteForMonster,
  spriteForEvent,
  renderSpriteInSlot,
  MAX_BOSS_HEIGHT,
  TOMBSTONE_SPRITE,
  CAMPFIRE_SPRITE,
  TREASURE_CHEST_SPRITE,
} from "./sprites";
import { SLOT_WIDTH, SLOT_GAP, DIVIDER_WIDTH, EMPTY_ENEMY_WIDTH, UNIT_BLOCK_HEIGHT, ICON_BAND_ROWS, centerText, monsterStyle, mergeBlocksHorizontally } from "./layout";
import { RevealQueue, REVEAL_TICK_MS } from "./revealQueue";
import { unitFocus, focusedUnit, buildSideSpriteArea, blankIconBand, tierFrameHeight, hpDeltas, type BattlefieldUnit } from "./battlefieldFocus";
import { logLines } from "./screens/log";
import { type UiState, inventoryEntries, ownedArtifactEntries, eventUiState, ARTIFACT_ICON, ABILITY_ICON, SUMMON_ICON } from "./state";
import { PAGE_SIZE, pageCount, clampPage } from "./pagination";
import { composeFooter } from "./keyHints";
import type { ScreenContext } from "./screens/context";
import * as eventsScreen from "./screens/events";
import * as roomScreen from "./screens/room";
import * as combatScreen from "./screens/combat";
import * as inventoryScreen from "./screens/inventory";
import * as artifactsScreen from "./screens/artifacts";
import * as artifactDecisionScreen from "./screens/artifactDecision";
import * as rewardsScreen from "./screens/rewards";
import * as campScreen from "./screens/camp";
import * as campReflectionScreen from "./screens/campReflection";
import * as floorMilestoneScreen from "./screens/floorMilestone";
import * as endingScreen from "./screens/ending";
import * as founderDialogueScreen from "./screens/founderDialogue";
import * as saveScreen from "./screens/save";
import * as gameoverScreen from "./screens/gameover";
import * as abilityBuybackScreen from "./screens/abilityBuyback";
import * as characterInfoScreen from "./screens/characterInfo";
import * as runnerScreen from "./screens/runner";

const ROOM_LOG_SIZE = 50;
const RUN_LOG_SIZE = 500;

/** "eventArtifactPick" reserves digit 9 on every page for the trailing "Leave" option. */
function pageSizeFor(kind: UiState["kind"]): number {
  return kind === "eventArtifactPick" ? PAGE_SIZE - 1 : PAGE_SIZE;
}

const FEAR_TIER_LABEL: Record<number, string> = {
  1: t("ui.fearTier1"),
  2: t("ui.fearTier2"),
  3: t("ui.fearTier3"),
  4: t("ui.fearTier4"),
};

const STAT_BAR_WIDTH = 14;
const EXP_BAR_WIDTH = 24;

/** Room-progress icons: " " (blank) for combat/boss, "○" for event, "△" for rest. The current room always renders as "■" regardless of its type. */
const ROOM_TYPE_ICON: Record<RoomType, string> = { combat: " ", boss: " ", event: "○", rest: "△" };
const CURRENT_ROOM_ICON = "■";

export class App implements ScreenContext {
  game: Game;
  private ui: UiState = { kind: "room" };
  private root: BoxRenderable;
  private header: TextRenderable;
  private battlefield: TextRenderable;
  private party: TextRenderable;
  private main: TextRenderable;
  private monsters: TextRenderable;
  private log: TextRenderable;
  private logScroll: ScrollBoxRenderable;
  private footer: TextRenderable;
  private chrome: BoxRenderable[];
  private fullLogBox: BoxRenderable;
  private fullLogText: TextRenderable;
  private fullLogScroll: ScrollBoxRenderable;
  private fullLogJustOpened = false;
  /** `runLogVersion` the run-log screen was last built from. */
  private fullLogBuiltFrom = -1;
  private lastLogLength = 0;
  private observedCombat: CombatState | null = null;
  private roomLog: LogEntry[] = [];
  private roomLogFloor: Floor | null = null;
  private roomLogRoomId: Id | null = null;
  private runLog: LogEntry[] = [];
  /** Bumped on every append: runLog's length stops changing once it is full. */
  private runLogVersion = 0;
  private reveal = new RevealQueue();
  /** HP change per unit over the lit session, worked out when it lights up (shown from its impact). */
  private focusDeltas = new Map<Id, number>();
  private deltasFor: LogSession | null = null;
  private autoReveal: boolean;
  private lastRender = { revealing: false, focusId: null as number | null, logTailSessionId: null as number | null };
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private displaySnapshot: CombatantSnapshot[] | null = null;
  private displayPartySnapshot: PartyStateSnapshot | null = null;
  private pendingFloorAdvance = false;
  private pendingCampOffer = false;
  private listPage = 0;
  private progress: TextRenderable;

  constructor(private renderer: CliRenderer, game?: Game, options: { autoReveal?: boolean } = {}) {
    this.autoReveal = options.autoReveal ?? true;
    this.game = game ?? new Game();

    const panel = {
      border: true as const,
      backgroundColor: PALETTE.panelBg,
      borderColor: PALETTE.border,
      titleColor: PALETTE.title,
    };

    this.root = new BoxRenderable(renderer, {
      id: "root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: PALETTE.bg,
    });
    renderer.root.add(this.root);

    this.header = new TextRenderable(renderer, { id: "header", content: "", fg: PALETTE.text });
    const headerBox = new BoxRenderable(renderer, {
      id: "header-box",
      ...panel,
      borderColor: PALETTE.borderAccent,
      height: 4,
      title: "DARKEST-TERMINAL",
    });
    headerBox.add(this.header);
    this.root.add(headerBox);

    const progressBox = new BoxRenderable(renderer, { id: "progress-box", ...panel, height: 3, title: t("ui.panelProgress") });
    this.progress = new TextRenderable(renderer, { id: "progress", content: "", fg: PALETTE.text });
    progressBox.add(this.progress);
    this.root.add(progressBox);

    const battlefieldBox = new BoxRenderable(renderer, {
      id: "battlefield-box",
      ...panel,
      height: UNIT_BLOCK_HEIGHT + 2,
      title: t("ui.panelBattlefield"),
    });
    this.battlefield = new TextRenderable(renderer, { id: "battlefield", content: "", fg: PALETTE.text, bg: PALETTE.panelBg });
    battlefieldBox.add(this.battlefield);
    this.root.add(battlefieldBox);

    const body = new BoxRenderable(renderer, { id: "body", flexDirection: "row", flexGrow: 1, backgroundColor: PALETTE.bg });
    this.root.add(body);

    const partyBox = new BoxRenderable(renderer, { id: "party-box", ...panel, width: 34, title: t("ui.panelParty") });
    this.party = new TextRenderable(renderer, { id: "party", content: "", fg: PALETTE.text });
    partyBox.add(this.party);
    body.add(partyBox);

    const mainBox = new BoxRenderable(renderer, { id: "main-box", ...panel, flexGrow: 1, title: t("ui.panelMain") });
    this.main = new TextRenderable(renderer, { id: "main", content: "", fg: PALETTE.text });
    mainBox.add(this.main);
    body.add(mainBox);

    const monstersBox = new BoxRenderable(renderer, { id: "monsters-box", ...panel, width: 32, title: t("ui.panelMonsters") });
    this.monsters = new TextRenderable(renderer, { id: "monsters", content: "", fg: PALETTE.text });
    monstersBox.add(this.monsters);
    body.add(monstersBox);

    const logBox = new BoxRenderable(renderer, { id: "log-box", ...panel, height: 8, title: t("ui.panelLog") });
    this.logScroll = new ScrollBoxRenderable(renderer, {
      id: "log-scroll",
      width: "100%",
      height: "100%",
      scrollX: false,
      scrollY: true,
      stickyScroll: true,
      stickyStart: "bottom",
    });
    this.log = new TextRenderable(renderer, { id: "log", content: "", fg: PALETTE.dim });
    this.logScroll.add(this.log);
    logBox.add(this.logScroll);
    this.root.add(logBox);

    this.chrome = [headerBox, progressBox, battlefieldBox, body, logBox];

    this.fullLogBox = new BoxRenderable(renderer, { id: "full-log-box", ...panel, flexGrow: 1, title: t("ui.panelFullLog", { count: RUN_LOG_SIZE }), visible: false });
    this.fullLogScroll = new ScrollBoxRenderable(renderer, {
      id: "full-log-scroll",
      width: "100%",
      height: "100%",
      scrollX: false,
      scrollY: true,
      stickyScroll: true,
      stickyStart: "bottom",
    });
    this.fullLogText = new TextRenderable(renderer, { id: "full-log", content: "", fg: PALETTE.dim });
    this.fullLogScroll.add(this.fullLogText);
    this.fullLogBox.add(this.fullLogScroll);
    this.root.add(this.fullLogBox);

    this.footer = new TextRenderable(renderer, { id: "footer", content: "", fg: PALETTE.dim });
    const footerBox = new BoxRenderable(renderer, { id: "footer-box", height: 3, backgroundColor: PALETTE.bg });
    footerBox.add(this.footer);
    this.root.add(footerBox);

    renderer.keyInput.on("keypress", (key: KeyEvent) => this.handleKey(key));
    this.syncUiToGameState();
    this.render();
  }

  get debugUiState(): UiState {
    return this.ui;
  }

  get debugGame(): Game {
    return this.game;
  }

  get debugRoomLog(): LogEntry[] {
    return this.roomLog;
  }

  get debugRunLog(): LogEntry[] {
    return this.runLog;
  }

  get debugFocus(): LogSession | null {
    return this.reveal.focus;
  }

  get debugRevealActive(): boolean {
    return this.reveal.active;
  }

  get debugDisplaySnapshot(): CombatantSnapshot[] | null {
    return this.displaySnapshot;
  }

  get debugRevealHolding(): boolean {
    return this.reveal.holding;
  }

  get debugFocusDeltas(): Map<Id, number> {
    return this.focusDeltas;
  }

  get debugLastRender() {
    return this.lastRender;
  }

  setUi(next: UiState): void {
    if (next.kind !== this.ui.kind) this.listPage = 0;
    this.ui = next;
  }

  getListPage(): number {
    return this.listPage;
  }

  setListPage(value: number): void {
    this.listPage = value;
  }

  /** List length behind the current screen's digit-selectable options, or null if it isn't a paginated list. */
  private listCountFor(ui: UiState): number | null {
    switch (ui.kind) {
      case "pickItemOutOfCombat":
      case "pickItemInCombat":
        return inventoryEntries(this.game.state.inventory).length;
      case "artifactMenu":
      case "eventArtifactPick":
      case "eventHermitPickArtifact":
        return ownedArtifactEntries(this.game.state.party).length;
      case "runnerSell":
        return runnerScreen.sellableEntries(this.game).length;
      case "roomReward":
        return ui.viewing ? null : ui.entries.length;
      default:
        return null;
    }
  }

  logInfo(text: string): void {
    this.appendLog([{ text, kind: "info" }]);
  }

  syncUiToGameState(): void {
    // Part F.1 — a guaranteed, non-rolled story beat once floor 100's own boss falls, checked before
    // anything else (including a pending artifact decision from that same boss kill).
    if (this.game.state.pendingEndingCheckpoint) {
      this.ui = { kind: "endingCheckpoint" };
      return;
    }
    // Part F.5 — the founder's dialogue, same "block everything else" priority, checked right
    // after the floor-100 checkpoint since it's the same kind of guaranteed, non-rolled beat.
    if (this.game.state.pendingFounderDialogue) {
      this.ui = { kind: "founderDialogue" };
      return;
    }
    if (this.game.state.gameOver) {
      // Every terminal ending (not just ordinary defeat) clears this run's slot the same way —
      // Stay/Let Go/Leave are conclusions, not a state a later Continue should ever resume from.
      // "abilityBuyback" is also part of the post-death flow — the slot must still be cleared
      // exactly once on the first transition into either screen, not re-fired every time
      // syncUiToGameState is called while the buyback is still in progress.
      if (this.ui.kind !== "gameover" && this.ui.kind !== "abilityBuyback" && this.game.state.gameOver !== "victory" && this.game.currentSaveSlot) {
        deleteSlot(this.game.currentSaveSlot);
        this.game.currentSaveSlot = null;
        this.pushToast(t("ui.saveDeletedMsg"));
      }
      if (this.game.state.pendingAbilityBuyback) {
        this.ui = { kind: "abilityBuyback" };
        return;
      }
      this.ui = { kind: "gameover" };
      return;
    }
    const combat = this.game.state.combat;
    if (!combat) {
      if (this.game.state.pendingArtifactDecision) {
        this.ui = { kind: "artifactDecision" };
        return;
      }
      if (this.game.state.pendingReflection) {
        this.ui = { kind: "eventReflection" };
        return;
      }
      const room = getRoom(this.game.state.floor, this.game.state.currentRoomId);
      const restOpen = room.type === "rest" && !room.cleared;
      // Camp Reflection is armed on entering a Rest room but waits until the room's own choice is made.
      if (this.game.state.pendingCampReflectionTier !== null && !restOpen) {
        this.ui = { kind: "campReflection" };
        return;
      }
      if (this.game.state.pendingFloorMilestoneOmenId) {
        this.ui = { kind: "floorMilestone" };
        return;
      }
      if (restOpen) {
        const runner = this.game.state.restRunner;
        if (runner && !runner.noticeShown) {
          this.ui = { kind: "runnerNotice" };
        } else if (!runner || (this.ui.kind !== "runnerShop" && this.ui.kind !== "runnerSell" && this.ui.kind !== "runnerBarter")) {
          this.ui = { kind: "rest" };
        }
        return;
      }
      if (room.type === "event" && !room.cleared && room.rolledEventId) {
        this.ui = eventUiState(room.rolledEventId);
        return;
      }
      this.ui = { kind: "room" };
      return;
    }
    if (combat.phase === "over") {
      this.ui = { kind: "combatOver" };
      return;
    }
    if (combat.phase === "resolution") {
      this.ui = { kind: "roundResolved" };
      return;
    }
    const next = this.game
      .livingCharactersNeedingAction()
      .find((ref) => !combat.queuedActions.some((qa) => qa.actor.id === ref.id && qa.actor.kind === ref.kind));
    this.ui = next ? { kind: "pickAction", actorRef: next } : { kind: "roundResolved" };
    if (!next && this.game.readyToResolve()) {
      this.game.resolve();
      this.syncUiToGameState();
    }
  }

  private handleKey(key: KeyEvent): void {
    if (key.name === "c" && key.ctrl) {
      this.quit();
      return;
    }
    if (this.ui.kind === "fullLog") {
      if (key.name === "escape") {
        this.ui = this.ui.previous;
        this.render();
      } else if (this.fullLogScroll.handleKeyPress(key)) {
        this.render();
      }
      return;
    }
    if (this.ui.kind !== "gameover" && this.ui.kind !== "abilityBuyback" && this.ui.kind !== "saveMenu" && key.name === "q") {
      this.ui = { kind: "saveMenu", previous: this.ui };
      this.render();
      return;
    }
    if (this.ui.kind !== "gameover" && this.ui.kind !== "abilityBuyback" && key.name === "s") {
      saveRun(this.game);
      this.pushToast(t("ui.quickSavedMsg"));
      this.render();
      return;
    }
    if (key.name === "l") {
      this.ui = { kind: "fullLog", previous: this.ui };
      this.fullLogJustOpened = true;
      this.render();
      return;
    }
    if (this.reveal.active) {
      this.flushPendingReveal();
      return;
    }
    if (this.logScroll.handleKeyPress(key)) {
      this.render();
      return;
    }
    if (key.name === "escape" && this.goBack()) {
      this.render();
      return;
    }
    if (
      key.name === "b" &&
      ["room", "rest", "pickAction", "pickSkill", "skillDetail", "pickItemInCombat", "pickTarget", "roundResolved", "combatOver", "pickItemOutOfCombat", "itemDetail", "artifactMenu", "artifactDetail", "roomReward", "campPrompt"].includes(this.ui.kind)
    ) {
      this.setUi({ kind: "characterInfo", characterIndex: 0, previousUi: this.ui });
      this.render();
      return;
    }
    if (key.name === "left" || key.name === "right") {
      const count = this.listCountFor(this.ui);
      if (count !== null) {
        const size = pageSizeFor(this.ui.kind);
        if (pageCount(count, size) > 1) {
          this.listPage = clampPage(this.listPage + (key.name === "right" ? 1 : -1), count, size);
        }
        this.render();
        return;
      }
    }
    const digit = /^[1-9]$/.test(key.name) ? Number(key.name) : null;

    switch (this.ui.kind) {
      case "room":
      case "rest":
        roomScreen.handleKey(this, this.ui, key, digit);
        break;
      case "runnerNotice":
      case "runnerShop":
      case "runnerSell":
      case "runnerBarter":
        runnerScreen.handleKey(this, this.ui, key, digit);
        break;
      case "pickAction":
      case "pickSkill":
      case "skillDetail":
      case "pickItemInCombat":
      case "pickTarget":
      case "roundResolved":
      case "combatOver":
        combatScreen.handleKey(this, this.ui, key, digit);
        break;
      case "roomReward":
        rewardsScreen.handleKey(this, this.ui, key, digit);
        break;
      case "campPrompt":
        campScreen.handleKey(this, this.ui, key, digit);
        break;
      case "pickItemOutOfCombat":
      case "itemDetail":
        inventoryScreen.handleKey(this, this.ui, key, digit);
        break;
      case "artifactDetail":
      case "artifactMenu":
        artifactsScreen.handleKey(this, this.ui, key, digit);
        break;
      case "artifactDecision":
      case "artifactDecisionPickCharacter":
      case "artifactDecisionPickReplace":
        artifactDecisionScreen.handleKey(this, this.ui, key, digit);
        break;
      case "saveMenu":
        saveScreen.handleKey(this, this.ui, key, digit);
        break;
      case "eventOpenChest":
      case "eventMerchant":
      case "eventCursedShrine":
      case "eventTwinAltars":
      case "eventHpGamble":
      case "eventHpGamblePickPayer":
      case "eventArtifactPick":
      case "eventGamblingDen":
      case "eventHermit":
      case "eventHermitPickArtifact":
      case "eventGuardianFight":
      case "eventReflection":
        eventsScreen.handleKey(this, this.ui, key, digit);
        break;
      case "campReflection":
        campReflectionScreen.handleKey(this, this.ui, key, digit);
        break;
      case "floorMilestone":
        floorMilestoneScreen.handleKey(this, this.ui, key, digit);
        break;
      case "characterInfo":
        characterInfoScreen.handleKey(this, this.ui, key, digit);
        break;
      case "endingCheckpoint":
        endingScreen.handleKey(this, this.ui, key, digit);
        break;
      case "founderDialogue":
        founderDialogueScreen.handleKey(this, this.ui, key, digit);
        break;
      case "abilityBuyback":
        abilityBuybackScreen.handleKey(this, this.ui, key, digit);
        break;
      case "gameover":
        break;
    }
    this.render();
  }

  private goBack(): boolean {
    switch (this.ui.kind) {
      case "pickSkill":
      case "pickItemInCombat":
        this.ui = { kind: "pickAction", actorRef: this.ui.actorRef };
        return true;
      case "skillDetail":
        this.ui = { kind: "pickSkill", actorRef: this.ui.actorRef };
        return true;
      case "pickTarget":
        this.ui = this.ui.source.kind === "skill" ? { kind: "pickSkill", actorRef: this.ui.actorRef } : { kind: "pickItemInCombat", actorRef: this.ui.actorRef };
        return true;
      case "pickItemOutOfCombat":
        this.ui = { kind: "room" };
        return true;
      case "runnerSell":
      case "runnerBarter":
        this.ui = { kind: "runnerShop" };
        return true;
      case "itemDetail":
        this.ui = this.ui.origin.kind === "combat" ? { kind: "pickItemInCombat", actorRef: this.ui.origin.actorRef } : { kind: "pickItemOutOfCombat" };
        return true;
      case "artifactMenu":
        this.ui = { kind: "room" };
        return true;
      case "artifactDetail":
        this.ui = { kind: "artifactMenu" };
        return true;
      case "artifactDecisionPickCharacter":
        this.ui = { kind: "artifactDecision" };
        return true;
      case "artifactDecisionPickReplace":
        this.ui = { kind: "artifactDecisionPickCharacter" };
        return true;
      case "saveMenu":
        this.ui = this.ui.previous;
        return true;
      case "roomReward":
        if (this.ui.viewing) {
          this.ui = { kind: "roomReward", entries: this.ui.entries, viewing: null };
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  quit(): void {
    if (this.revealTimer !== null) clearTimeout(this.revealTimer);
    this.renderer.destroy();
    process.exit(0);
  }

  reportUnusable(reason: string): void {
    if (this.game.state.combat) this.game.state.combat.log.push({ text: reason, kind: "info" });
    else this.appendLog([{ text: reason, kind: "info" }]);
  }

  pushToast(text: string): void {
    if (this.game.state.combat) this.game.state.combat.log.push({ text, kind: "info" });
    else this.appendLog([{ text, kind: "info" }]);
  }

  getPendingFloorAdvance(): boolean {
    return this.pendingFloorAdvance;
  }

  setPendingFloorAdvance(value: boolean): void {
    this.pendingFloorAdvance = value;
  }

  getPendingCampOffer(): boolean {
    return this.pendingCampOffer;
  }

  setPendingCampOffer(value: boolean): void {
    this.pendingCampOffer = value;
  }

  private render(): void {
    const s = this.game.state;
    const room = getRoom(s.floor, s.currentRoomId);
    this.syncRoomLog();

    // Reveal-state bookkeeping runs before the header/party/monster panels below so all of them can
    // read the same "as of the last revealed log line" snapshot, instead of the header alone jumping
    // straight to the live post-combat totals while HP/MP/status are still catching up to the log.
    const combat = s.combat;
    const fresh: LogEntry[] = [];
    // The combat whose round-start state a fresh reveal starts from: normally the current one, but the
    // round that wipes the party ends the combat before this render runs.
    let revealSource = combat;
    if (combat !== this.observedCombat) {
      // Whatever the previous combat logged after the last line this screen saw still has to be narrated.
      const finished = this.observedCombat;
      if (finished && finished.log.length > this.lastLogLength) {
        fresh.push(...finished.log.slice(this.lastLogLength));
        revealSource = finished;
      }
      this.observedCombat = combat;
      this.lastLogLength = 0;
      this.displaySnapshot = null;
      this.displayPartySnapshot = null;
      // A save loaded mid-fight arrives with its resolved rounds already in the log: the player saw them
      // before saving, so they are not replayed.
      if (combat && combat.phase === "command" && combat.log.some((e) => e.snapshot !== undefined)) this.lastLogLength = combat.log.length;
    }
    if (combat && combat.log.length > this.lastLogLength) {
      fresh.push(...combat.log.slice(this.lastLogLength));
      this.lastLogLength = combat.log.length;
    }
    if (fresh.length > 0) {
      // Only a fresh reveal starts from the round-start state and takes its first step now. Lines queued
      // behind a running reveal (a toast, a quicksave) neither rewind HP/MP/coins nor add a tick.
      const wasIdle = !this.reveal.active;
      if (wasIdle) {
        const fromRound = fresh.some((e) => e.snapshot !== undefined);
        this.displaySnapshot = fromRound ? (revealSource?.roundStartSnapshot ?? null) : null;
        this.displayPartySnapshot = fromRound ? (revealSource?.roundStartPartySnapshot ?? null) : null;
      }
      this.reveal.enqueue(fresh);
      if (wasIdle) this.startReveal();
    }
    const revealing = this.reveal.active;
    const focus = this.reveal.focus;
    const inFullLog = this.ui.kind === "fullLog";
    for (const box of this.chrome) box.visible = !inFullLog;
    this.fullLogBox.visible = inFullLog;
    if (inFullLog) {
      // Rebuilt only when it changed: a running reveal renders every tick, mostly without a new line.
      if (this.fullLogBuiltFrom !== this.runLogVersion) {
        this.fullLogBuiltFrom = this.runLogVersion;
        this.fullLogText.content = this.runLog.length === 0 ? t("ui.fullLogEmpty") : joinLines(logLines(this.runLog));
      }
      if (this.fullLogJustOpened) {
        this.fullLogJustOpened = false;
        this.fullLogScroll.scrollTop = this.fullLogScroll.scrollHeight;
      }
      this.footer.content = joinLines([highlightKeyHints(composeFooter(t("ui.footerBackOnly"), this.ui.kind, false))]);
      return;
    }
    const hpOverride = revealing && this.displaySnapshot ? new Map(this.displaySnapshot.map((snap) => [snap.id, snap])) : null;
    const partyOverride = revealing ? this.displayPartySnapshot : null;

    const coins = partyOverride?.coins ?? s.coins;
    const partyExp = partyOverride?.partyExp ?? s.partyExp;
    const satiety = partyOverride?.satiety ?? s.satiety;
    const p0 = s.party[0];
    const level = (p0 && hpOverride?.get(p0.id)?.level) ?? p0?.level ?? 1;

    const expLine: TextChunk[] =
      level >= MAX_LEVEL
        ? [...progressBar(1, 1, EXP_BAR_WIDTH, PALETTE.title), plainChunk(" "), colorChunk(t("ui.expMaxStat"), PALETTE.title)]
        : [
            ...progressBar(partyExp - expCostForLevel(level), expCostForLevel(level + 1) - expCostForLevel(level), EXP_BAR_WIDTH, PALETTE.title),
            plainChunk(" "),
            colorChunk(t("ui.expStat", { cur: partyExp - expCostForLevel(level), need: expCostForLevel(level + 1) - expCostForLevel(level) }), PALETTE.title),
          ];
    this.header.content = joinLines([
      [
        boldColorChunk(room.name, PALETTE.title),
        plainChunk(t("ui.headerFloor", { depth: s.floor.depth })),
        colorChunk(s.combat ? t("ui.roundHeader", { round: s.combat.roundNumber }) : t("ui.exploring"), PALETTE.dim),
        plainChunk("  "),
        colorChunk(t("ui.coinsStat", { coins }), PALETTE.title),
        plainChunk("  "),
        colorChunk(t("ui.satietyStat", { satiety }), PALETTE.title),
        ...(s.runStardust > 0 ? [plainChunk("  "), colorChunk(t("ui.stardustStat", { stardust: s.runStardust }), PALETTE.title)] : []),
      ],
      expLine,
    ]);

    const progressChunks: TextChunk[] = [];
    s.roomPath.forEach((roomId, i) => {
      if (i > 0) progressChunks.push(plainChunk("-"));
      const isCurrent = i === s.roomPath.length - 1;
      const icon = isCurrent ? CURRENT_ROOM_ICON : ROOM_TYPE_ICON[getRoom(s.floor, roomId).type];
      const color = isCurrent ? PALETTE.title : PALETTE.dim;
      progressChunks.push(plainChunk("["), colorChunk(icon, color), plainChunk("]"));
    });
    this.progress.content = joinLines([progressChunks]);

    this.battlefield.content = joinLines(this.renderBattlefield(hpOverride, focus));

    const partyLines: TextChunk[][] = [];
    s.party.forEach((c, i) => {
      if (i > 0) partyLines.push([]);
      const view = hpOverride?.get(c.id);
      partyLines.push(
        ...this.renderCharacterLines(
          view
            ? { ...c, hp: view.hp, isAlive: view.isAlive, level: view.level ?? c.level, mp: view.mp ?? c.mp, activeStatusEffects: view.activeStatusEffects ?? c.activeStatusEffects }
            : c,
          satiety
        )
      );
    });
    this.party.content = joinLines(partyLines);
    this.monsters.content = joinLines(this.renderMonsterLines(hpOverride));
    if (revealing) {
      this.main.content = t("ui.revealingCombat");
      // The reveal swallows every key except the globals handled before it, and `[b]` is not one
      // of them — so the party hint is suppressed rather than advertised as a dead key.
      this.footer.content = joinLines([highlightKeyHints(composeFooter(t("ui.footerSkipReveal"), this.ui.kind, false, false))]);
    } else {
      this.main.content = this.renderMain();
      this.footer.content = joinLines([highlightKeyHints(composeFooter(this.renderFooter(), this.ui.kind, this.isPaginated()))]);
    }
    this.renderLogContent();
    this.lastRender = { revealing, focusId: focus?.id ?? null, logTailSessionId: this.roomLog.at(-1)?.session?.id ?? null };
  }

  /** The room log belongs to one room: the first thing written (or rendered) after the player changes room starts it afresh. */
  private syncRoomLog(): void {
    const s = this.game.state;
    if (s.floor !== this.roomLogFloor || s.currentRoomId !== this.roomLogRoomId) {
      this.roomLogFloor = s.floor;
      this.roomLogRoomId = s.currentRoomId;
      this.roomLog = [];
    }
  }

  private appendLog(entries: LogEntry[]): void {
    this.syncRoomLog();
    this.roomLog.push(...entries);
    this.runLog.push(...entries);
    this.runLogVersion++;
    if (this.roomLog.length > ROOM_LOG_SIZE) this.roomLog.splice(0, this.roomLog.length - ROOM_LOG_SIZE);
    if (this.runLog.length > RUN_LOG_SIZE) this.runLog.splice(0, this.runLog.length - RUN_LOG_SIZE);
  }

  private renderLogContent(): void {
    if (this.roomLog.length === 0) {
      this.log.content = this.game.state.message;
      return;
    }
    this.log.content = joinLines(logLines(this.roomLog));
  }

  /** Makes lines visible: they enter the logs and the HP/MP/coin snapshots they carry become the displayed state. */
  private applyRevealed(entries: LogEntry[]): void {
    if (entries.length > 0) this.appendLog(entries);
    const focus = this.reveal.focus;
    if (focus !== this.deltasFor) {
      this.deltasFor = focus;
      this.focusDeltas = focus ? hpDeltas(this.displaySnapshot, this.reveal.focusSnapshot) : new Map();
    }
    // A session's HP/status change waits for its impact; lines with no session apply theirs at once.
    if (this.reveal.holding) return;
    if (focus) {
      this.displaySnapshot = this.reveal.focusSnapshot ?? this.displaySnapshot;
      return;
    }
    for (const entry of entries) {
      if (entry.snapshot) this.displaySnapshot = entry.snapshot;
      if (entry.partySnapshot) this.displayPartySnapshot = entry.partySnapshot;
    }
  }

  /** Called only when lines were queued on an idle queue: shows the first line immediately, then lets the timer carry on. */
  private startReveal(): void {
    this.applyRevealed(this.reveal.tick());
    this.scheduleRevealTick();
  }

  private scheduleRevealTick(): void {
    if (!this.autoReveal || this.revealTimer !== null || !this.reveal.active) return;
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      this.tickReveal();
    }, REVEAL_TICK_MS);
  }

  /** One reveal step: the log line, the HP/MP snapshot and the battlefield highlight all move together, in this single render. */
  tickReveal(): void {
    this.applyRevealed(this.reveal.tick());
    this.scheduleRevealTick();
    this.render();
  }

  private flushPendingReveal(): void {
    if (!this.reveal.active) return;
    if (this.revealTimer !== null) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    this.applyRevealed(this.reveal.flush());
    this.render();
  }

  private renderCharacterLines(c: Character, satiety: number): TextChunk[][] {
    const style = CLASS_STYLE[c.classId] ?? { abbr: "??", color: PALETTE.dim };
    if (!c.isAlive) {
      return [[chip(style.abbr, PALETTE.dead), plainChunk(t("ui.fallenSuffix", { name: c.name }))]];
    }

    const line1: TextChunk[] = [chip(style.abbr, style.color), plainChunk(` ${c.name} `), colorChunk(t("ui.levelTag", { level: c.level }), PALETTE.title)];
    if (isPartyDying(satiety)) line1.push(colorChunk(t("ui.dyingTag"), PALETTE.hpLow));
    else if (isPartyExhausted(satiety)) line1.push(colorChunk(t("ui.exhaustedTag"), PALETTE.hpLow));
    const tier = getFearTier(c.survival.fear);
    const hpLine: TextChunk[] = [
      plainChunk("  "),
      colorChunk(t("ui.hpLabel"), hpColorFor(c.hp, c.maxHp)),
      plainChunk(" "),
      ...progressBar(c.hp, c.maxHp, STAT_BAR_WIDTH, hpColorFor(c.hp, c.maxHp)),
      plainChunk(" "),
      colorChunk(t("ui.statValueSuffix", { cur: c.hp, max: c.maxHp }), hpColorFor(c.hp, c.maxHp)),
    ];
    const mpLine: TextChunk[] = [
      plainChunk("  "),
      colorChunk(t("ui.mpLabel"), PALETTE.mp),
      plainChunk(" "),
      ...progressBar(c.mp, c.maxMp, STAT_BAR_WIDTH, PALETTE.mp),
      plainChunk(" "),
      colorChunk(t("ui.statValueSuffix", { cur: c.mp, max: c.maxMp }), PALETTE.mp),
    ];
    const fearLine: TextChunk[] = [plainChunk("  "), colorChunk(t("ui.fearStat", { fear: c.survival.fear }), fearColorFor(tier))];
    if (tier >= 2) {
      fearLine.push(plainChunk(" "), colorChunk(`(${FEAR_TIER_LABEL[tier]})`, fearColorFor(tier)));
    }

    // Ability, then artifacts, then buffs, then debuffs — each on its own line, buffs/debuffs tagged with turns left.
    const abilityLines: TextChunk[][] = c.equippedAbilityId ? [[plainChunk("  "), colorChunk(`${ABILITY_ICON} ${getAbility(c.equippedAbilityId).name}`, PALETTE.title)]] : [];
    const artifactLines: TextChunk[][] = c.equippedArtifactIds.map((artifactId) => [plainChunk("  "), colorChunk(`${ARTIFACT_ICON} ${getArtifact(artifactId).name}`, PALETTE.title)]);
    const buffLines: TextChunk[][] = [];
    const debuffLines: TextChunk[][] = [];
    for (const eff of c.activeStatusEffects) {
      const def = getStatusEffect(eff.statusEffectId);
      const target = isHelpfulStatusEffect(def) ? buffLines : debuffLines;
      const color = isHelpfulStatusEffect(def) ? PALETTE.mp : PALETTE.fearPanic;
      target.push([
        plainChunk("  "),
        colorChunk(statusDisplayName(def), color),
        colorChunk(t("ui.statusTurnsSuffix", { turns: eff.turnsRemaining }), color),
        ...(eff.stacks && eff.stacks > 1 ? [colorChunk(t("ui.statusStacksSuffix", { stacks: eff.stacks }), color)] : []),
      ]);
    }
    const noteLines = [...abilityLines, ...artifactLines, ...buffLines, ...debuffLines];

    const summonLines: TextChunk[][] = this.game.ctx.summons
      .filter((s) => s.ownerId === c.id && s.hp > 0)
      .map((s) => [
        plainChunk("  "),
        colorChunk(`${SUMMON_ICON} ${s.name}:`, PALETTE.title),
        plainChunk(" "),
        colorChunk(t("ui.statValueSuffix", { cur: s.hp, max: s.maxHp }), hpColorFor(s.hp, s.maxHp)),
      ]);

    return [line1, hpLine, mpLine, fearLine, ...noteLines, ...summonLines];
  }

  private buildUnitMeta(label: string, labelColor: string, statusText: string, statusColor: string): TextChunk[][] {
    return [
      [plainChunk(" ".repeat(SLOT_WIDTH))],
      [colorChunk(centerText(label, SLOT_WIDTH), labelColor)],
      [colorChunk(centerText(statusText, SLOT_WIDTH), statusColor)],
    ];
  }

  private buildSideBlock(units: BattlefieldUnit[]): TextChunk[][] {
    const spritePart = buildSideSpriteArea(units, SLOT_WIDTH, SLOT_GAP);
    const metaPart = mergeBlocksHorizontally(
      units.map((u) => this.buildUnitMeta(u.label, u.labelColor, u.statusText, u.statusColor)),
      SLOT_GAP
    );
    return [...spritePart, ...metaPart];
  }

  private buildEmptyEnemyBlock(message: string): TextChunk[][] {
    const blank = () => [plainChunk(" ".repeat(EMPTY_ENEMY_WIDTH))];
    const lines: TextChunk[][] = [];
    for (let i = 0; i < MAX_BOSS_HEIGHT; i++) lines.push(blank());
    lines.push(blank());
    lines.push(message ? [colorChunk(centerText(message, EMPTY_ENEMY_WIDTH), PALETTE.dim)] : blank());
    lines.push(blank());
    return [...blankIconBand(EMPTY_ENEMY_WIDTH), ...lines];
  }

  private buildCampfireBlock(): TextChunk[][] {
    const lines = renderSpriteInSlot(CAMPFIRE_SPRITE, MAX_BOSS_HEIGHT, EMPTY_ENEMY_WIDTH);
    lines.push([plainChunk(" ".repeat(EMPTY_ENEMY_WIDTH))]);
    lines.push([colorChunk(centerText(t("ui.campfireWarm"), EMPTY_ENEMY_WIDTH), PALETTE.dim)]);
    lines.push([plainChunk(" ".repeat(EMPTY_ENEMY_WIDTH))]);
    return [...blankIconBand(EMPTY_ENEMY_WIDTH), ...lines];
  }

  private buildTreasureBlock(): TextChunk[][] {
    const lines = renderSpriteInSlot(TREASURE_CHEST_SPRITE, MAX_BOSS_HEIGHT, EMPTY_ENEMY_WIDTH);
    lines.push([plainChunk(" ".repeat(EMPTY_ENEMY_WIDTH))]);
    lines.push([colorChunk(centerText(t("ui.treasureChestLabel"), EMPTY_ENEMY_WIDTH), PALETTE.dim)]);
    lines.push([plainChunk(" ".repeat(EMPTY_ENEMY_WIDTH))]);
    return [...blankIconBand(EMPTY_ENEMY_WIDTH), ...lines];
  }

  private buildEventBlock(eventId: Id): TextChunk[][] {
    const sprite = spriteForEvent(eventId);
    const label = getEvent(eventId).name;
    const blank = () => [plainChunk(" ".repeat(EMPTY_ENEMY_WIDTH))];
    const lines: TextChunk[][] = sprite ? renderSpriteInSlot(sprite, MAX_BOSS_HEIGHT, EMPTY_ENEMY_WIDTH) : Array.from({ length: MAX_BOSS_HEIGHT }, blank);
    lines.push(blank());
    lines.push([colorChunk(centerText(label, EMPTY_ENEMY_WIDTH), PALETTE.dim)]);
    lines.push(blank());
    return [...blankIconBand(EMPTY_ENEMY_WIDTH), ...lines];
  }

  private renderBattlefield(hpOverride: Map<Id, CombatantSnapshot> | null = null, focus: LogSession | null = null): TextChunk[][] {
    const s = this.game.state;
    const impact = focus !== null && !this.reveal.holding;

    const partyUnits = s.party.map((c) => {
      const view = hpOverride?.get(c.id);
      const hp = view?.hp ?? c.hp;
      const maxHp = c.maxHp;
      const isAlive = view?.isAlive ?? c.isAlive;
      const style = CLASS_STYLE[c.classId] ?? { abbr: "??", color: PALETTE.dim };
      const lens = unitFocus(c.id, "party", focus, this.focusDeltas.get(c.id), impact);
      const frameHeight = tierFrameHeight("party");
      if (!isAlive) return focusedUnit({ sprite: TOMBSTONE_SPRITE, label: style.abbr, labelColor: PALETTE.dead, statusText: t("ui.fallen"), statusColor: PALETTE.dead, frameHeight }, lens);
      return focusedUnit({ sprite: spriteForClass(c.classId), label: style.abbr, labelColor: style.color, statusText: `${hp}/${maxHp}`, statusColor: hpColorFor(hp, maxHp), frameHeight }, lens);
    });
    const partyBlock = this.buildSideBlock(partyUnits);

    const room = getRoom(s.floor, s.currentRoomId);
    const isRestRoom = !s.combat && room.type === "rest";
    const isEventRoom = !s.combat && room.type === "event" && !!room.rolledEventId && !room.cleared;
    const isTreasureRoom = isEventRoom && getEvent(room.rolledEventId!).kind === "instantReward";

    let enemyBlock: TextChunk[][];
    if (s.combat) {
      const monsterCombatants = s.combat.combatants.filter((c) => c.ref.kind === "monster");
      if (monsterCombatants.length === 0) {
        enemyBlock = this.buildEmptyEnemyBlock(t("ui.cleared"));
      } else {
        const enemyUnits = monsterCombatants.map((combatant) => {
          const m = getActorByRef(combatant.ref, this.game.ctx) as Monster;
          const view = hpOverride?.get(m.id);
          const hp = view?.hp ?? m.hp;
          const style = monsterStyle(m);
          const lens = unitFocus(m.id, "monster", focus, this.focusDeltas.get(m.id), impact);
          const frameHeight = tierFrameHeight(m.tier);
          if (hp <= 0) return focusedUnit({ sprite: TOMBSTONE_SPRITE, label: style.abbr, labelColor: PALETTE.dead, statusText: t("ui.defeated"), statusColor: PALETTE.dead, frameHeight }, lens);
          return focusedUnit({ sprite: spriteForMonster(m.archetypeId, m.tier), label: style.abbr, labelColor: style.color, statusText: `${hp}/${m.maxHp}`, statusColor: hpColorFor(hp, m.maxHp), frameHeight }, lens);
        });
        enemyBlock = this.buildSideBlock(enemyUnits);
      }
    } else if (isRestRoom) {
      enemyBlock = this.buildCampfireBlock();
    } else if (isTreasureRoom) {
      enemyBlock = this.buildTreasureBlock();
    } else if (isEventRoom) {
      enemyBlock = this.buildEventBlock(room.rolledEventId!);
    } else {
      const message = room.type !== "combat" && room.type !== "boss" ? "" : room.cleared ? t("ui.safe") : t("ui.notEncountered");
      enemyBlock = this.buildEmptyEnemyBlock(message);
    }

    const divider: TextChunk[][] = [];
    for (let i = 0; i < UNIT_BLOCK_HEIGHT; i++) {
      divider.push(
        i === ICON_BAND_ROWS + Math.floor((UNIT_BLOCK_HEIGHT - ICON_BAND_ROWS) / 2) && !isRestRoom && !isEventRoom && !isTreasureRoom
          ? [colorChunk(centerText(t("ui.versusDivider"), DIVIDER_WIDTH), PALETTE.dim)]
          : [plainChunk(" ".repeat(DIVIDER_WIDTH))]
      );
    }

    return mergeBlocksHorizontally([partyBlock, divider, enemyBlock], SLOT_GAP);
  }

  private renderMonsterLines(hpOverride: Map<Id, CombatantSnapshot> | null = null): TextChunk[][] {
    const s = this.game.state;
    if (!s.combat) {
      const room = getRoom(s.floor, s.currentRoomId);
      if (room.type !== "combat" && room.type !== "boss") {
        return [[colorChunk(t("ui.noMonsters"), PALETTE.dim)]];
      }
      return [[colorChunk(room.cleared ? t("ui.roomSafe") : t("ui.notEncounteredDot"), PALETTE.dim)]];
    }
    const lines: TextChunk[][] = [];
    for (const combatant of s.combat.combatants) {
      if (combatant.ref.kind !== "monster") continue;
      const m = getActorByRef(combatant.ref, this.game.ctx) as Monster;
      const hp = hpOverride?.get(m.id)?.hp ?? m.hp;
      const style = monsterStyle(m);
      if (hp <= 0) {
        lines.push([chip(style.abbr, PALETTE.dead), plainChunk(t("ui.monsterDefeatedSuffix", { name: m.name }))]);
        continue;
      }
      lines.push([chip(style.abbr, style.color), plainChunk(` ${m.name}`)]);
      lines.push([
        plainChunk("  "),
        colorChunk(t("ui.hpLabel"), hpColorFor(hp, m.maxHp)),
        plainChunk(" "),
        ...progressBar(hp, m.maxHp, STAT_BAR_WIDTH, hpColorFor(hp, m.maxHp)),
        plainChunk(" "),
        colorChunk(t("ui.statValueSuffix", { cur: hp, max: m.maxHp }), hpColorFor(hp, m.maxHp)),
      ]);
      const activeStatusEffects = hpOverride?.get(m.id)?.activeStatusEffects ?? m.activeStatusEffects;
      for (const eff of activeStatusEffects) {
        const def = getStatusEffect(eff.statusEffectId);
        const color = isHelpfulStatusEffect(def) ? PALETTE.mp : PALETTE.fearPanic;
        lines.push([
          plainChunk("  "),
          colorChunk(statusDisplayName(def), color),
          colorChunk(t("ui.statusTurnsSuffix", { turns: eff.turnsRemaining }), color),
          ...(eff.stacks && eff.stacks > 1 ? [colorChunk(t("ui.statusStacksSuffix", { stacks: eff.stacks }), color)] : []),
        ]);
      }
    }
    return lines.length > 0 ? lines : [[colorChunk(t("ui.noMoreMonsters"), PALETTE.dim)]];
  }

  private renderMain(): string | StyledText {
    switch (this.ui.kind) {
      case "fullLog":
        return "";
      case "gameover":
        return gameoverScreen.renderMain(this.game);

      case "abilityBuyback":
        return abilityBuybackScreen.renderMain(this.game);

      case "room":
      case "rest":
        return roomScreen.renderMain(this.game, this.ui);

      case "runnerNotice":
      case "runnerShop":
      case "runnerSell":
      case "runnerBarter":
        return runnerScreen.renderMain(this.game, this.ui, this.listPage);

      case "artifactMenu":
      case "artifactDetail":
        return artifactsScreen.renderMain(this.game, this.ui, this.listPage);

      case "artifactDecision":
      case "artifactDecisionPickCharacter":
      case "artifactDecisionPickReplace":
        return artifactDecisionScreen.renderMain(this.game, this.ui);

      case "pickItemOutOfCombat":
      case "itemDetail":
        return inventoryScreen.renderMain(this.game, this.ui, this.listPage);

      case "saveMenu":
        return saveScreen.renderMain();

      case "roomReward":
        return rewardsScreen.renderMain(this.game, this.ui, this.listPage);

      case "campPrompt":
        return campScreen.renderMain(this.game, this.ui);

      case "combatOver":
      case "roundResolved":
      case "pickAction":
      case "pickSkill":
      case "skillDetail":
      case "pickItemInCombat":
      case "pickTarget":
        return combatScreen.renderMain(this.game, this.ui, this.listPage);

      case "eventOpenChest":
      case "eventMerchant":
      case "eventCursedShrine":
      case "eventTwinAltars":
      case "eventHpGamble":
      case "eventHpGamblePickPayer":
      case "eventArtifactPick":
      case "eventGamblingDen":
      case "eventHermit":
      case "eventHermitPickArtifact":
      case "eventGuardianFight":
      case "eventReflection":
        return eventsScreen.renderMain(this.game, this.ui, this.listPage);

      case "campReflection":
        return campReflectionScreen.renderMain(this.game, this.ui);

      case "floorMilestone":
        return floorMilestoneScreen.renderMain(this.game, this.ui);

      case "characterInfo":
        return characterInfoScreen.renderMain(this.game, this.ui);

      case "endingCheckpoint":
        return endingScreen.renderMain(this.game, this.ui);

      case "founderDialogue":
        return founderDialogueScreen.renderMain(this.game, this.ui);

      default: {
        const _exhaustive: never = this.ui;
        return _exhaustive;
      }
    }
  }

  /** Paging is driven centrally by `listCountFor`, so the `[←/→]` hint is derived from the same source rather than written into each screen's footer string. */
  private isPaginated(): boolean {
    const count = this.listCountFor(this.ui);
    return count !== null && pageCount(count, pageSizeFor(this.ui.kind)) > 1;
  }

  private renderFooter(): string {
    switch (this.ui.kind) {
      case "room":
      case "rest":
        return roomScreen.renderFooter(this.ui, this.game);
      case "runnerNotice":
      case "runnerShop":
      case "runnerSell":
      case "runnerBarter":
        return runnerScreen.renderFooter(this.ui, this.game, this.listPage);
      case "pickAction":
      case "pickSkill":
      case "skillDetail":
      case "pickItemInCombat":
      case "pickTarget":
      case "roundResolved":
      case "combatOver":
        return combatScreen.renderFooter(this.ui, this.game, this.listPage);
      case "pickItemOutOfCombat":
      case "itemDetail":
        return inventoryScreen.renderFooter(this.ui, this.game, this.listPage);
      case "artifactMenu":
      case "artifactDetail":
        return artifactsScreen.renderFooter(this.ui, this.game, this.listPage);
      case "artifactDecision":
      case "artifactDecisionPickCharacter":
      case "artifactDecisionPickReplace":
        return artifactDecisionScreen.renderFooter(this.ui, this.game);
      case "saveMenu":
        return saveScreen.renderFooter();
      case "roomReward":
        return rewardsScreen.renderFooter(this.ui, this.listPage);
      case "campPrompt":
        return campScreen.renderFooter(this.ui);
      case "eventOpenChest":
      case "eventMerchant":
      case "eventCursedShrine":
      case "eventTwinAltars":
      case "eventHpGamble":
      case "eventHpGamblePickPayer":
      case "eventArtifactPick":
      case "eventGamblingDen":
      case "eventHermit":
      case "eventHermitPickArtifact":
      case "eventGuardianFight":
      case "eventReflection":
        return eventsScreen.renderFooter(this.ui, this.game, this.listPage);
      case "campReflection":
        return campReflectionScreen.renderFooter(this.ui);
      case "floorMilestone":
        return floorMilestoneScreen.renderFooter(this.ui);
      case "characterInfo":
        return characterInfoScreen.renderFooter(this.ui, this.game);
      case "endingCheckpoint":
        return endingScreen.renderFooter(this.ui, this.game);
      case "founderDialogue":
        return founderDialogueScreen.renderFooter(this.ui);
      case "abilityBuyback":
        return abilityBuybackScreen.renderFooter();
      case "gameover":
        return gameoverScreen.renderFooter();
      case "fullLog":
        return t("ui.footerBackOnly");
    }
  }
}
