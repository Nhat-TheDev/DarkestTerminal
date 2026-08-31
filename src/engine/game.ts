import { randomUUID } from "node:crypto";
import type { CombatantRef, GameState, SkillTarget, Id, LogEntry, Monster } from "../types";
import { CLASSES, getClass } from "../data/classes";
import { createFloor } from "../data/floor";
import { createCharacter, applyPartyExp, resolveArtifactEquip, discardPendingArtifact, grantArtifact, recomputeAllPartyStats, type PartyActionError } from "./party";
import { restEatDrink, restEatDrinkSatiety, restChat, campAction, drainSatiety, SATIETY_DRAIN_COMBAT } from "./survival";
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
import { getItem, rollItemDrop } from "../data/items";
import { rollArtifact } from "../data/artifacts";
import { rollCoinDrop } from "../data/currency";
import { totalExpBoostPercent } from "./artifacts";
import { resolveSkillEffect, expireStatusEffect, isHelpfulStatusEffect } from "./resolver";
import { getStatusEffect } from "../data/statusEffects";
import { getEvent } from "../data/events";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";
import { merchantPurchase, merchantRefresh, merchantLeave, MERCHANT_PRICE_COINS } from "./events/merchant";
import { bloodAltarPay, bloodAltarLeave, BLOOD_ALTAR_HP_PERCENT } from "./events/bloodAltar";
import { cursedShrineDecide } from "./events/cursedShrine";
import { twinAltarsChoose } from "./events/twinAltars";
import { sacrifice, sacrificeLeave } from "./events/sacrifice";
import { gamblingDenEnter, gamblingDenContinue, gamblingDenStop, gamblingDenLeave } from "./events/gamblingDen";
import { hermitExchangeFortune, hermitLeave } from "./events/hermit";
import { guardianFightEnter, guardianFightSkip } from "./events/guardianFight";
import { collapsedFloorAttempt, collapsedFloorLeave, COLLAPSED_FLOOR_HP_PERCENT } from "./events/collapsedFloor";

