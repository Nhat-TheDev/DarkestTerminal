import type { CombatantRef, GameState, SkillTarget, Id, ArtifactRarity, LogEntry, Monster } from "../types";
import { CLASSES, getClass } from "../data/classes";
import { createFloor } from "../data/floor";
import {
  createCharacter,
  applyPartyExp,
  recomputeCharacterStats,
  equipArtifact as equipArtifactOnCharacter,
  unequipArtifact as unequipArtifactFromCharacter,
  MAX_EQUIPPED_ARTIFACTS,
  type PartyActionError,
} from "./party";
import { restEatDrink, restChat } from "./survival";
import { Rng } from "./rng";
import {
  type EngineContext,
  autoResolveTargets,
  queueAction,
  queueItemAction,
  allLivingCharactersHaveQueuedActions,
  resolveRound,
  startCombat,
  type QueueActionError,
  livingMonsterRefs,
  livingCharacterRefs,
} from "./combat";
import { getRoom, moveToRoom, connectedRooms } from "./dungeon";
import { tickSurvivalOnAction } from "./survival";
import { getItem, rollItemDrop } from "../data/items";
import { getArtifact, rollArtifact, rollArtifactWithMinRarity, pickArtifactOfRarity } from "../data/artifacts";
import { totalExpBoostPercent } from "./artifacts";
import { resolveSkillEffect } from "./resolver";
import { getEvent } from "../data/events";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";

export const MERCHANT_PRICE_PERCENT: Record<ArtifactRarity, number> = BALANCE.events.merchantPricePercent;
export const BLOOD_ALTAR_HP_PERCENT = BALANCE.events.bloodAltarHpPercent;
export const COLLAPSED_FLOOR_HP_PERCENT = BALANCE.events.collapsedFloorHpPercent;
const COLLAPSED_FLOOR_SUCCESS_CHANCE = BALANCE.events.collapsedFloorSuccessChance;

export class Game {
  readonly ctx: EngineContext;
  readonly state: GameState;

  constructor(seed = Date.now(), classIds?: Id[], restore?: { state: GameState; monsters: Monster[]; rngState: number }) {
    const rng = new Rng(seed);
    if (restore) {
      rng.setState(restore.rngState);
      this.ctx = { party: restore.state.party, monsters: restore.monsters, rng, inventory: restore.state.inventory };
      this.state = restore.state;
      return;
    }
    const { floor, monsters } = createFloor(rng);
    const classes = classIds ? classIds.map((id) => getClass(id)) : CLASSES;
    const party = classes.map((cls, i) => createCharacter(`p${i + 1}`, cls.name, cls));
    const inventory: Record<Id, number> = {};
    this.ctx = { party, monsters, rng, inventory };
    this.state = {
      party,
      floor,
      currentRoomId: floor.entryRoomId,
      combat: null,
      message: t("game.enteredRoom", { room: getRoom(floor, floor.entryRoomId).name }),
      gameOver: null,
      partyExp: 0,
      inventory,
      unequippedArtifactIds: [],
      activeEvent: null,
      lastRoomDrops: null,
    };
    this.checkEntryRoomAmbush();
  }

  private checkEntryRoomAmbush(): void {
    const room = getRoom(this.state.floor, this.state.currentRoomId);
    const hasLiving = room.monsterIds.some((id) => (this.ctx.monsters.find((m) => m.id === id)?.hp ?? 0) > 0);
    if (hasLiving && !room.cleared) {
      this.state.combat = startCombat(room.id, room.monsterIds, this.ctx, room.type === "boss");
      this.state.message = t("dungeon.ambush", { room: room.name });
    }
  }

  connectedRoomChoices() {
    return connectedRooms(this.state.floor, this.state.currentRoomId);
  }

  move(targetRoomId: string): void {
    if (this.state.combat && this.state.combat.phase !== "over") {
      this.state.message = t("errors.combatInProgress");
      return;
    }
    moveToRoom(this.state, targetRoomId, this.ctx);
    this.postMoveCheck();
  }

