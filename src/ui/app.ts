import { BoxRenderable, ScrollBoxRenderable, TextRenderable, StyledText, type CliRenderer, type KeyEvent, type TextChunk } from "@opentui/core";
import type { Character, CombatantRef, Monster, SkillDefinition, ItemDefinition, Id } from "../types";
import { Game, MERCHANT_PRICE_PERCENT, BLOOD_ALTAR_HP_PERCENT, COLLAPSED_FLOOR_HP_PERCENT } from "../engine/game";
import { getActorByRef, checkSkillUsable, checkItemUsable } from "../engine/combat";
import { getSkill, getClass } from "../data/classes";
import { getItem } from "../data/items";
import { getArtifact } from "../data/artifacts";
import { getEvent } from "../data/events";
import { MAX_EQUIPPED_ARTIFACTS } from "../engine/party";
import { getRoom } from "../engine/dungeon";
import { getFearTier } from "../engine/resolver";
import { t } from "../data/strings";
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

const SLOT_WIDTH = 13; // matches the class sprites' width, the widest sprites
const SLOT_GAP = 2;
const DIVIDER_WIDTH = 3;
const EMPTY_ENEMY_WIDTH = 24;
/** sprite (bottom-aligned to MAX_BOSS_HEIGHT) + 1 spacer + label line + hp line. */
const UNIT_BLOCK_HEIGHT = MAX_BOSS_HEIGHT + 3;
/** How many of the most recent log lines are kept on screen — scroll up within the panel to see them. */
const LOG_HISTORY_SIZE = 20;

function centerText(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const pad = width - text.length;
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + text + " ".repeat(pad - left);
}

/** Elite and boss are 2 distinct tiers — mixing them up made every guard-room elite display as "BOSS". */
function monsterStyle(m: Monster): { abbr: string; color: string } {
  if (m.tier === "boss") return { abbr: "BOSS", color: BOSS_COLOR };
  if (m.tier === "elite") return { abbr: "ELITE", color: ELITE_COLOR };
  return MONSTER_STYLE[m.archetypeId] ?? { abbr: "??", color: PALETTE.dim };
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "…";
}

/** Concatenates same-height blocks side by side, line by line, with a blank gap between them. */
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

/** What triggered a target-picking screen — a skill or an item (docs/gameplay-decisions/07-items-artifacts.md §7.1: items are picked instead of a skill in the command phase). */
type PickTargetSource = { kind: "skill"; skill: SkillDefinition } | { kind: "item"; item: ItemDefinition };

type UiState =
  | { kind: "room" }
  | { kind: "rest" }
  /** Combat command phase — actor must first choose Fight (→ pickSkill) or Use Item (→ pickItemInCombat). */
  | { kind: "pickAction"; actorRef: CombatantRef }
  | { kind: "pickSkill"; actorRef: CombatantRef }
  | { kind: "pickItemInCombat"; actorRef: CombatantRef }
  | { kind: "pickTarget"; actorRef: CombatantRef; source: PickTargetSource; candidates: CombatantRef[] }
  | { kind: "roundResolved" }
  | { kind: "combatOver" }
  /** Outside combat — picking which item to use (§7.1: items can be used outside combat too, e.g. Ration/Water Flask). */
  | { kind: "pickItemOutOfCombat" }
  /** Outside combat — an item needing a specific character (target !== "allAllies") was picked, now choosing who uses it. */
  | { kind: "pickItemTargetOutOfCombat"; item: ItemDefinition }
  /** Outside combat — artifact equip/unequip menu (docs/gameplay-decisions/07-items-artifacts.md §7.2). */
  | { kind: "artifactMenu" }
  /** An unequipped artifact was picked to equip, now choosing which character gets it. */
  | { kind: "pickCharacterForArtifact"; artifactId: Id }
  // --- Event room (docs/gameplay-decisions/08-events.md §8) — shown whenever the current room is an
  // unresolved event; syncUiToGameState routes to the right one from Room.rolledEventId's EventDefinition.kind.
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

/** Items currently in inventory (qty > 0), in catalog order. */
function inventoryEntries(inventory: Record<Id, number>): { item: ItemDefinition; qty: number }[] {
  return Object.entries(inventory)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ item: getItem(id), qty }));
}

/** Every artifact the party owns right now, unequipped pool + everyone's equipped — used by sacrificial-circle/wandering-hermit "any owned artifact" pickers (docs/gameplay-decisions/08-events.md §8.9/§8.11). */
function ownedArtifactIds(party: Character[], unequippedArtifactIds: Id[]): Id[] {
  return [...unequippedArtifactIds, ...party.flatMap((c) => c.equippedArtifactIds)];
}

