import { BoxRenderable, ScrollBoxRenderable, TextRenderable, StyledText, type CliRenderer, type KeyEvent, type TextChunk } from "@opentui/core";
import type { Character, CombatantRef, Monster, SkillDefinition, ItemDefinition, Id, LogEntry, CombatantSnapshot } from "../types";
import { Game, MERCHANT_PRICE_PERCENT, BLOOD_ALTAR_HP_PERCENT, COLLAPSED_FLOOR_HP_PERCENT } from "../engine/game";
import { getActorByRef, checkSkillUsable, checkItemUsable } from "../engine/combat";
import { getSkill, getClass, getEffectiveSkill } from "../data/classes";
import { getItem, formatItemEffect } from "../data/items";
import { getArtifact, formatArtifactEffect } from "../data/artifacts";
import { getEvent } from "../data/events";
import { MAX_EQUIPPED_ARTIFACTS } from "../engine/party";
import { getRoom } from "../engine/dungeon";
import { getFearTier } from "../engine/resolver";
import { t } from "../data/strings";
import { manualSave, quickSave, autoSave } from "../engine/save";
import {
  PALETTE,
  CLASS_STYLE,
  MONSTER_STYLE,
  BOSS_COLOR,
  ELITE_COLOR,
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

const SLOT_WIDTH = 13;
const SLOT_GAP = 2;
const DIVIDER_WIDTH = 3;
const EMPTY_ENEMY_WIDTH = 24;
const UNIT_BLOCK_HEIGHT = MAX_BOSS_HEIGHT + 3;
const LOG_HISTORY_SIZE = 20;
const LOG_REVEAL_INTERVAL_MS = 500;

function centerText(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const pad = width - text.length;
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + text + " ".repeat(pad - left);
}

function monsterStyle(m: Monster): { abbr: string; color: string } {
  if (m.tier === "boss") return { abbr: "BOSS", color: BOSS_COLOR };
  if (m.tier === "elite") return { abbr: "ELITE", color: ELITE_COLOR };
  return MONSTER_STYLE[m.archetypeId] ?? { abbr: "??", color: PALETTE.dim };
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "…";
}

function mergeBlocksHorizontally(blocks: TextChunk[][][], gapWidth: number): TextChunk[][] {
  const lineCount = blocks[0]?.length ?? 0;
  const merged: TextChunk[][] = [];
  for (let i = 0; i < lineCount; i++) {
    const line: TextChunk[] = [];
    blocks.forEach((block, idx) => {
      if (idx > 0) line.push(plainChunk(" ".repeat(gapWidth)));
      line.push(...(block[i] ?? []));
    });
    merged.push(line);
  }
  return merged;
}

type PickTargetSource = { kind: "skill"; skill: SkillDefinition } | { kind: "item"; item: ItemDefinition };

type ItemDetailOrigin = { kind: "combat"; actorRef: CombatantRef } | { kind: "outOfCombat" };

type ArtifactDetailOrigin = { kind: "unequipped" } | { kind: "equipped"; characterId: Id };

type RewardEntry = { kind: "item"; id: Id; qty: number } | { kind: "artifact"; id: Id };

type UiState =
  | { kind: "room" }
  | { kind: "rest" }
  | { kind: "pickAction"; actorRef: CombatantRef }
  | { kind: "pickSkill"; actorRef: CombatantRef }
  | { kind: "pickItemInCombat"; actorRef: CombatantRef }
  | { kind: "pickTarget"; actorRef: CombatantRef; source: PickTargetSource; candidates: CombatantRef[] }
  | { kind: "roundResolved" }
  | { kind: "combatOver" }
  | { kind: "pickItemOutOfCombat" }
  | { kind: "itemDetail"; item: ItemDefinition; origin: ItemDetailOrigin }
  | { kind: "artifactMenu" }
  | { kind: "artifactDetail"; artifactId: Id; origin: ArtifactDetailOrigin }
  | { kind: "pickCharacterForArtifact"; artifactId: Id }
  | { kind: "saveMenu"; previous: UiState }
  | { kind: "roomReward"; entries: RewardEntry[]; viewing: RewardEntry | null }
  | { kind: "eventMerchant" }
  | { kind: "eventMerchantPickPayer"; offerIndex: number }
  | { kind: "eventCursedShrine" }
  | { kind: "eventTwinAltars" }
  | { kind: "eventTwinAltarsPickCharacter"; offerIndex: 0 | 1 }
  | { kind: "eventTwinAltarsPickUnequip"; offerIndex: 0 | 1; characterId: Id }
  | { kind: "eventHpGamble"; eventId: "blood-altar" | "collapsed-floor" }
  | { kind: "eventHpGamblePickPayer"; eventId: "blood-altar" | "collapsed-floor" }
  | { kind: "eventArtifactPick"; eventId: "sacrificial-circle" | "gambling-den" }
  | { kind: "eventHermit" }
  | { kind: "eventHermitPickArtifact"; service: "removeCurse" | "reroll" }
  | { kind: "gameover" };

function inventoryEntries(inventory: Record<Id, number>): { item: ItemDefinition; qty: number }[] {
  return Object.entries(inventory)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ item: getItem(id), qty }));
}