  private postMoveCheck(): void {
    if (this.state.party.every((c) => !c.isAlive)) {
      this.state.gameOver = "defeat";
    }
  }

  restAction(choice: "eat" | "chat" | "skip"): void {
    const room = getRoom(this.state.floor, this.state.currentRoomId);
    if (room.type !== "rest" || room.cleared) return;
    if (choice === "eat") {
      for (const c of this.state.party) restEatDrink(c);
      this.state.message = t("game.restEat");
    } else if (choice === "chat") {
      for (const c of this.state.party) restChat(c);
      this.state.message = t("game.restChat");
    } else {
      this.state.message = t("game.restSkip");
    }
    room.cleared = true;
  }

  autoTargets(target: SkillTarget, actor: CombatantRef): CombatantRef[] | null {
    if (!this.state.combat) return null;
    return autoResolveTargets(target, actor, this.state.combat, this.ctx);
  }

  livingEnemyRefs(): CombatantRef[] {
    if (!this.state.combat) return [];
    return livingMonsterRefs(this.state.combat, this.ctx);
  }

  livingAllyRefs(): CombatantRef[] {
    if (!this.state.combat) return [];
    return livingCharacterRefs(this.state.combat, this.ctx);
  }

  queue(actorRef: CombatantRef, skillId: string, targets: CombatantRef[]): QueueActionError | null {
    if (!this.state.combat) return { reason: t("errors.notInCombat") };
    return queueAction(this.state.combat, actorRef, skillId, targets, this.ctx);
  }

  queueItem(actorRef: CombatantRef, itemId: Id, targets: CombatantRef[]): QueueActionError | null {
    if (!this.state.combat) return { reason: t("errors.notInCombat") };
    return queueItemAction(this.state.combat, actorRef, itemId, targets, this.ctx);
  }

  useItemOutOfCombat(itemId: Id, characterId?: Id): QueueActionError | null {
    const item = getItem(itemId);
    if ((this.state.inventory[itemId] ?? 0) <= 0) return { reason: t("errors.noItem") };
    if (item.target === "singleEnemy") return { reason: t("errors.itemNotUsableOutOfCombat") };

    const log: LogEntry[] = [];
    const applyTo = (character: (typeof this.state.party)[number]) => {
      for (const effect of item.effects) resolveSkillEffect(effect, character, character, { log });
    };

    if (item.target === "allAllies") {
      for (const c of this.state.party) if (c.isAlive) applyTo(c);
    } else {
      const character = this.state.party.find((c) => c.id === characterId && c.isAlive);
      if (!character) return { reason: t("errors.needLivingCharacter") };
      applyTo(character);
    }

    this.state.inventory[itemId] = (this.state.inventory[itemId] ?? 0) - 1;
    this.state.message = log.length > 0 ? log.map((entry) => entry.text).join(" ") : t("game.usedItem", { item: item.name });
    return null;
  }

  readyToResolve(): boolean {
    if (!this.state.combat) return false;
    return allLivingCharactersHaveQueuedActions(this.state.combat, this.ctx);
  }

  equipArtifact(characterId: Id, artifactId: Id): PartyActionError | null {
    return equipArtifactOnCharacter(this.state, characterId, artifactId);
  }

  unequipArtifact(characterId: Id, artifactId: Id): PartyActionError | null {
    return unequipArtifactFromCharacter(this.state, characterId, artifactId);
  }

  private payHpPercent(character: (typeof this.state.party)[number], percent: number): number | null {
    const cost = Math.floor((character.maxHp * percent) / 100);
    if (cost >= character.hp) return null;
    character.hp -= cost;
    return cost;
  }

  private closeEvent(): void {
    getRoom(this.state.floor, this.state.currentRoomId).cleared = true;
    this.state.activeEvent = null;
  }