/** (character, artifact) pairs for every Cursed Artifact currently equipped anywhere in the party — wandering-hermit's "Gỡ nguyền" candidate list (§8.11). */
function cursedEquippedEntries(party: Character[]): { character: Character; artifactId: Id }[] {
  return party.flatMap((character) => character.equippedArtifactIds.filter((id) => getArtifact(id).isCursed).map((artifactId) => ({ character, artifactId })));
}

/** The "pickSkill" screen's numbered list — every unlocked skill, in unlock order. */
function skillEntries(actor: Character): SkillDefinition[] {
  return actor.unlockedSkillIds.map((id) => getSkill(id));
}

/** Maps a rolled event's kind/id to the UiState that presents it (docs/gameplay-decisions/08-events.md §8) — single source of truth so syncUiToGameState never drifts from the handleKey/renderMain switches below. */
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
      // instantReward/combatReward never reach here — dungeon.ts always resolves them
      // (room.cleared or state.combat) before returning control to the UI.
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
  /** How many entries of the current combat's log have already been folded into `logHistory` — combat.log resets to a fresh array each new fight, `logHistory` never does. */
  private lastLogLength = 0;
  private observedCombatLog: string[] | null = null;
  /** Persists across combats/floors for the lifetime of the App — never cleared, only trimmed to LOG_HISTORY_SIZE. */
  private logHistory: string[] = [];

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

  /** Exposed for tests — the UI is otherwise driven purely by keypresses. */
  get debugUiState(): UiState {
    return this.ui;
  }

  get debugGame(): Game {
    return this.game;
  }

  /** After any game mutation: figure out what the UI should be showing next. */
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
      // instantReward/combatReward-in-progress already resolved to room.cleared or state.combat
      // by dungeon.ts — anything still unresolved here is one of the 8 player-decides event kinds.
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
    // phase === "command": find the next living character without a queued action.
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
    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      this.quit();
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
        this.trySelectItem(this.ui.actorRef, entry.item);
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
        if (this.ui.kind === "combatOver") this.game.clearFinishedCombat();
        this.syncUiToGameState();
        break;
      }
      case "pickItemOutOfCombat": {
        if (digit === null) break;
        const entry = inventoryEntries(this.game.state.inventory)[digit - 1];
        if (!entry) break;
        if (entry.item.target === "allAllies") {
          const err = this.game.useItemOutOfCombat(entry.item.id);
          if (err) this.reportUnusable(err.reason);
          else this.logHistory.push(this.game.state.message);
          this.syncUiToGameState();
        } else if (entry.item.target === "singleEnemy") {
          this.reportUnusable(t("ui.itemUnusableInCombatNamed", { item: entry.item.name }));
        } else {
          this.ui = { kind: "pickItemTargetOutOfCombat", item: entry.item };
        }
        break;
      }
      case "pickItemTargetOutOfCombat": {
        if (digit === null) break;
        const character = this.game.state.party.filter((c) => c.isAlive)[digit - 1];
        if (!character) break;
        const err = this.game.useItemOutOfCombat(this.ui.item.id, character.id);
        if (err) this.reportUnusable(err.reason);
        else this.logHistory.push(this.game.state.message);
        this.syncUiToGameState();
        break;
      }
      case "artifactMenu": {
        if (digit === null) break;
        const unequipped = this.game.state.unequippedArtifactIds;
        if (digit <= unequipped.length) {
          this.ui = { kind: "pickCharacterForArtifact", artifactId: unequipped[digit - 1]! };
        } else {
          const pair = this.equippedArtifactPairAt(digit - unequipped.length);
          if (!pair) break;
          const err = this.game.unequipArtifact(pair.characterId, pair.artifactId);
          if (err) this.reportUnusable(err.reason);
          this.syncUiToGameState();
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
          this.logHistory.push(this.game.state.message);
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
        else this.logHistory.push(this.game.state.message);
        this.syncUiToGameState();
        break;
      }
      case "eventCursedShrine": {
        if (digit === 1 || digit === 2) {
          this.game.cursedShrineDecide(digit === 1);
          this.logHistory.push(this.game.state.message);
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
        else this.logHistory.push(this.game.state.message);
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
        else this.logHistory.push(this.game.state.message);
        this.syncUiToGameState();
        break;
      }
      case "eventHpGamble": {
        if (digit === 1) {
          this.ui = { kind: "eventHpGamblePickPayer", eventId: this.ui.eventId };
        } else if (digit === 2) {
          if (this.ui.eventId === "blood-altar") this.game.bloodAltarLeave();
          else this.game.collapsedFloorLeave();
          this.logHistory.push(this.game.state.message);
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
        else this.logHistory.push(this.game.state.message);
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
          else this.logHistory.push(this.game.state.message);
          this.syncUiToGameState(); // sacrifice leaves the room open (repeatable) — this just re-shows the screen with fresh candidates
        } else if (digit === candidates.length + 1) {
          if (isSacrifice) this.game.sacrificeLeave();
          else this.game.gamblingDenLeave();
          this.logHistory.push(this.game.state.message);
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
          this.logHistory.push(this.game.state.message);
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
          else this.logHistory.push(this.game.state.message);
        } else {
          const artifactId = ownedArtifactIds(this.game.state.party, this.game.state.unequippedArtifactIds)[digit - 1];
          if (!artifactId) break;
          const err = this.game.hermitRerollFortune(artifactId);
          if (err) this.reportUnusable(err.reason);
          else this.logHistory.push(this.game.state.message);
        }
        this.syncUiToGameState();
        break;
      }
      case "gameover":
        break;
    }
    this.render();
  }

  /**
   * Esc handling — pops 1 level back on screens that have a natural parent
   * (item/artifact submenus, the fight-or-item choice, target picking) but
   * were reached without an explicit numbered "back" option. Returns false
   * for screens that must resolve to a decision (`pickAction` mid-combat,
   * `rest`, event rooms with their own "leave" option per §8.13) — Esc does
   * nothing there rather than letting the player dodge a required choice.
   */
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
      case "pickItemTargetOutOfCombat":
        this.ui = { kind: "pickItemOutOfCombat" };
        return true;
      case "artifactMenu":
        this.ui = { kind: "room" };
        return true;
      case "pickCharacterForArtifact":
        this.ui = { kind: "artifactMenu" };
        return true;
      default:
        return false;
    }
  }

  /**
   * `process.exit()` alone skips OpenTUI's terminal teardown (leaves mouse
   * tracking / alternate screen / cursor state stuck) — `renderer.destroy()`
   * restores the terminal first, then we exit.
   */
  private quit(): void {
    this.renderer.destroy();
    process.exit(0);
  }

  /**
   * Surfaces a "can't do that" reason (or an out-of-combat result line) where
   * the player will actually see it. state.message only renders as a
   * fallback when the session's whole log history is empty (see render()'s
   * log section) — dead once combat has happened even once — so push
   * straight into the active combat's log, or logHistory when there's no
   * active combat (e.g. using an item from the room screen).
   */
  private reportUnusable(reason: string): void {
    if (this.game.state.combat) this.game.state.combat.log.push(reason);
    else this.logHistory.push(reason);
  }

  private trySelectSkill(actorRef: CombatantRef, skill: SkillDefinition): void {
    const actor = getActorByRef(actorRef, this.game.ctx);
    const unusable = checkSkillUsable(actor, skill);
    if (unusable) {
      // Stay on pickSkill — never advance to target-picking for a skill that can't be used.
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

  /** 1-indexed lookup into the flattened "every equipped artifact across the whole party" list, in party order — matches the numbering used by the artifactMenu screen's "Gỡ" entries. */
  private equippedArtifactPairAt(position: number): { characterId: Id; artifactId: Id } | null {
    let remaining = position;
    for (const c of this.game.state.party) {
      if (remaining <= c.equippedArtifactIds.length) return { characterId: c.id, artifactId: c.equippedArtifactIds[remaining - 1]! };
      remaining -= c.equippedArtifactIds.length;
    }
    return null;
  }

  /** Item counterpart to trySelectSkill — used instead of a skill during the command phase (§7.1). */
  private trySelectItem(actorRef: CombatantRef, item: ItemDefinition): void {
    const actor = getActorByRef(actorRef, this.game.ctx);
    const unusable = checkItemUsable(actor, item.id, this.game.state.inventory);
    if (unusable) {
      this.reportUnusable(t("ui.itemUnusableNamed", { item: item.name, reason: unusable.reason }));
      return;
    }
    if (item.target === "singleEnemy" || item.target === "singleAlly") {
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
        colorChunk(s.combat ? `Round ${s.combat.roundNumber}` : t("ui.exploring"), PALETTE.dim),
      ],
    ]);

    this.battlefield.content = joinLines(this.renderBattlefield());

    const partyLines: TextChunk[][] = [];
    s.party.forEach((c, i) => {
      if (i > 0) partyLines.push([]);
      partyLines.push(...this.renderCharacterLines(c));
    });
    const items = inventoryEntries(s.inventory);
    if (items.length > 0) {
      partyLines.push([], [colorChunk(t("ui.itemsLabel"), PALETTE.title)]);
      for (const { item, qty } of items) partyLines.push([plainChunk(`  ${item.name} x${qty}`)]);
    }
    this.party.content = joinLines(partyLines);
    this.monsters.content = joinLines(this.renderMonsterLines());
    this.main.content = this.renderMain();

    // Combat.log is a fresh array per fight; fold every new line into logHistory,
    // which persists for the whole session so past battles stay visible (scroll to see them).
    const combatLog = s.combat?.log ?? null;
    if (combatLog !== this.observedCombatLog) {
      this.observedCombatLog = combatLog;
      this.lastLogLength = 0;
    }
    if (combatLog) {
      this.logHistory.push(...combatLog.slice(this.lastLogLength));
      this.lastLogLength = combatLog.length;
    }
    const displayLog = this.logHistory.slice(-LOG_HISTORY_SIZE);
    this.log.content = (displayLog.length > 0 ? displayLog : [s.message]).join("\n");

    this.footer.content = this.renderFooter();
  }

  private renderCharacterLines(c: Character): TextChunk[][] {
    const style = CLASS_STYLE[c.classId] ?? { abbr: "??", color: PALETTE.dim };
    if (!c.isAlive) {
      return [[chip(style.abbr, PALETTE.dead), plainChunk(t("ui.fallenSuffix", { name: c.name }))]];
    }

    const line1: TextChunk[] = [chip(style.abbr, style.color), plainChunk(` ${c.name} `), colorChunk(`Lv.${c.level}`, PALETTE.title)];
    const tier = getFearTier(c.survival.fear);
    const line2: TextChunk[] = [
      plainChunk("  "),
      colorChunk(`HP ${c.hp}/${c.maxHp}`, hpColorFor(c.hp, c.maxHp)),
      plainChunk(" "),
      colorChunk(`MP ${c.mp}/${c.maxMp}`, PALETTE.mp),
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

  /** The 3 rows below a unit's sprite (spacer/label/status) — always exactly SLOT_WIDTH, never overflows. */
  private buildUnitMeta(label: string, labelColor: string, statusText: string, statusColor: string): TextChunk[][] {
    return [
      [plainChunk(" ".repeat(SLOT_WIDTH))],
      [colorChunk(centerText(label, SLOT_WIDTH), labelColor)],
      [colorChunk(centerText(statusText, SLOT_WIDTH), statusColor)],
    ];
  }

  /**
   * Builds 1 side (party or enemy row) of the battlefield from its units.
   * Sprites are composited (not just concatenated) so a sprite wider than
   * SLOT_WIDTH bleeds into its neighbors' slots instead of corrupting the
   * layout — see compositeSpriteRow. The label/status rows stay simple
   * side-by-side text, since they're always exactly SLOT_WIDTH.
   */
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

  /** Pixel-art frame (docs: 1 pixel = 1 cell, units <=10px tall, boss <=13px): party on the left, current room's monsters/boss on the right. */
  private renderBattlefield(): TextChunk[][] {
    const s = this.game.state;

    const partyUnits = s.party.map((c) => {
      const style = CLASS_STYLE[c.classId] ?? { abbr: "??", color: PALETTE.dim };
      if (!c.isAlive) return { sprite: TOMBSTONE_SPRITE, label: style.abbr, labelColor: PALETTE.dead, statusText: t("ui.fallen"), statusColor: PALETTE.dead };
      const sprite = spriteForClass(c.classId);
      return { sprite, label: style.abbr, labelColor: style.color, statusText: `${c.hp}/${c.maxHp}`, statusColor: hpColorFor(c.hp, c.maxHp) };
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
          const style = monsterStyle(m);
          if (m.hp <= 0) return { sprite: TOMBSTONE_SPRITE, label: style.abbr, labelColor: PALETTE.dead, statusText: t("ui.defeated"), statusColor: PALETTE.dead };
          const sprite = spriteForMonster(m.archetypeId, m.tier);
          return { sprite, label: style.abbr, labelColor: style.color, statusText: `${m.hp}/${m.maxHp}`, statusColor: hpColorFor(m.hp, m.maxHp) };
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
          ? [colorChunk(centerText("vs", DIVIDER_WIDTH), PALETTE.dim)]
          : [plainChunk(" ".repeat(DIVIDER_WIDTH))]
      );
    }

    return mergeBlocksHorizontally([partyBlock, divider, enemyBlock], SLOT_GAP);
  }

  private renderMonsterLines(): TextChunk[][] {
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
      const style = monsterStyle(m);
      if (m.hp <= 0) {
        lines.push([chip(style.abbr, PALETTE.dead), plainChunk(t("ui.monsterDefeatedSuffix", { name: m.name }))]);
        continue;
      }
      lines.push([
        chip(style.abbr, style.color),
        plainChunk(` ${m.name}`),
        plainChunk("\n   "),
        colorChunk(`HP ${m.hp}/${m.maxHp}`, hpColorFor(m.hp, m.maxHp)),
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
          lines.push(t("ui.equipOption", { i, name: a.name, rarity: a.rarity, desc: truncateText(a.description, 40) }));
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

      case "pickCharacterForArtifact": {
        const artifact = getArtifact(this.ui.artifactId);
        const lines = [t("ui.equipPrompt", { artifact: artifact.name })];
        s.party.forEach((c, i) => lines.push(`  [${i + 1}] ${c.name} (${c.equippedArtifactIds.length}/${MAX_EQUIPPED_ARTIFACTS} slot)`));
        return lines.join("\n");
      }

      case "pickItemOutOfCombat": {
        const lines = [t("ui.chooseItemToUse")];
        inventoryEntries(s.inventory).forEach(({ item, qty }, i) => {
          lines.push(`  [${i + 1}] ${item.name} x${qty} — ${truncateText(item.description, 40)}`);
        });
        return lines.join("\n");
      }

      case "pickItemTargetOutOfCombat": {
        const lines = [t("ui.chooseCharacterForItem", { item: this.ui.item.name })];
        s.party
          .filter((c) => c.isAlive)
          .forEach((c, i) => lines.push(`  [${i + 1}] ${c.name} (${c.hp}/${c.maxHp} HP)`));
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
          // Raw damage before the target's defense is subtracted (see resolver.ts's damage
          // formula) — only shown for skills with a plain damage effect, skipped for the 2
          // dual-relation skills since their effect depends on which side the target is on.
          const dmgEffect = sk.effects?.find((e) => e.kind === "damage");
          const dmgSuffix = dmgEffect ? `, ~${Math.max(1, Math.round((dmgEffect.amount ?? 0) + actor.attack))} dmg` : "";
          const head = `  [${i + 1}] ${sk.name} (MP ${sk.mpCost}${usesSuffix}${dmgSuffix})`;
          if (unusable) {
            // The reason (cooldown/MP status) replaces the description here rather than
            // trailing after it — the main panel can be quite narrow, and the reason is
            // the more important thing to see when a skill can't be used right now.
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
          lines.push(`  [${i + 1}] ${item.name} x${qty} — ${truncateText(item.description, 40)}`);
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
          const hpInfo = "hp" in target ? ` (${target.hp}/${target.maxHp} HP)` : "";
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
        s.party.forEach((c, i) => lines.push(`  [${i + 1}] ${c.name} (${c.hp}/${c.maxHp} HP)`));
        return lines.join("\n");
      }

      case "eventCursedShrine": {
        const artifactId = s.activeEvent?.offerArtifactIds[0];
        const a = artifactId ? getArtifact(artifactId) : null;
        const curseTag = a?.isCursed ? " ⚠ CURSED" : "";
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
        s.party.forEach((c, i) => lines.push(`  [${i + 1}] ${c.name} (${c.equippedArtifactIds.length}/${MAX_EQUIPPED_ARTIFACTS} slot)`));
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
        s.party.forEach((c, i) => lines.push(`  [${i + 1}] ${c.name} (${c.hp}/${c.maxHp} HP)`));
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
        // Compile-time exhaustiveness check: a UiState kind added without a case here
        // fails to build instead of silently falling through to a blank main panel.
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
      case "pickItemTargetOutOfCombat":
        return t("ui.footerChooseCharacterEsc");
      case "artifactMenu":
        return t("ui.footerEquipUnequipEsc");
      case "pickCharacterForArtifact":
        return t("ui.footerChooseCharacterEsc");
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