function buildRewardEntries(drops: { itemIds: Id[]; artifactIds: Id[] }): RewardEntry[] {
  const itemQty = new Map<Id, number>();
  for (const id of drops.itemIds) itemQty.set(id, (itemQty.get(id) ?? 0) + 1);
  const entries: RewardEntry[] = [];
  for (const [id, qty] of itemQty) entries.push({ kind: "item", id, qty });
  for (const id of drops.artifactIds) entries.push({ kind: "artifact", id });
  return entries;
}

function ownedArtifactIds(party: Character[], unequippedArtifactIds: Id[]): Id[] {
  return [...unequippedArtifactIds, ...party.flatMap((c) => c.equippedArtifactIds)];
}

function cursedEquippedEntries(party: Character[]): { character: Character; artifactId: Id }[] {
  return party.flatMap((character) => character.equippedArtifactIds.filter((id) => getArtifact(id).isCursed).map((artifactId) => ({ character, artifactId })));
}

function skillEntries(actor: Character): SkillDefinition[] {
  return actor.unlockedSkillIds.map((id) => getEffectiveSkill(getSkill(id), actor.level));
}

function eventUiState(eventId: Id): UiState {
  const event = getEvent(eventId);
  switch (event.kind) {
    case "merchant":
      return { kind: "eventMerchant" };
    case "choiceReveal":
      return eventId === "twin-altars" ? { kind: "eventTwinAltars" } : { kind: "eventCursedShrine" };
    case "artifactExchange":
      return eventId === "wandering-hermit" ? { kind: "eventHermit" } : { kind: "eventArtifactPick", eventId: eventId as "sacrificial-circle" | "gambling-den" };
    case "hpGamble":
      return { kind: "eventHpGamble", eventId: "blood-altar" };
    case "rescueGamble":
      return { kind: "eventHpGamble", eventId: "collapsed-floor" };
    default:
      return { kind: "room" };
  }
}

const FEAR_TIER_LABEL: Record<number, string> = {
  1: t("ui.fearTier1"),
  2: t("ui.fearTier2"),
  3: t("ui.fearTier3"),
  4: t("ui.fearTier4"),
};

export class App {
  private game: Game;
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

