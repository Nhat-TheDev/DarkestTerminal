import { BoxRenderable, ScrollBoxRenderable, TextRenderable, StyledText, type CliRenderer, type KeyEvent, type TextChunk } from "@opentui/core";
import type { Character, Monster, Id, LogEntry, CombatantSnapshot } from "../types";
import { Game } from "../engine/game";
import { getActorByRef } from "../engine/combat";
import { getArtifact } from "../data/artifacts";
import { getRoom } from "../engine/dungeon";
import { getFearTier, isHelpfulStatusEffect } from "../engine/resolver";
import { getStatusEffect, statusDisplayName } from "../data/statusEffects";
import { isPartyExhausted, isPartyDying } from "../engine/survival";
import { t } from "../data/strings";
import { quickSave, deleteSavesForRun } from "../engine/save";
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
  LOG_KIND_STYLE,
} from "./theme";
import {
  spriteForClass,
  spriteForMonster,
  renderSpriteInSlot,
  compositeSpriteRow,
  MAX_BOSS_HEIGHT,
  TOMBSTONE_SPRITE,
  CAMPFIRE_SPRITE,
  type Sprite,
} from "./sprites";
import { SLOT_WIDTH, SLOT_GAP, DIVIDER_WIDTH, EMPTY_ENEMY_WIDTH, UNIT_BLOCK_HEIGHT, centerText, monsterStyle, mergeBlocksHorizontally } from "./layout";
import { type UiState, inventoryEntries, ownedArtifactEntries, eventUiState } from "./state";
import { PAGE_SIZE, pageCount, clampPage } from "./pagination";
import type { ScreenContext } from "./screens/context";
import * as eventsScreen from "./screens/events";
import * as roomScreen from "./screens/room";
import * as combatScreen from "./screens/combat";
import * as inventoryScreen from "./screens/inventory";
import * as artifactsScreen from "./screens/artifacts";
import * as artifactDecisionScreen from "./screens/artifactDecision";
import * as rewardsScreen from "./screens/rewards";
import * as campScreen from "./screens/camp";
import * as saveScreen from "./screens/save";
import * as gameoverScreen from "./screens/gameover";