  merchantPurchase(offerIndex: number, payerCharacterId: Id): PartyActionError | null {
    const active = this.state.activeEvent;
    if (!active || active.eventId !== "merchant") return { reason: t("errors.noActiveTrade") };
    const artifactId = active.offerArtifactIds[offerIndex];
    if (!artifactId) return { reason: t("errors.noSuchOffer") };
    const payer = this.state.party.find((c) => c.id === payerCharacterId);
    if (!payer) return { reason: t("errors.characterNotFound") };
    const cost = this.payHpPercent(payer, MERCHANT_PRICE_PERCENT[getArtifact(artifactId).rarity]);
    if (cost === null) return { reason: t("errors.notEnoughHpToPay") };
    this.state.unequippedArtifactIds.push(artifactId);
    this.state.message = t("game.paidHpForArtifact", { payer: payer.name, cost, artifact: getArtifact(artifactId).name });
    this.closeEvent();
    return null;
  }

  merchantLeave(): void {
    this.state.message = t("game.leftEmptyHanded");
    this.closeEvent();
  }

  bloodAltarPay(characterId: Id): PartyActionError | null {
    const character = this.state.party.find((c) => c.id === characterId);
    if (!character) return { reason: t("errors.characterNotFound") };
    const cost = this.payHpPercent(character, BLOOD_ALTAR_HP_PERCENT);
    if (cost === null) return { reason: t("errors.notEnoughHpToPay") };
    const artifactId = rollArtifact("treasureOrEvent", this.ctx.rng);
    this.state.unequippedArtifactIds.push(artifactId);
    this.state.message = t("game.paidHpForArtifact", { payer: character.name, cost, artifact: getArtifact(artifactId).name });
    this.closeEvent();
    return null;
  }

  bloodAltarLeave(): void {
    this.state.message = t("game.leftWithoutPaying");
    this.closeEvent();
  }

  cursedShrineDecide(accept: boolean): PartyActionError | null {
    const active = this.state.activeEvent;
    if (!active || active.eventId !== "cursed-shrine") return { reason: t("errors.nothingToDecide") };
    const artifactId = active.offerArtifactIds[0]!;
    if (accept) {
      this.state.unequippedArtifactIds.push(artifactId);
      this.state.message = t("game.receivedArtifact", { artifact: getArtifact(artifactId).name });
    } else {
      this.state.message = t("game.declinedLeft");
    }
    this.closeEvent();
    return null;
  }

  twinAltarsChoose(offerIndex: 0 | 1, characterId: Id, unequipArtifactId?: Id): PartyActionError | null {
    const active = this.state.activeEvent;
    if (!active || active.eventId !== "twin-altars") return { reason: t("errors.noActiveChoice") };
    const artifactId = active.offerArtifactIds[offerIndex];
    if (!artifactId) return { reason: t("errors.noSuchOffer") };
    const character = this.state.party.find((c) => c.id === characterId);
    if (!character) return { reason: t("errors.characterNotFound") };

    this.state.unequippedArtifactIds.push(artifactId);
    if (character.equippedArtifactIds.length >= MAX_EQUIPPED_ARTIFACTS) {
      if (!unequipArtifactId) return { reason: t("errors.needUnequipFirst") };
      const unequipErr = unequipArtifactFromCharacter(this.state, characterId, unequipArtifactId);
      if (unequipErr) return unequipErr;
    }
    const equipErr = equipArtifactOnCharacter(this.state, characterId, artifactId);
    if (equipErr) return equipErr;
    this.state.message = t("game.equippedImmediately", { character: character.name, artifact: getArtifact(artifactId).name });
    this.closeEvent();
    return null;
  }