export { MERCHANT_PRICE_COINS, BLOOD_ALTAR_HP_PERCENT, COLLAPSED_FLOOR_HP_PERCENT };

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
    const inventory: Record<Id, number> = { "exploration-kit": BALANCE.party.startingExplorationKits };
    this.ctx = { party, monsters, rng, inventory };
    this.state = {
      runId: randomUUID(),
      party,
      floor,
      currentRoomId: floor.entryRoomId,
      combat: null,
      message: t("game.enteredRoom", { room: getRoom(floor, floor.entryRoomId).name }),
      gameOver: null,
      partyExp: 0,
      inventory,
      coins: 0,
      satiety: BALANCE.survival.initialSatiety,
      pendingArtifactDecision: null,
      secondJackpotArtifactId: null,
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

  // Sole place gameOver becomes "defeat" — App reacts here to invalidate this run's saves (permadeath).
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
      restEatDrinkSatiety(this.state);
      recomputeAllPartyStats(this.state);
      this.state.message = t("game.restEat");
    } else if (choice === "chat") {
      for (const c of this.state.party) restChat(c);
      this.state.message = t("game.restChat");
    } else {
      this.state.message = t("game.restSkip");
    }
    room.cleared = true;
  }

  camp(): PartyActionError | null {
    const err = campAction(this.state);
    if (err) return err;
    recomputeAllPartyStats(this.state);
    return null;
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
    // `satiety` effects are party-wide (GameState-scoped, not per-character) — for an "allAllies" item,
    // applying them once per living character would multiply the effect by party size. Apply those once;
    // apply every other effect per character as usual.
    const partyWideEffects = item.effects.filter((e) => e.kind === "modifyStat" && e.stat === "satiety");
    const perCharacterEffects = item.effects.filter((e) => !(e.kind === "modifyStat" && e.stat === "satiety"));
    const applyTo = (character: (typeof this.state.party)[number]) => {
      for (const effect of perCharacterEffects) resolveSkillEffect(effect, character, character, { log, gameState: this.state });
    };

    if (item.target === "allAllies") {
      for (const c of this.state.party) if (c.isAlive) applyTo(c);
      const anyAlive = this.state.party.find((c) => c.isAlive);
      if (anyAlive) for (const effect of partyWideEffects) resolveSkillEffect(effect, anyAlive, anyAlive, { log, gameState: this.state });
    } else {
      const character = this.state.party.find((c) => c.id === characterId && c.isAlive);
      if (!character) return { reason: t("errors.needLivingCharacter") };
      applyTo(character);
      for (const effect of partyWideEffects) resolveSkillEffect(effect, character, character, { log, gameState: this.state });
    }

    this.state.inventory[itemId] = (this.state.inventory[itemId] ?? 0) - 1;
    this.state.message = log.length > 0 ? log.map((entry) => entry.text).join(" ") : t("game.usedItem", { item: item.name });
    return null;
  }

  readyToResolve(): boolean {
    if (!this.state.combat) return false;
    return allLivingCharactersHaveQueuedActions(this.state.combat, this.ctx);
  }

  resolveArtifactEquip(characterId: Id, replaceArtifactId?: Id): PartyActionError | null {
    return resolveArtifactEquip(this.state, characterId, replaceArtifactId);
  }

  discardPendingArtifact(): PartyActionError | null {
    return discardPendingArtifact(this.state);
  }

  merchantPurchase(offerIndex: number): PartyActionError | null {
    return merchantPurchase(this.state, offerIndex);
  }

  merchantRefresh(): PartyActionError | null {
    return merchantRefresh(this.state, this.ctx);
  }

  merchantLeave(): void {
    merchantLeave(this.state);
  }

  bloodAltarPay(characterId: Id): PartyActionError | null {
    return bloodAltarPay(this.state, this.ctx, characterId);
  }

  bloodAltarLeave(): void {
    bloodAltarLeave(this.state);
  }

  cursedShrineDecide(accept: boolean): PartyActionError | null {
    return cursedShrineDecide(this.state, accept);
  }

  twinAltarsChoose(offerIndex: 0 | 1): PartyActionError | null {
    return twinAltarsChoose(this.state, offerIndex);
  }

  sacrifice(sacrificeArtifactId: Id): PartyActionError | null {
    return sacrifice(this.state, this.ctx, sacrificeArtifactId);
  }

  sacrificeLeave(): void {
    sacrificeLeave(this.state);
  }

  gamblingDenEnter(): PartyActionError | null {
    return gamblingDenEnter(this.state, this.ctx);
  }

  gamblingDenContinue(): PartyActionError | null {
    return gamblingDenContinue(this.state, this.ctx);
  }

  gamblingDenStop(): PartyActionError | null {
    return gamblingDenStop(this.state);
  }

  gamblingDenLeave(): void {
    gamblingDenLeave(this.state);
  }

  hermitExchangeFortune(artifactId: Id): PartyActionError | null {
    return hermitExchangeFortune(this.state, this.ctx, artifactId);
  }

  hermitLeave(): void {
    hermitLeave(this.state);
  }

  collapsedFloorAttempt(characterId: Id): PartyActionError | null {
    return collapsedFloorAttempt(this.state, this.ctx, characterId);
  }

  collapsedFloorLeave(): void {
    collapsedFloorLeave(this.state);
  }

  enterGuardianFight(): PartyActionError | null {
    return guardianFightEnter(this.state, this.ctx);
  }

  skipGuardianFight(): PartyActionError | null {
    return guardianFightSkip(this.state);
  }

  resolve(): void {
    if (!this.state.combat) return;
    resolveRound(this.state.combat, this.ctx, this.state.floor.depth, this.state.satiety);
    if (this.state.combat.phase === "over") {
      if (this.state.combat.outcome === "victory") {
        const room = getRoom(this.state.floor, this.state.combat.roomId);
        room.cleared = true;
        // Buffs don't carry past a cleared room — debuffs do, and keep ticking down into the next fight.
        for (const c of this.state.party) {
          if (!c.isAlive) continue;
          for (const active of [...c.activeStatusEffects]) {
            if (isHelpfulStatusEffect(getStatusEffect(active.statusEffectId))) {
              expireStatusEffect(c, active, { log: this.state.combat.log });
            }
          }
        }
        drainSatiety(this.state, SATIETY_DRAIN_COMBAT, this.state.combat.log);
        recomputeAllPartyStats(this.state);
        const baseExpGained = room.monsterIds.reduce((sum, id) => sum + (this.ctx.monsters.find((m) => m.id === id)?.expReward ?? 0), 0);
        const expGained = Math.round(baseExpGained * (1 + totalExpBoostPercent(this.state.party) / 100));
        const levelBefore = this.state.party[0]?.level ?? 1;
        applyPartyExp(this.state, expGained);
        this.state.combat.log.push({ text: t("game.expGained", { amount: expGained }), kind: "info" });
        const levelAfter = this.state.party[0]?.level ?? levelBefore;
        if (levelAfter > levelBefore) this.state.combat.log.push({ text: t("game.leveledUp", { level: levelAfter }), kind: "info" });
        const droppedItemIds: Id[] = [];
        const droppedArtifactIds: Id[] = [];
        let coinsGained = 0;
        for (const id of room.monsterIds) {
          const monster = this.ctx.monsters.find((m) => m.id === id);
          if (!monster) continue;
          coinsGained += rollCoinDrop(monster, this.ctx.rng);
          const itemId = rollItemDrop(monster.archetypeId, this.ctx.rng, this.state.floor.depth);
          if (itemId) {
            this.state.inventory[itemId] = (this.state.inventory[itemId] ?? 0) + 1;
            droppedItemIds.push(itemId);
          }
          if (monster.tier === "elite" || monster.tier === "boss") {
            const artifactId = rollArtifact(monster.tier, this.ctx.rng);
            grantArtifact(this.state, artifactId, monster.tier);
            droppedArtifactIds.push(artifactId);
          }
        }
        if (coinsGained > 0) {
          this.state.coins += coinsGained;
          this.state.combat.log.push({ text: t("game.coinsEarned", { amount: coinsGained }), kind: "info" });
        }
        if (room.type === "event" && room.rolledEventId && getEvent(room.rolledEventId).kind === "combatReward") {
          const artifactId = rollArtifact("treasureOrEvent", this.ctx.rng);
          grantArtifact(this.state, artifactId, "event");
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