const LOG_HISTORY_SIZE = 20;
const LOG_REVEAL_INTERVAL_MS = 500;

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
  private lastLogLength = 0;
  private observedCombatLog: LogEntry[] | null = null;
  private logHistory: LogEntry[] = [];
  private pendingReveal: LogEntry[] = [];
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private displaySnapshot: CombatantSnapshot[] | null = null;
  private pendingFloorAdvance = false;
  private pendingCampOffer = false;
  private listPage = 0;

  constructor(private renderer: CliRenderer, game?: Game) {
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
      height: 3,
      title: "DARKEST-TERMINAL",
    });
    headerBox.add(this.header);
    this.root.add(headerBox);

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
      case "roomReward":
        return ui.viewing ? null : ui.entries.length;
      default:
        return null;
    }
  }

  logInfo(text: string): void {
    this.logHistory.push({ text, kind: "info" });
  }

  syncUiToGameState(): void {
    if (this.game.state.gameOver) {
      if (this.ui.kind !== "gameover" && this.game.state.gameOver === "defeat") {
        deleteSavesForRun(this.game.state.runId);
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
      const room = getRoom(this.game.state.floor, this.game.state.currentRoomId);
      if (room.type === "rest" && !room.cleared) {
        this.ui = { kind: "rest" };
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
      .livingAllyRefs()
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
    if (this.ui.kind !== "gameover" && this.ui.kind !== "saveMenu" && key.name === "q") {
      this.ui = { kind: "saveMenu", previous: this.ui };
      this.render();
      return;
    }
    if (this.ui.kind !== "gameover" && key.name === "s") {
      quickSave(this.game);
      this.pushToast(t("ui.quickSavedMsg"));
      this.render();
      return;
    }
    if (this.pendingReveal.length > 0) {
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
      case "pickAction":
      case "pickSkill":
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
        eventsScreen.handleKey(this, this.ui, key, digit);
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
      case "pickTarget":
        this.ui = this.ui.source.kind === "skill" ? { kind: "pickSkill", actorRef: this.ui.actorRef } : { kind: "pickItemInCombat", actorRef: this.ui.actorRef };
        return true;
      case "pickItemOutOfCombat":
        this.ui = { kind: "room" };
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
    else this.logHistory.push({ text: reason, kind: "info" });
  }

  pushToast(text: string): void {
    if (this.game.state.combat) this.game.state.combat.log.push({ text, kind: "info" });
    else this.logHistory.push({ text, kind: "info" });
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
    this.header.content = joinLines([
      [
        boldColorChunk(room.name, PALETTE.title),
        plainChunk(t("ui.headerFloor", { depth: s.floor.depth })),
        colorChunk(s.combat ? t("ui.roundHeader", { round: s.combat.roundNumber }) : t("ui.exploring"), PALETTE.dim),
        plainChunk("  "),
        colorChunk(t("ui.coinsStat", { coins: s.coins }), PALETTE.title),
        plainChunk("  "),
        colorChunk(t("ui.satietyStat", { satiety: s.satiety }), PALETTE.title),
      ],
    ]);

    const combatLog = s.combat?.log ?? null;
    if (combatLog !== this.observedCombatLog) {
      this.observedCombatLog = combatLog;
      this.lastLogLength = 0;
      this.displaySnapshot = null;
    }
    if (combatLog && combatLog.length > this.lastLogLength) {
      this.displaySnapshot = s.combat!.roundStartSnapshot ?? null;
      this.pendingReveal.push(...combatLog.slice(this.lastLogLength));
      this.lastLogLength = combatLog.length;
      this.scheduleReveal();
    }

    const hpOverride = this.pendingReveal.length > 0 && this.displaySnapshot ? new Map(this.displaySnapshot.map((snap) => [snap.id, snap])) : null;

    this.battlefield.content = joinLines(this.renderBattlefield(hpOverride));

    const partyLines: TextChunk[][] = [];
    s.party.forEach((c, i) => {
      if (i > 0) partyLines.push([]);
      const view = hpOverride?.get(c.id);
      partyLines.push(...this.renderCharacterLines(view ? { ...c, hp: view.hp, isAlive: view.isAlive, level: view.level ?? c.level, mp: view.mp ?? c.mp } : c, s.satiety));
    });
    this.party.content = joinLines(partyLines);
    this.monsters.content = joinLines(this.renderMonsterLines(hpOverride));
    if (this.pendingReveal.length > 0) {
      this.main.content = t("ui.revealingCombat");
      this.footer.content = t("ui.footerSkipReveal");
    } else {
      this.main.content = this.renderMain();
      this.footer.content = this.renderFooter();
    }
    this.renderLogContent();
  }

  private renderLogContent(): void {
    const displayLog = this.logHistory.slice(-LOG_HISTORY_SIZE);
    if (displayLog.length === 0) {
      this.log.content = this.game.state.message;
      return;
    }
    this.log.content = joinLines(
      displayLog.map((entry) => {
        const style = LOG_KIND_STYLE[entry.kind];
        return [colorChunk(`${style.icon} `, style.color), colorChunk(entry.text, style.color)];
      })
    );
  }

  private scheduleReveal(): void {
    if (this.revealTimer !== null) return;
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      const next = this.pendingReveal.shift();
      if (next) {
        this.logHistory.push(next);
        if (next.snapshot) this.displaySnapshot = next.snapshot;
      }
      if (this.pendingReveal.length > 0) this.scheduleReveal();
      this.render();
    }, LOG_REVEAL_INTERVAL_MS);
  }

  private flushPendingReveal(): void {
    if (this.pendingReveal.length === 0) return;
    if (this.revealTimer !== null) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    const last = this.pendingReveal[this.pendingReveal.length - 1];
    this.logHistory.push(...this.pendingReveal);
    if (last?.snapshot) this.displaySnapshot = last.snapshot;
    this.pendingReveal = [];
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
    const line2: TextChunk[] = [
      plainChunk("  "),
      colorChunk(t("ui.hpStat", { hp: c.hp, maxHp: c.maxHp }), hpColorFor(c.hp, c.maxHp)),
      plainChunk(" "),
      colorChunk(t("ui.mpStat", { mp: c.mp, maxMp: c.maxMp }), PALETTE.mp),
      plainChunk(" "),
      colorChunk(t("ui.fearStat", { fear: c.survival.fear }), fearColorFor(tier)),
    ];
    if (tier >= 2) {
      line2.push(plainChunk(" "), colorChunk(`(${FEAR_TIER_LABEL[tier]})`, fearColorFor(tier)));
    }

    // Artifacts, then buffs, then debuffs — each on its own line, buffs/debuffs tagged with turns left.
    const artifactLines: TextChunk[][] = c.equippedArtifactIds.map((artifactId) => [plainChunk("  "), colorChunk(getArtifact(artifactId).name, PALETTE.title)]);
    const buffLines: TextChunk[][] = [];
    const debuffLines: TextChunk[][] = [];
    for (const eff of c.activeStatusEffects) {
      const def = getStatusEffect(eff.statusEffectId);
      const target = isHelpfulStatusEffect(def) ? buffLines : debuffLines;
      const color = isHelpfulStatusEffect(def) ? PALETTE.mp : PALETTE.fearPanic;
      target.push([plainChunk("  "), colorChunk(statusDisplayName(def), color), colorChunk(t("ui.statusTurnsSuffix", { turns: eff.turnsRemaining }), color)]);
    }
    const noteLines = [...artifactLines, ...buffLines, ...debuffLines];

    if (noteLines.length === 0) return [line1, line2];
    return [line1, line2, ...noteLines];
  }

  private buildUnitMeta(label: string, labelColor: string, statusText: string, statusColor: string): TextChunk[][] {
    return [
      [plainChunk(" ".repeat(SLOT_WIDTH))],
      [colorChunk(centerText(label, SLOT_WIDTH), labelColor)],
      [colorChunk(centerText(statusText, SLOT_WIDTH), statusColor)],
    ];
  }

  private buildSideBlock(units: { sprite: Sprite; label: string; labelColor: string; statusText: string; statusColor: string }[]): TextChunk[][] {
    const spritePart = compositeSpriteRow(
      units.map((u) => u.sprite),
      SLOT_WIDTH,
      MAX_BOSS_HEIGHT,
      SLOT_GAP
    );
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
    return lines;
  }

  private buildCampfireBlock(): TextChunk[][] {
    const lines = renderSpriteInSlot(CAMPFIRE_SPRITE, MAX_BOSS_HEIGHT, EMPTY_ENEMY_WIDTH);
    lines.push([plainChunk(" ".repeat(EMPTY_ENEMY_WIDTH))]);
    lines.push([colorChunk(centerText(t("ui.campfireWarm"), EMPTY_ENEMY_WIDTH), PALETTE.dim)]);
    lines.push([plainChunk(" ".repeat(EMPTY_ENEMY_WIDTH))]);
    return lines;
  }

  private renderBattlefield(hpOverride: Map<Id, CombatantSnapshot> | null = null): TextChunk[][] {
    const s = this.game.state;

    const partyUnits = s.party.map((c) => {
      const view = hpOverride?.get(c.id);
      const hp = view?.hp ?? c.hp;
      const maxHp = c.maxHp;
      const isAlive = view?.isAlive ?? c.isAlive;
      const style = CLASS_STYLE[c.classId] ?? { abbr: "??", color: PALETTE.dim };
      if (!isAlive) return { sprite: TOMBSTONE_SPRITE, label: style.abbr, labelColor: PALETTE.dead, statusText: t("ui.fallen"), statusColor: PALETTE.dead };
      const sprite = spriteForClass(c.classId);
      return { sprite, label: style.abbr, labelColor: style.color, statusText: `${hp}/${maxHp}`, statusColor: hpColorFor(hp, maxHp) };
    });
    const partyBlock = this.buildSideBlock(partyUnits);

    const room = getRoom(s.floor, s.currentRoomId);
    const isRestRoom = !s.combat && room.type === "rest";

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
          if (hp <= 0) return { sprite: TOMBSTONE_SPRITE, label: style.abbr, labelColor: PALETTE.dead, statusText: t("ui.defeated"), statusColor: PALETTE.dead };
          const sprite = spriteForMonster(m.archetypeId, m.tier);
          return { sprite, label: style.abbr, labelColor: style.color, statusText: `${hp}/${m.maxHp}`, statusColor: hpColorFor(hp, m.maxHp) };
        });
        enemyBlock = this.buildSideBlock(enemyUnits);
      }
    } else if (isRestRoom) {
      enemyBlock = this.buildCampfireBlock();
    } else {
      const message = room.type !== "combat" && room.type !== "boss" ? "" : room.cleared ? t("ui.safe") : t("ui.notEncountered");
      enemyBlock = this.buildEmptyEnemyBlock(message);
    }

    const divider: TextChunk[][] = [];
    for (let i = 0; i < UNIT_BLOCK_HEIGHT; i++) {
      divider.push(
        i === Math.floor(UNIT_BLOCK_HEIGHT / 2) && !isRestRoom
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
      lines.push([
        chip(style.abbr, style.color),
        plainChunk(` ${m.name}`),
        plainChunk("\n   "),
        colorChunk(t("ui.hpStat", { hp, maxHp: m.maxHp }), hpColorFor(hp, m.maxHp)),
      ]);
    }
    return lines.length > 0 ? lines : [[colorChunk(t("ui.noMoreMonsters"), PALETTE.dim)]];
  }

  private renderMain(): string | StyledText {
    switch (this.ui.kind) {
      case "gameover":
        return gameoverScreen.renderMain(this.game);

      case "room":
      case "rest":
        return roomScreen.renderMain(this.game, this.ui);

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
      case "pickItemInCombat":
      case "pickTarget":
        return combatScreen.renderMain(this.game, this.ui, this.listPage);

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
        return eventsScreen.renderMain(this.game, this.ui, this.listPage);

      default: {
        const _exhaustive: never = this.ui;
        return _exhaustive;
      }
    }
  }

  private renderFooter(): string {
    switch (this.ui.kind) {
      case "room":
      case "rest":
        return roomScreen.renderFooter(this.ui);
      case "pickAction":
      case "pickSkill":
      case "pickItemInCombat":
      case "pickTarget":
      case "roundResolved":
      case "combatOver":
        return combatScreen.renderFooter(this.ui);
      case "pickItemOutOfCombat":
      case "itemDetail":
        return inventoryScreen.renderFooter(this.ui);
      case "artifactMenu":
      case "artifactDetail":
        return artifactsScreen.renderFooter(this.ui);
      case "artifactDecision":
      case "artifactDecisionPickCharacter":
      case "artifactDecisionPickReplace":
        return artifactDecisionScreen.renderFooter(this.ui);
      case "saveMenu":
        return saveScreen.renderFooter();
      case "roomReward":
        return rewardsScreen.renderFooter(this.ui);
      case "campPrompt":
        return campScreen.renderFooter(this.ui);
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
        return eventsScreen.renderFooter(this.ui);
      case "gameover":
        return gameoverScreen.renderFooter();
    }
  }
}