  sacrifice(sacrificeArtifactId: Id): PartyActionError | null {
    const owner = this.state.party.find((c) => c.equippedArtifactIds.includes(sacrificeArtifactId));
    if (owner) {
      const err = unequipArtifactFromCharacter(this.state, owner.id, sacrificeArtifactId);
      if (err) return err;
    }
    const idx = this.state.unequippedArtifactIds.indexOf(sacrificeArtifactId);
    if (idx === -1) return { reason: t("errors.artifactNotOwned") };
    const rarity = getArtifact(sacrificeArtifactId).rarity;
    this.state.unequippedArtifactIds.splice(idx, 1);
    const newArtifactId = rollArtifactWithMinRarity(rarity, this.ctx.rng);
    this.state.unequippedArtifactIds.push(newArtifactId);
    this.state.message = t("game.sacrificeResult", { old: getArtifact(sacrificeArtifactId).name, new: getArtifact(newArtifactId).name });
    return null;
  }

  sacrificeLeave(): void {
    this.state.message = t("game.leftRitual");
    this.closeEvent();
  }

  gamblingDenBet(artifactId: Id): PartyActionError | null {
    const idx = this.state.unequippedArtifactIds.indexOf(artifactId);
    if (idx === -1) return { reason: t("errors.artifactMustBeUnequippedToBet") };
    const rarity = getArtifact(artifactId).rarity;
    if (this.ctx.rng.chance(0.5)) {
      const wonArtifactId = pickArtifactOfRarity(rarity, this.ctx.rng);
      this.state.unequippedArtifactIds.push(wonArtifactId);
      this.state.message = t("game.gambleWin", { artifact: getArtifact(wonArtifactId).name });
    } else {
      this.state.unequippedArtifactIds.splice(idx, 1);
      this.state.message = t("game.gambleLose", { artifact: getArtifact(artifactId).name });
    }
    this.closeEvent();
    return null;
  }

  gamblingDenLeave(): void {
    this.state.message = t("game.leftNoBet");
    this.closeEvent();
  }

  hermitRemoveCurse(characterId: Id, artifactId: Id): PartyActionError | null {
    const character = this.state.party.find((c) => c.id === characterId);
    if (!character) return { reason: t("errors.characterNotFound") };
    if (!getArtifact(artifactId).isCursed) return { reason: t("errors.artifactNotCursed") };
    const idx = character.equippedArtifactIds.indexOf(artifactId);
    if (idx === -1) return { reason: t("errors.artifactNotEquippedOnCharacter") };
    character.equippedArtifactIds.splice(idx, 1);
    recomputeCharacterStats(character);
    this.state.message = t("game.curseRemoved", { artifact: getArtifact(artifactId).name, character: character.name });
    this.closeEvent();
    return null;
  }

  hermitRerollFortune(artifactId: Id): PartyActionError | null {
    const owner = this.state.party.find((c) => c.equippedArtifactIds.includes(artifactId));
    if (owner) {
      const err = unequipArtifactFromCharacter(this.state, owner.id, artifactId);
      if (err) return err;
    }
    const idx = this.state.unequippedArtifactIds.indexOf(artifactId);
    if (idx === -1) return { reason: t("errors.artifactNotOwned") };
    this.state.unequippedArtifactIds.splice(idx, 1);
    const newArtifactId = rollArtifact("treasureOrEvent", this.ctx.rng);
    this.state.unequippedArtifactIds.push(newArtifactId);
    this.state.message = t("game.fortuneTraded", { old: getArtifact(artifactId).name, new: getArtifact(newArtifactId).name });
    this.closeEvent();
    return null;
  }

  hermitLeave(): void {
    this.state.message = t("game.leftGeneric");
    this.closeEvent();
  }

  collapsedFloorAttempt(characterId: Id): PartyActionError | null {
    const character = this.state.party.find((c) => c.id === characterId);
    if (!character) return { reason: t("errors.characterNotFound") };
    const cost = this.payHpPercent(character, COLLAPSED_FLOOR_HP_PERCENT);
    if (cost === null) return { reason: t("errors.notEnoughHpToPay") };
    if (this.ctx.rng.chance(COLLAPSED_FLOOR_SUCCESS_CHANCE)) {
      const artifactId = rollArtifact("boss", this.ctx.rng);
      this.state.unequippedArtifactIds.push(artifactId);
      this.state.message = t("game.collapsedFloorSuccess", { character: character.name, cost, artifact: getArtifact(artifactId).name });
    } else {
      this.state.message = t("game.collapsedFloorFail", { character: character.name, cost });
    }
    this.closeEvent();
    return null;
  }