  private syncUiToGameState(): void {
    if (this.game.state.gameOver) {
      this.ui = { kind: "gameover" };
      return;
    }
    const combat = this.game.state.combat;
    if (!combat) {
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
    const digit = /^[1-9]$/.test(key.name) ? Number(key.name) : null;

    switch (this.ui.kind) {
      case "room": {
        if (key.name === "i") {
          if (inventoryEntries(this.game.state.inventory).length > 0) this.ui = { kind: "pickItemOutOfCombat" };
          break;
        }
        if (key.name === "a") {
          this.ui = { kind: "artifactMenu" };
          break;
        }
        if (digit === null) break;
        const choices = this.game.connectedRoomChoices();
        const choice = choices[digit - 1];
        if (choice) this.game.move(choice.id);
        this.syncUiToGameState();
        break;
      }
      case "rest": {
        const choice = digit === 1 ? "eat" : digit === 2 ? "chat" : digit === 3 ? "skip" : null;
        if (choice === null) break;
        this.game.restAction(choice);
        this.syncUiToGameState();
        break;
      }
      case "pickAction": {
        if (digit === 1) {
          this.ui = { kind: "pickSkill", actorRef: this.ui.actorRef };
        } else if (digit === 2) {
          if (inventoryEntries(this.game.state.inventory).length === 0) {
            this.reportUnusable(t("ui.noItemsToUse"));
            break;
          }
          this.ui = { kind: "pickItemInCombat", actorRef: this.ui.actorRef };
        }
        break;
      }
      case "pickSkill": {
        if (digit === null) break;
        const actor = getActorByRef(this.ui.actorRef, this.game.ctx) as Character;
        const skill = skillEntries(actor)[digit - 1];
        if (!skill) break;
        this.trySelectSkill(this.ui.actorRef, skill);
        break;
      }
      case "pickItemInCombat": {
        if (digit === null) break;
        const entry = inventoryEntries(this.game.state.inventory)[digit - 1];
        if (!entry) break;
        this.ui = { kind: "itemDetail", item: entry.item, origin: { kind: "combat", actorRef: this.ui.actorRef } };
        break;
      }
      case "pickTarget": {
        if (digit === null) break;
        const target = this.ui.candidates[digit - 1];
        if (!target) break;
        const err =
          this.ui.source.kind === "skill"
            ? this.game.queue(this.ui.actorRef, this.ui.source.skill.id, [target])
            : this.game.queueItem(this.ui.actorRef, this.ui.source.item.id, [target]);
        if (err) this.reportUnusable(err.reason);
        this.syncUiToGameState();
        break;
      }
      case "roundResolved":
      case "combatOver": {
        if (this.ui.kind === "combatOver") {
          const wasBossRoomVictory = this.game.clearFinishedCombat();
          const drops = this.game.state.lastRoomDrops;
          this.game.state.lastRoomDrops = null;
          if (drops && (drops.itemIds.length > 0 || drops.artifactIds.length > 0)) {
            this.pendingFloorAdvance = wasBossRoomVictory;
            this.ui = { kind: "roomReward", entries: buildRewardEntries(drops), viewing: null };
            break;
          }
          if (wasBossRoomVictory) {
            const depthBefore = this.game.state.floor.depth;
            this.game.advanceToNextFloor();
            if (this.game.state.floor.depth > depthBefore) autoSave(this.game);
          }
        }
        this.syncUiToGameState();
        break;
      }
      case "roomReward": {
        if (this.ui.viewing) {
          if (digit === 1) this.ui = { kind: "roomReward", entries: this.ui.entries, viewing: null };
          break;
        }
        if (key.name === "return") {
          if (this.pendingFloorAdvance) {
            this.pendingFloorAdvance = false;
            const depthBefore = this.game.state.floor.depth;
            this.game.advanceToNextFloor();
            if (this.game.state.floor.depth > depthBefore) autoSave(this.game);
          }
          this.syncUiToGameState();
          break;
        }
        if (digit === null) break;
        if (digit <= this.ui.entries.length) {
          this.ui = { kind: "roomReward", entries: this.ui.entries, viewing: this.ui.entries[digit - 1]! };
        }
        break;
      }
      case "pickItemOutOfCombat": {
        if (digit === null) break;
        const entry = inventoryEntries(this.game.state.inventory)[digit - 1];
        if (!entry) break;
        this.ui = { kind: "itemDetail", item: entry.item, origin: { kind: "outOfCombat" } };
        break;
      }
      case "itemDetail": {
        if (this.ui.origin.kind === "outOfCombat") {
          if (digit === 1) this.ui = { kind: "pickItemOutOfCombat" };
        } else if (digit === 1) {
          this.trySelectItem(this.ui.origin.actorRef, this.ui.item);
        } else if (digit === 2) {
          this.ui = { kind: "pickItemInCombat", actorRef: this.ui.origin.actorRef };
        }
        break;
      }
      case "artifactDetail": {
        if (digit === 1) {
          if (this.ui.origin.kind === "unequipped") {
            this.ui = { kind: "pickCharacterForArtifact", artifactId: this.ui.artifactId };
          } else {
            const err = this.game.unequipArtifact(this.ui.origin.characterId, this.ui.artifactId);
            if (err) this.reportUnusable(err.reason);
            this.syncUiToGameState();
          }
        } else if (digit === 2) {
          this.ui = { kind: "artifactMenu" };
        }
        break;
      }
      case "saveMenu": {
        if (digit === 1) {
          manualSave(this.game);
          this.pushToast(t("ui.gameSavedMsg"));
          this.ui = this.ui.previous;
        } else if (digit === 2) {
          manualSave(this.game);
          this.quit();
        } else if (digit === 3) {
          this.ui = this.ui.previous;
        }
        break;
      }
      case "artifactMenu": {
        if (digit === null) break;
        const unequipped = this.game.state.unequippedArtifactIds;
        if (digit <= unequipped.length) {
          this.ui = { kind: "artifactDetail", artifactId: unequipped[digit - 1]!, origin: { kind: "unequipped" } };
        } else {
          const pair = this.equippedArtifactPairAt(digit - unequipped.length);
          if (!pair) break;
          this.ui = { kind: "artifactDetail", artifactId: pair.artifactId, origin: { kind: "equipped", characterId: pair.characterId } };
        }
        break;
      }
      case "pickCharacterForArtifact": {
        if (digit === null) break;
        const character = this.game.state.party[digit - 1];
        if (!character) break;
        const err = this.game.equipArtifact(character.id, this.ui.artifactId);
        if (err) this.reportUnusable(err.reason);
        this.syncUiToGameState();
        break;
      }
      case "eventMerchant": {
        if (digit === null) break;
        const offers = this.game.state.activeEvent?.offerArtifactIds ?? [];
        if (digit <= offers.length) {
          this.ui = { kind: "eventMerchantPickPayer", offerIndex: digit - 1 };
        } else if (digit === offers.length + 1) {
          this.game.merchantLeave();
          this.logHistory.push({ text: this.game.state.message, kind: "info" });
          this.syncUiToGameState();
        }
        break;
      }
      case "eventMerchantPickPayer": {
        if (digit === null) break;
        const payer = this.game.state.party[digit - 1];
        if (!payer) break;
        const err = this.game.merchantPurchase(this.ui.offerIndex, payer.id);
        if (err) this.reportUnusable(err.reason);
        else this.logHistory.push({ text: this.game.state.message, kind: "info" });
        this.syncUiToGameState();
        break;
      }
      case "eventCursedShrine": {
        if (digit === 1 || digit === 2) {
          this.game.cursedShrineDecide(digit === 1);
          this.logHistory.push({ text: this.game.state.message, kind: "info" });
          this.syncUiToGameState();
        }
        break;
      }
      case "eventTwinAltars": {
        if (digit === 1 || digit === 2) this.ui = { kind: "eventTwinAltarsPickCharacter", offerIndex: (digit - 1) as 0 | 1 };
        break;
      }
      case "eventTwinAltarsPickCharacter": {
        if (digit === null) break;
        const character = this.game.state.party[digit - 1];
        if (!character) break;
        if (character.equippedArtifactIds.length >= MAX_EQUIPPED_ARTIFACTS) {
          this.ui = { kind: "eventTwinAltarsPickUnequip", offerIndex: this.ui.offerIndex, characterId: character.id };
          break;
        }
        const err = this.game.twinAltarsChoose(this.ui.offerIndex, character.id);
        if (err) this.reportUnusable(err.reason);
        else this.logHistory.push({ text: this.game.state.message, kind: "info" });
        this.syncUiToGameState();
        break;
      }
      case "eventTwinAltarsPickUnequip": {
        if (digit === null) break;
        const { offerIndex, characterId } = this.ui;
        const character = this.game.state.party.find((c) => c.id === characterId);
        const artifactId = character?.equippedArtifactIds[digit - 1];
        if (!artifactId) break;
        const err = this.game.twinAltarsChoose(offerIndex, characterId, artifactId);
        if (err) this.reportUnusable(err.reason);
        else this.logHistory.push({ text: this.game.state.message, kind: "info" });
        this.syncUiToGameState();
        break;
      }
      case "eventHpGamble": {
        if (digit === 1) {
          this.ui = { kind: "eventHpGamblePickPayer", eventId: this.ui.eventId };
        } else if (digit === 2) {
          if (this.ui.eventId === "blood-altar") this.game.bloodAltarLeave();
          else this.game.collapsedFloorLeave();
          this.logHistory.push({ text: this.game.state.message, kind: "info" });
          this.syncUiToGameState();
        }
        break;
      }
      case "eventHpGamblePickPayer": {
        if (digit === null) break;
        const character = this.game.state.party[digit - 1];
        if (!character) break;
        const err = this.ui.eventId === "blood-altar" ? this.game.bloodAltarPay(character.id) : this.game.collapsedFloorAttempt(character.id);
        if (err) this.reportUnusable(err.reason);
        else this.logHistory.push({ text: this.game.state.message, kind: "info" });
        this.syncUiToGameState();
        break;
      }
      case "eventArtifactPick": {
        if (digit === null) break;
        const isSacrifice = this.ui.eventId === "sacrificial-circle";
        const candidates = isSacrifice ? ownedArtifactIds(this.game.state.party, this.game.state.unequippedArtifactIds) : this.game.state.unequippedArtifactIds;
        if (digit <= candidates.length) {
          const artifactId = candidates[digit - 1]!;
          const err = isSacrifice ? this.game.sacrifice(artifactId) : this.game.gamblingDenBet(artifactId);
          if (err) this.reportUnusable(err.reason);
          else this.logHistory.push({ text: this.game.state.message, kind: "info" });
          this.syncUiToGameState();
        } else if (digit === candidates.length + 1) {
          if (isSacrifice) this.game.sacrificeLeave();
          else this.game.gamblingDenLeave();
          this.logHistory.push({ text: this.game.state.message, kind: "info" });
          this.syncUiToGameState();
        }
        break;
      }
      case "eventHermit": {
        if (digit === 1) {
          if (cursedEquippedEntries(this.game.state.party).length === 0) {
            this.reportUnusable(t("ui.noCursedToRemove"));
            break;
          }
          this.ui = { kind: "eventHermitPickArtifact", service: "removeCurse" };
        } else if (digit === 2) {
          if (ownedArtifactIds(this.game.state.party, this.game.state.unequippedArtifactIds).length === 0) {
            this.reportUnusable(t("ui.noArtifactToReroll"));
            break;
          }
          this.ui = { kind: "eventHermitPickArtifact", service: "reroll" };
        } else if (digit === 3) {
          this.game.hermitLeave();
          this.logHistory.push({ text: this.game.state.message, kind: "info" });
          this.syncUiToGameState();
        }
        break;
      }
      case "eventHermitPickArtifact": {
        if (digit === null) break;
        if (this.ui.service === "removeCurse") {
          const entry = cursedEquippedEntries(this.game.state.party)[digit - 1];
          if (!entry) break;
          const err = this.game.hermitRemoveCurse(entry.character.id, entry.artifactId);
          if (err) this.reportUnusable(err.reason);
          else this.logHistory.push({ text: this.game.state.message, kind: "info" });
        } else {
          const artifactId = ownedArtifactIds(this.game.state.party, this.game.state.unequippedArtifactIds)[digit - 1];
          if (!artifactId) break;
          const err = this.game.hermitRerollFortune(artifactId);
          if (err) this.reportUnusable(err.reason);
          else this.logHistory.push({ text: this.game.state.message, kind: "info" });
        }
        this.syncUiToGameState();
        break;
      }
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
      case "pickCharacterForArtifact":
        this.ui = { kind: "artifactMenu" };
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

  private quit(): void {
    if (this.revealTimer !== null) clearTimeout(this.revealTimer);
    this.renderer.destroy();
    process.exit(0);
  }

  private reportUnusable(reason: string): void {
    if (this.game.state.combat) this.game.state.combat.log.push({ text: reason, kind: "info" });
    else this.logHistory.push({ text: reason, kind: "info" });
  }

  private pushToast(text: string): void {
    if (this.game.state.combat) this.game.state.combat.log.push({ text, kind: "info" });
    else this.logHistory.push({ text, kind: "info" });
  }

  private trySelectSkill(actorRef: CombatantRef, skill: SkillDefinition): void {
    const actor = getActorByRef(actorRef, this.game.ctx);
    const unusable = checkSkillUsable(actor, skill);
    if (unusable) {
      this.reportUnusable(t("ui.skillUnusableNamed", { skill: skill.name, reason: unusable.reason }));
      return;
    }
    if (skill.target === "singleEnemy" || skill.target === "singleAlly") {
      const candidates = skill.target === "singleEnemy" ? this.game.livingEnemyRefs() : this.game.livingAllyRefs();
      this.ui = { kind: "pickTarget", actorRef, source: { kind: "skill", skill }, candidates };
      return;
    }
    if (skill.target === "singleAllyOrEnemy") {
      const candidates = [...this.game.livingAllyRefs(), ...this.game.livingEnemyRefs()];
      this.ui = { kind: "pickTarget", actorRef, source: { kind: "skill", skill }, candidates };
      return;
    }
    const targets = this.game.autoTargets(skill.target, actorRef) ?? [actorRef];
    const err = this.game.queue(actorRef, skill.id, targets);
    if (err) this.reportUnusable(err.reason);
    this.syncUiToGameState();
  }

  private equippedArtifactPairAt(position: number): { characterId: Id; artifactId: Id } | null {
    let remaining = position;
    for (const c of this.game.state.party) {
      if (remaining <= c.equippedArtifactIds.length) return { characterId: c.id, artifactId: c.equippedArtifactIds[remaining - 1]! };
      remaining -= c.equippedArtifactIds.length;
    }
    return null;
  }

  private trySelectItem(actorRef: CombatantRef, item: ItemDefinition): void {
    const actor = getActorByRef(actorRef, this.game.ctx);
    const unusable = checkItemUsable(actor, item.id, this.game.state.inventory);
    if (unusable) {
      this.reportUnusable(t("ui.itemUnusableNamed", { item: item.name, reason: unusable.reason }));
      return;
    }
    if (item.target === "singleEnemy" || item.target === "singleAlly" || item.target === "self") {
      const candidates = item.target === "singleEnemy" ? this.game.livingEnemyRefs() : this.game.livingAllyRefs();
      this.ui = { kind: "pickTarget", actorRef, source: { kind: "item", item }, candidates };
      return;
    }
    const targets = this.game.autoTargets(item.target, actorRef) ?? [actorRef];
    const err = this.game.queueItem(actorRef, item.id, targets);
    if (err) this.reportUnusable(err.reason);
    this.syncUiToGameState();
  }

  private render(): void {
    const s = this.game.state;
    const room = getRoom(s.floor, s.currentRoomId);
    this.header.content = joinLines([
      [
        boldColorChunk(room.name, PALETTE.title),
        plainChunk(t("ui.headerFloor", { depth: s.floor.depth })),
        colorChunk(s.combat ? t("ui.roundHeader", { round: s.combat.roundNumber }) : t("ui.exploring"), PALETTE.dim),
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
      partyLines.push(...this.renderCharacterLines(view ? { ...c, hp: view.hp, isAlive: view.isAlive, level: view.level ?? c.level, mp: view.mp ?? c.mp } : c));
    });
    const items = inventoryEntries(s.inventory);
    if (items.length > 0) {
      partyLines.push([], [colorChunk(t("ui.itemsLabel"), PALETTE.title)]);
      for (const { item, qty } of items) partyLines.push([plainChunk(t("ui.inventoryLineNoIndex", { name: item.name, qty }))]);
    }
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

  private renderCharacterLines(c: Character): TextChunk[][] {
    const style = CLASS_STYLE[c.classId] ?? { abbr: "??", color: PALETTE.dim };
    if (!c.isAlive) {
      return [[chip(style.abbr, PALETTE.dead), plainChunk(t("ui.fallenSuffix", { name: c.name }))]];
    }

    const line1: TextChunk[] = [chip(style.abbr, style.color), plainChunk(` ${c.name} `), colorChunk(t("ui.levelTag", { level: c.level }), PALETTE.title)];
    const tier = getFearTier(c.survival.fear);
    const line2: TextChunk[] = [
      plainChunk("  "),
      colorChunk(t("ui.hpStat", { hp: c.hp, maxHp: c.maxHp }), hpColorFor(c.hp, c.maxHp)),
      plainChunk(" "),
      colorChunk(t("ui.mpStat", { mp: c.mp, maxMp: c.maxMp }), PALETTE.mp),
      plainChunk(" "),
      colorChunk(t("ui.fearStat", { fear: c.survival.fear }), fearColorFor(tier)),
    ];

    const notes: TextChunk[] = [];
    if (tier >= 2) {
      notes.push(colorChunk(FEAR_TIER_LABEL[tier]!, fearColorFor(tier)));
    }
    if (c.survival.hunger <= 20) notes.push(colorChunk(t("ui.hungry"), PALETTE.hpLow));
    if (c.survival.thirst <= 20) notes.push(colorChunk(t("ui.thirsty"), PALETTE.hpLow));
    for (const eff of c.activeStatusEffects) {
      notes.push(colorChunk(eff.statusEffectId, PALETTE.dim));
    }
    for (const artifactId of c.equippedArtifactIds) {
      notes.push(colorChunk(getArtifact(artifactId).name, PALETTE.title));
    }

    if (notes.length === 0) return [line1, line2];
    const line3: TextChunk[] = [plainChunk("  ")];
    notes.forEach((n, i) => {
      if (i > 0) line3.push(plainChunk(" · "));
      line3.push(n);
    });
    return [line1, line2, line3];
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
    const s = this.game.state;
    switch (this.ui.kind) {
      case "gameover":
        return s.gameOver === "victory" ? t("ui.victoryScreen") : t("ui.defeatScreen");

      case "room": {
        const room = getRoom(s.floor, s.currentRoomId);
        const choices = this.game.connectedRoomChoices();
        const lines = [t("ui.roomTypeLine", { type: room.type, clearedTag: room.cleared ? t("ui.clearedTag") : "" }), "", t("ui.pathsLabel")];
        choices.forEach((r, i) => lines.push(`  [${i + 1}] ${r.name} (${r.type})`));
        if (inventoryEntries(s.inventory).length > 0) lines.push("", t("ui.pressItemHint"));
        lines.push(t("ui.pressArtifactHint"));
        return lines.join("\n");
      }

      case "artifactMenu": {
        const lines = [t("ui.manageArtifacts")];
        let i = 0;
        s.unequippedArtifactIds.forEach((id) => {
          i++;
          const a = getArtifact(id);
          lines.push(t("ui.equipOption", { i, name: a.name, rarity: a.rarity }));
        });
        s.party.forEach((c) => {
          c.equippedArtifactIds.forEach((id) => {
            i++;
            lines.push(t("ui.unequipOption", { i, name: getArtifact(id).name, character: c.name }));
          });
        });
        if (i === 0) lines.push(t("ui.noArtifactsYet"));
        return lines.join("\n");
      }

      case "artifactDetail": {
        const artifact = getArtifact(this.ui.artifactId);
        const lines = [
          `${artifact.name} (${artifact.rarity})${artifact.isCursed ? t("ui.cursedTag") : ""}`,
          "",
          t("ui.effectLabel"),
          formatArtifactEffect(artifact),
          "",
          t("ui.descriptionLabel"),
          artifact.description,
          "",
          this.ui.origin.kind === "unequipped" ? t("ui.artifactDetailEquipOption") : t("ui.artifactDetailUnequipOption"),
          t("ui.artifactDetailBackOption"),
        ];
        return lines.join("\n");
      }

      case "pickCharacterForArtifact": {
        const artifact = getArtifact(this.ui.artifactId);
        const lines = [t("ui.equipPrompt", { artifact: artifact.name })];
        s.party.forEach((c, i) => lines.push(`  [${i + 1}] ${c.name} ${t("ui.artifactSlotsTag", { count: c.equippedArtifactIds.length, max: MAX_EQUIPPED_ARTIFACTS })}`));
        return lines.join("\n");
      }

      case "pickItemOutOfCombat": {
        const lines = [t("ui.chooseItemToUse")];
        inventoryEntries(s.inventory).forEach(({ item, qty }, i) => {
          lines.push(t("ui.inventoryLine", { i: i + 1, name: item.name, qty }));
        });
        return lines.join("\n");
      }

      case "itemDetail": {
        const { item, origin } = this.ui;
        const lines = [item.name, "", t("ui.effectLabel"), formatItemEffect(item), "", t("ui.descriptionLabel"), item.description, ""];
        if (origin.kind === "outOfCombat") {
          lines.push(t("ui.itemOutOfCombatViewOnlyHint"), "", t("ui.itemDetailBackOnlyOption"));
        } else {
          lines.push(t("ui.itemDetailUseOption"), t("ui.itemDetailBackOption"));
        }
        return lines.join("\n");
      }

      case "saveMenu": {
        return [t("ui.saveMenuTitle"), "", t("ui.saveMenuSave"), t("ui.saveMenuSaveAndExit"), t("ui.saveMenuCancel")].join("\n");
      }

      case "roomReward": {
        if (this.ui.viewing) {
          const entry = this.ui.viewing;
          const lines =
            entry.kind === "item"
              ? [`${getItem(entry.id).name} x${entry.qty}`, "", t("ui.effectLabel"), formatItemEffect(getItem(entry.id)), "", t("ui.descriptionLabel"), getItem(entry.id).description]
              : [
                  `${getArtifact(entry.id).name} (${getArtifact(entry.id).rarity})`,
                  "",
                  t("ui.effectLabel"),
                  formatArtifactEffect(getArtifact(entry.id)),
                  "",
                  t("ui.descriptionLabel"),
                  getArtifact(entry.id).description,
                ];
          lines.push("", t("ui.roomRewardBackOption"));
          return lines.join("\n");
        }
        const lines = [t("ui.roomRewardTitle")];
        this.ui.entries.forEach((entry, i) => {
          lines.push(entry.kind === "item" ? t("ui.roomRewardItemLine", { i: i + 1, name: getItem(entry.id).name, qty: entry.qty }) : t("ui.roomRewardArtifactLine", { i: i + 1, name: getArtifact(entry.id).name, rarity: getArtifact(entry.id).rarity }));
        });
        lines.push(t("ui.roomRewardContinueOption"));
        return lines.join("\n");
      }

      case "rest": {
        const room = getRoom(s.floor, s.currentRoomId);
        return [t("dungeon.restEnter", { room: room.name }), "", t("ui.restOptEat"), t("ui.restOptChat"), t("ui.restOptSkip")].join("\n");
      }

      case "combatOver": {
        const combat = s.combat!;
        return combat.outcome === "victory" ? t("ui.combatOverVictory") : t("ui.combatOverDefeat");
      }

      case "roundResolved":
        return t("ui.roundResolved");

      case "pickAction": {
        const actor = getActorByRef(this.ui.actorRef, this.game.ctx) as Character;
        const hasItems = inventoryEntries(s.inventory).length > 0;
        const lines = [
          t("ui.turnOfChooseAction", { actor: actor.name }),
          t("ui.fightOption"),
          t("ui.useItemOption", { suffix: hasItems ? "" : t("ui.noItemsSuffix") }),
        ];
        return lines.join("\n");
      }

      case "pickSkill": {
        const actor = getActorByRef(this.ui.actorRef, this.game.ctx) as Character;
        const lines: TextChunk[][] = [[plainChunk(t("ui.turnOfChooseSkill", { actor: actor.name }))]];
        skillEntries(actor).forEach((sk, i) => {
          const unusable = checkSkillUsable(actor, sk);
          const usesLeft = sk.usesPerCombat !== undefined ? actor.usesRemainingThisCombat[sk.id] ?? sk.usesPerCombat : null;
          const usesSuffix = usesLeft !== null ? t("ui.usesLeftSuffix", { count: usesLeft }) : "";
          const dmgEffect = sk.effects?.find((e) => e.kind === "damage");
          const offensiveStat = sk.isMagic ? actor.magicPower : actor.attack;
          const dmgSuffix = dmgEffect ? t("ui.dmgEstimateSuffix", { amount: Math.max(1, Math.round((dmgEffect.amount ?? 0) + offensiveStat)) }) : "";
          const head = `  [${i + 1}] ${sk.name} (MP ${sk.mpCost}${usesSuffix}${dmgSuffix})`;
          if (unusable) {
            lines.push([colorChunk(`${head} — ${unusable.reason}`, PALETTE.disabled)]);
          } else {
            lines.push([plainChunk(`${head} — ${truncateText(sk.description, 34)}`)]);
          }
        });
        return joinLines(lines);
      }

      case "pickItemInCombat": {
        const lines = [t("ui.chooseItemToUse")];
        inventoryEntries(s.inventory).forEach(({ item, qty }, i) => {
          lines.push(t("ui.inventoryLine", { i: i + 1, name: item.name, qty }));
        });
        return lines.join("\n");
      }

      case "pickTarget": {
        const sourceName = this.ui.source.kind === "skill" ? this.ui.source.skill.name : this.ui.source.item.name;
        const sourceTarget = this.ui.source.kind === "skill" ? this.ui.source.skill.target : this.ui.source.item.target;
        const lines = [t("ui.chooseTargetFor", { source: sourceName })];
        const isDualRelation = sourceTarget === "singleAllyOrEnemy";
        this.ui.candidates.forEach((ref, i) => {
          const target = getActorByRef(ref, this.game.ctx);
          const hpInfo = "hp" in target ? t("ui.hpSuffix", { hp: target.hp, maxHp: target.maxHp }) : "";
          const sidePrefix = isDualRelation ? (ref.kind === "character" ? t("ui.allySidePrefix") : t("ui.enemySidePrefix")) : "";
          lines.push(`  [${i + 1}] ${sidePrefix}${target.name}${hpInfo}`);
        });
        return lines.join("\n");
      }

      case "eventMerchant": {
        const offers = s.activeEvent?.offerArtifactIds ?? [];
        const lines = [t("ui.merchantOffers")];
        offers.forEach((id, i) => {
          const a = getArtifact(id);
          lines.push(t("ui.merchantOfferLine", { i: i + 1, name: a.name, rarity: a.rarity, price: MERCHANT_PRICE_PERCENT[a.rarity], desc: truncateText(a.description, 34) }));
        });
        lines.push(t("ui.leaveEmptyHandedOption", { i: offers.length + 1 }));
        return lines.join("\n");
      }

      case "eventMerchantPickPayer": {
        const artifactId = s.activeEvent?.offerArtifactIds[this.ui.offerIndex];
        const lines = [t("ui.whoPaysFor", { artifact: artifactId ? getArtifact(artifactId).name : t("ui.unknownArtifact") })];
        s.party.forEach((c, i) => lines.push(`  [${i + 1}] ${c.name}${t("ui.hpSuffix", { hp: c.hp, maxHp: c.maxHp })}`));
        return lines.join("\n");
      }

      case "eventCursedShrine": {
        const artifactId = s.activeEvent?.offerArtifactIds[0];
        const a = artifactId ? getArtifact(artifactId) : null;
        const curseTag = a?.isCursed ? t("ui.cursedTag") : "";
        return [
          a ? `${a.name} (${a.rarity})${curseTag} — ${a.description}` : "...",
          "",
          t("ui.acceptOption"),
          t("ui.declineOption"),
        ].join("\n");
      }

      case "eventTwinAltars": {
        const offers = s.activeEvent?.offerArtifactIds ?? [];
        const lines = [t("ui.twinAltarsIntro")];
        offers.forEach((id, i) => {
          const a = getArtifact(id);
          lines.push(`  [${i + 1}] ${a.name} (${a.rarity}) — ${truncateText(a.description, 40)}`);
        });
        return lines.join("\n");
      }

      case "eventTwinAltarsPickCharacter": {
        const lines = [t("ui.equipNowPrompt")];
        s.party.forEach((c, i) => lines.push(`  [${i + 1}] ${c.name} ${t("ui.artifactSlotsTag", { count: c.equippedArtifactIds.length, max: MAX_EQUIPPED_ARTIFACTS })}`));
        return lines.join("\n");
      }

      case "eventTwinAltarsPickUnequip": {
        const { characterId } = this.ui;
        const character = s.party.find((c) => c.id === characterId);
        const lines = [t("ui.maxSlotsPrompt", { character: character?.name ?? "" })];
        character?.equippedArtifactIds.forEach((id, i) => lines.push(`  [${i + 1}] ${getArtifact(id).name}`));
        return lines.join("\n");
      }

      case "eventHpGamble": {
        const percent = this.ui.eventId === "blood-altar" ? BLOOD_ALTAR_HP_PERCENT : COLLAPSED_FLOOR_HP_PERCENT;
        const resultLine = this.ui.eventId === "blood-altar" ? t("ui.bloodAltarResult") : t("ui.collapsedFloorResult");
        return [t("ui.payToTry", { percent }), resultLine, "", t("ui.payOption"), t("ui.leaveOption")].join("\n");
      }

      case "eventHpGamblePickPayer": {
        const lines = [t("ui.whoPays")];
        s.party.forEach((c, i) => lines.push(`  [${i + 1}] ${c.name}${t("ui.hpSuffix", { hp: c.hp, maxHp: c.maxHp })}`));
        return lines.join("\n");
      }

      case "eventArtifactPick": {
        const isSacrifice = this.ui.eventId === "sacrificial-circle";
        const candidates = isSacrifice ? ownedArtifactIds(s.party, s.unequippedArtifactIds) : s.unequippedArtifactIds;
        const lines = [isSacrifice ? t("ui.chooseSacrifice") : t("ui.chooseBet")];
        candidates.forEach((id, i) => {
          const a = getArtifact(id);
          lines.push(`  [${i + 1}] ${a.name} (${a.rarity})`);
        });
        lines.push(`  [${candidates.length + 1}] ${isSacrifice ? t("ui.leaveRitualOption") : t("ui.leaveNoBetOption")}`);
        if (candidates.length === 0) lines.push(t("ui.noSuitableArtifacts"));
        return lines.join("\n");
      }

      case "eventHermit": {
        const hasCursed = cursedEquippedEntries(s.party).length > 0;
        const hasAny = ownedArtifactIds(s.party, s.unequippedArtifactIds).length > 0;
        return [
          t("ui.hermitIntro"),
          t("ui.hermitRemoveCurseOption", { suffix: hasCursed ? "" : t("ui.hermitNoCursedSuffix") }),
          t("ui.hermitRerollOption", { suffix: hasAny ? "" : t("ui.hermitNoArtifactSuffix") }),
          t("ui.hermitLeaveOption"),
        ].join("\n");
      }

      case "eventHermitPickArtifact": {
        if (this.ui.service === "removeCurse") {
          const lines = [t("ui.removeCurseIntro")];
          cursedEquippedEntries(s.party).forEach(({ character, artifactId }, i) => lines.push(t("ui.removeCurseLine", { i: i + 1, name: getArtifact(artifactId).name, character: character.name })));
          return lines.join("\n");
        }
        const lines = [t("ui.rerollIntro")];
        ownedArtifactIds(s.party, s.unequippedArtifactIds).forEach((id, i) => lines.push(`  [${i + 1}] ${getArtifact(id).name} (${getArtifact(id).rarity})`));
        return lines.join("\n");
      }

      default: {
        const _exhaustive: never = this.ui;
        return _exhaustive;
      }
    }
  }

  private renderFooter(): string {
    switch (this.ui.kind) {
      case "room":
        return t("ui.footerRoom");
      case "rest":
        return t("ui.footerChooseActivity");
      case "pickAction":
        return t("ui.footerChooseAction");
      case "pickSkill":
        return t("ui.footerChooseSkillEsc");
      case "pickItemInCombat":
        return t("ui.footerChooseItemEsc");
      case "pickTarget":
        return t("ui.footerChooseTargetEsc");
      case "pickItemOutOfCombat":
        return t("ui.footerChooseItemEsc");
      case "itemDetail":
        return t("ui.detailFooter");
      case "artifactMenu":
        return t("ui.footerEquipUnequipEsc");
      case "artifactDetail":
        return t("ui.detailFooter");
      case "pickCharacterForArtifact":
        return t("ui.footerChooseCharacterEsc");
      case "saveMenu":
        return t("ui.saveMenuFooter");
      case "roomReward":
        return this.ui.viewing ? t("ui.detailFooter") : t("ui.roomRewardFooter");
      case "eventMerchantPickPayer":
      case "eventTwinAltarsPickCharacter":
      case "eventHpGamblePickPayer":
        return t("ui.footerChooseCharacter");
      case "eventMerchant":
      case "eventArtifactPick":
        return t("ui.footerChoose");
      case "eventCursedShrine":
      case "eventTwinAltars":
      case "eventHpGamble":
      case "eventHermit":
        return t("ui.footerChoose");
      case "eventTwinAltarsPickUnequip":
        return t("ui.footerChooseArtifactToRemove");
      case "eventHermitPickArtifact":
        return t("ui.footerChooseArtifact");
      case "roundResolved":
      case "combatOver":
        return t("ui.footerPressAnyKey");
      case "gameover":
        return t("ui.footerGameOver");
    }
  }
}