  collapsedFloorLeave(): void {
    this.state.message = t("game.skippedAttempt");
    this.closeEvent();
  }

  resolve(): void {
    if (!this.state.combat) return;
    resolveRound(this.state.combat, this.ctx, this.state.floor.depth);
    for (const c of this.state.party) {
      if (c.isAlive) tickSurvivalOnAction(c, this.state.combat.log);
    }
    if (this.state.combat.phase === "over") {
      if (this.state.combat.outcome === "victory") {
        const room = getRoom(this.state.floor, this.state.combat.roomId);
        room.cleared = true;
        const baseExpGained = room.monsterIds.reduce((sum, id) => sum + (this.ctx.monsters.find((m) => m.id === id)?.expReward ?? 0), 0);
        const expGained = Math.round(baseExpGained * (1 + totalExpBoostPercent(this.state.party) / 100));
        const levelBefore = this.state.party[0]?.level ?? 1;
        applyPartyExp(this.state, expGained);
        this.state.combat.log.push({ text: t("game.expGained", { amount: expGained }), kind: "info" });
        const levelAfter = this.state.party[0]?.level ?? levelBefore;
        if (levelAfter > levelBefore) this.state.combat.log.push({ text: t("game.leveledUp", { level: levelAfter }), kind: "info" });
        const droppedItemIds: Id[] = [];
        const droppedArtifactIds: Id[] = [];
        for (const id of room.monsterIds) {
          const monster = this.ctx.monsters.find((m) => m.id === id);
          if (!monster) continue;
          const itemId = rollItemDrop(monster.archetypeId, this.ctx.rng, this.state.floor.depth);
          if (itemId) {
            this.state.inventory[itemId] = (this.state.inventory[itemId] ?? 0) + 1;
            droppedItemIds.push(itemId);
          }
          if (monster.tier === "elite" || monster.tier === "boss") {
            const artifactId = rollArtifact(monster.tier, this.ctx.rng);
            this.state.unequippedArtifactIds.push(artifactId);
            droppedArtifactIds.push(artifactId);
          }
        }
        if (room.type === "event" && room.rolledEventId && getEvent(room.rolledEventId).kind === "combatReward") {
          const artifactId = rollArtifact("treasureOrEvent", this.ctx.rng);
          this.state.unequippedArtifactIds.push(artifactId);
          droppedArtifactIds.push(artifactId);
        }
        this.state.lastRoomDrops = droppedItemIds.length > 0 || droppedArtifactIds.length > 0 ? { itemIds: droppedItemIds, artifactIds: droppedArtifactIds } : null;
      } else if (this.state.combat.outcome === "defeat") {
        this.state.gameOver = "defeat";
      }
    }
    this.postMoveCheck();
  }

  advanceToNextFloor(): void {
    const nextDepth = this.state.floor.depth + 1;
    const { floor, monsters } = createFloor(this.ctx.rng, nextDepth);
    this.ctx.monsters = monsters;
    this.state.floor = floor;
    this.state.currentRoomId = floor.entryRoomId;
    this.state.message = t("game.nextFloor", { depth: nextDepth });
    this.checkEntryRoomAmbush();
  }

  clearFinishedCombat(): boolean {
    if (this.state.combat?.phase !== "over") return false;
    const wasBossRoomVictory = this.state.combat.outcome === "victory" && getRoom(this.state.floor, this.state.combat.roomId).type === "boss";
    this.state.combat = null;
    return wasBossRoomVictory;
  }

  className(classId: string): string {
    return getClass(classId).name;
  }
}
