import { randomUUID } from "node:crypto";
import type { CombatantRef, GameState, SkillTarget, Id, LogEntry, Monster } from "../types";
import { CLASSES, getClass } from "../data/classes";
import { createFloor } from "../data/floor";
import {
  ENDING_CHECKPOINT_FLOOR_DEPTH,
  endingCheckpointMode,
  hasWaystoneShardEquipped,
  FOUNDER_FLOOR_DEPTH,
  FOUNDER_VICTORY_REMOVED_EVENT_IDS,
} from "../data/endings";
import { spawnMonster } from "../data/monsters";
import { loadProfile, addRetiredCharacter } from "./profile";
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
  snapshotCombatants,
  tagLogRange,
  tagPartySnapshotRange,
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
import { openChest } from "./events/openChest";
import { merchantPurchase, merchantRefresh, merchantLeave, MERCHANT_PRICE_COINS } from "./events/merchant";
import { bloodAltarPay, bloodAltarLeave, BLOOD_ALTAR_HP_PERCENT } from "./events/bloodAltar";
import { cursedShrineDecide } from "./events/cursedShrine";
import { twinAltarsChoose } from "./events/twinAltars";
import { sacrifice, sacrificeLeave } from "./events/sacrifice";
import { gamblingDenEnter, gamblingDenContinue, gamblingDenStop, gamblingDenLeave } from "./events/gamblingDen";
import { hermitExchangeFortune, hermitLeave } from "./events/hermit";
import { guardianFightEnter, guardianFightSkip } from "./events/guardianFight";
import { collapsedFloorAttempt, collapsedFloorLeave, COLLAPSED_FLOOR_HP_PERCENT } from "./events/collapsedFloor";
import { maybeTriggerReflection } from "./events/shared";

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
    // Part F.2's persistence layer — read once per fresh run. Eligibility (and therefore whether
    // "the-one-who-stayed" can ever roll this run) is entirely encoded by whether its id starts
    // pre-inserted into firedOnceEventIds below; no other code needs to know why.
    const profile = loadProfile();
    const retiredCharacter = profile.retiredCharacters.at(-1);
    const retiredCharacterEventEligible = retiredCharacter !== undefined && !profile.shownRetiredCharacterEvent;
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
      metNarrativeNpcIds: [],
      narrativeCounters: { guardianFightsSkipped: 0, artifactsSacrificed: 0, altarPaymentsCount: 0, guardianGrudgeFiredCount: 0, freeRewardsTakenCount: 0 },
      pendingReflection: null,
      eventReflectionStances: {},
      eventOutcomes: {},
      firedOnceEventIds: retiredCharacterEventEligible ? [] : ["the-one-who-stayed"],
      loreExposureCount: 0,
      pendingCampReflectionTier: null,
      campReflectionChoices: {},
      pendingEndingCheckpoint: false,
      continuedPastCheckpoint: false,
      pendingFounderDialogue: false,
      retiredCharacterClassId: retiredCharacterEventEligible ? retiredCharacter.classId : null,
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

  openChest(): PartyActionError | null {
    const err = openChest(this.state, this.ctx);
    maybeTriggerReflection(this.state, this.ctx);
    return err;
  }

  merchantPurchase(offerIndex: number): PartyActionError | null {
    const err = merchantPurchase(this.state, offerIndex);
    maybeTriggerReflection(this.state, this.ctx);
    return err;
  }

  merchantRefresh(): PartyActionError | null {
    return merchantRefresh(this.state, this.ctx);
  }

  merchantLeave(): void {
    merchantLeave(this.state);
    maybeTriggerReflection(this.state, this.ctx);
  }

  bloodAltarPay(characterId: Id): PartyActionError | null {
    const err = bloodAltarPay(this.state, this.ctx, characterId);
    maybeTriggerReflection(this.state, this.ctx);
    return err;
  }

  bloodAltarLeave(): void {
    bloodAltarLeave(this.state);
    maybeTriggerReflection(this.state, this.ctx);
  }

  cursedShrineDecide(accept: boolean): PartyActionError | null {
    const err = cursedShrineDecide(this.state, accept);
    maybeTriggerReflection(this.state, this.ctx);
    return err;
  }

  twinAltarsChoose(offerIndex: 0 | 1): PartyActionError | null {
    const err = twinAltarsChoose(this.state, offerIndex);
    maybeTriggerReflection(this.state, this.ctx);
    return err;
  }

  sacrifice(sacrificeArtifactId: Id): PartyActionError | null {
    return sacrifice(this.state, this.ctx, sacrificeArtifactId);
  }

  sacrificeLeave(): void {
    sacrificeLeave(this.state);
    maybeTriggerReflection(this.state, this.ctx);
  }

  gamblingDenEnter(): PartyActionError | null {
    const err = gamblingDenEnter(this.state, this.ctx);
    maybeTriggerReflection(this.state, this.ctx);
    return err;
  }

  gamblingDenContinue(): PartyActionError | null {
    const err = gamblingDenContinue(this.state, this.ctx);
    maybeTriggerReflection(this.state, this.ctx);
    return err;
  }

  gamblingDenStop(): PartyActionError | null {
    const err = gamblingDenStop(this.state);
    maybeTriggerReflection(this.state, this.ctx);
    return err;
  }

  gamblingDenLeave(): void {
    gamblingDenLeave(this.state);
    maybeTriggerReflection(this.state, this.ctx);
  }

  hermitExchangeFortune(artifactId: Id): PartyActionError | null {
    const err = hermitExchangeFortune(this.state, this.ctx, artifactId);
    maybeTriggerReflection(this.state, this.ctx);
    return err;
  }

  hermitLeave(): void {
    hermitLeave(this.state);
    maybeTriggerReflection(this.state, this.ctx);
  }

  collapsedFloorAttempt(characterId: Id): PartyActionError | null {
    const err = collapsedFloorAttempt(this.state, this.ctx, characterId);
    maybeTriggerReflection(this.state, this.ctx);
    return err;
  }

  collapsedFloorLeave(): void {
    collapsedFloorLeave(this.state);
    maybeTriggerReflection(this.state, this.ctx);
  }

  enterGuardianFight(): PartyActionError | null {
    return guardianFightEnter(this.state, this.ctx);
  }

  skipGuardianFight(): PartyActionError | null {
    const err = guardianFightSkip(this.state);
    maybeTriggerReflection(this.state, this.ctx);
    return err;
  }

  /** §10.5 — resolves `state.pendingReflection`, no reward/mechanical effect. */
  pickReflectionStance(stance: "curious" | "wary" | "dismissive"): void {
    const pending = this.state.pendingReflection;
    if (!pending) return;
    this.state.eventReflectionStances[pending.eventId] = stance;
    this.state.pendingReflection = null;
  }

  /** 03-survival-stats.md's Camp Reflection. Records the choice at the pending tier, clears it, and
      at tier 4 writes the 1 synthetic bridge tag the-wanderer/wandering-hermit's crossEventVariants
      read — the only place Camp Reflection ever touches `eventOutcomes`. */
  pickCampReflectionChoice(choice: 0 | 1 | 2): void {
    const tier = this.state.pendingCampReflectionTier;
    if (tier === null) return;
    this.state.campReflectionChoices[tier] = choice;
    this.state.pendingCampReflectionTier = null;
    if (tier === 4) this.state.eventOutcomes["camp-reflection"] = "unaware";
  }

  resolve(): void {
    if (!this.state.combat) return;
    // Coins/EXP/satiety never change mid-round (only in the reward block below, once combat ends), so
    // this baseline is what the reveal should show for every log line this round produces up front.
    this.state.combat.roundStartPartySnapshot = { coins: this.state.coins, partyExp: this.state.partyExp, satiety: this.state.satiety };
    resolveRound(this.state.combat, this.ctx, this.state.floor.depth, this.state.satiety);
    if (this.state.combat.phase === "over") {
      if (this.state.combat.outcome === "victory") {
        const room = getRoom(this.state.floor, this.state.combat.roomId);
        room.cleared = true;
        const rewardBlockStart = this.state.combat.log.length;
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
            // §F.4 — only a real Boss kill may roll waystone-shard; Collapsed Floor separately
            // rolls this same "boss" rarity table without qualifying (bloodAltar.ts is the only
            // other allowed source, gated on its own condition, not this one).
            const artifactId = rollArtifact(monster.tier, this.ctx.rng, monster.tier === "boss" ? "boss" : undefined);
            grantArtifact(this.state, artifactId);
            droppedArtifactIds.push(artifactId);
          }
        }
        if (coinsGained > 0) {
          this.state.coins += coinsGained;
          this.state.combat.log.push({ text: t("game.coinsEarned", { amount: coinsGained }), kind: "info" });
        }
        if (room.type === "event" && room.rolledEventId && getEvent(room.rolledEventId).kind === "combatReward") {
          const artifactId = rollArtifact("treasureOrEvent", this.ctx.rng);
          grantArtifact(this.state, artifactId);
          droppedArtifactIds.push(artifactId);
          // Part C.1 pair 8 — guardian-fight/desecrated-altar's win path never calls closeEvent()
          // (see the reflection-trigger comment below), so the generic outcome tag is written here
          // instead, at the same point their reflection already gets triggered from.
          this.state.eventOutcomes[room.rolledEventId] = "resolved";
          // Camp Reflection's loreExposureCount (03-survival-stats.md) needs the same stand-in,
          // for the same reason — this win path never reaches closeEvent()'s own increment.
          this.state.loreExposureCount += 1;
        }
        // Part F.5 — defeating the founder permanently removes every Covenant-institution event
        // from the roll pool. No new mechanism needed: rollEvent() already excludes any id present
        // in firedOnceEventIds; this just bulk-inserts all 11 in 1 pass, deduping defensively in
        // case any were already onceLifetime-fired earlier this run.
        if (room.monsterIds.some((id) => this.ctx.monsters.find((m) => m.id === id)?.archetypeId === "the-founder")) {
          for (const id of FOUNDER_VICTORY_REMOVED_EVENT_IDS) {
            if (!this.state.firedOnceEventIds.includes(id)) this.state.firedOnceEventIds.push(id);
          }
        }
        this.state.lastRoomDrops = droppedItemIds.length > 0 || droppedArtifactIds.length > 0 ? { itemIds: droppedItemIds, artifactIds: droppedArtifactIds } : null;
        // The reward block above (buff expiry, satiety drain, EXP/level, coins) is the only place these
        // values change outside resolveRound()'s own per-action tagging — tag it the same way, so the
        // reveal shows coins/EXP/satiety/status exactly when it reaches these lines, not upfront.
        tagLogRange(this.state.combat, rewardBlockStart, snapshotCombatants(this.state.combat, this.ctx));
        tagPartySnapshotRange(this.state.combat, rewardBlockStart, { coins: this.state.coins, partyExp: this.state.partyExp, satiety: this.state.satiety });
        // §10.5 — guardian-fight/desecrated-altar's win path never calls closeEvent() (only Skip
        // does), so this is the only trigger point for their reflection. No-ops for every other
        // combat room (not "event" type, or not a reflection-eligible event).
        maybeTriggerReflection(this.state, this.ctx);
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
    // Part F.1 — a guaranteed, non-rolled story beat the moment floor 100 is reached alive. Blocks
    // everything else (including this same entry room's own ambush check) until resolved via
    // pickEndingChoice(); the entry room's monsters, if any, wait exactly where they are.
    if (nextDepth === ENDING_CHECKPOINT_FLOOR_DEPTH) {
      this.state.pendingEndingCheckpoint = true;
      return;
    }
    // Part F.5 — the founder encounter, guaranteed the same way, only for a party that chose
    // Continue. Never rolled, never repeats (advancing further only ever happens once past it).
    if (nextDepth === FOUNDER_FLOOR_DEPTH && this.state.continuedPastCheckpoint) {
      this.state.pendingFounderDialogue = true;
      return;
    }
    this.checkEntryRoomAmbush();
  }

  /** Part F.1's floor-100 checkpoint. `choice` must match what `endingCheckpointMode()` actually
      offers — an out-of-mode choice is a no-op, same defensive shape as every other pending-state
      picker in this class. */
  pickEndingChoice(choice: "stay" | "letGo" | "leave" | "continue"): void {
    if (!this.state.pendingEndingCheckpoint) return;
    const mode = endingCheckpointMode(this.state);
    if (choice === "leave" && mode !== "leaveOnly") return;
    if (choice === "continue" && mode !== "full") return;
    if ((choice === "stay" || choice === "letGo") && mode === "leaveOnly") return;

    this.state.pendingEndingCheckpoint = false;
    if (choice === "stay") {
      this.state.gameOver = "stay";
      // Part F.2 — which of the party "stays" isn't a choice the spec asks the player to make;
      // picked the same way any other unattributed detail in this run is (via rng), and persisted
      // immediately so a later run can find it regardless of whether this save is ever reopened.
      // Only a living character can stay: the checkpoint fires whenever the party isn't wiped, so
      // it's reachable with some members already dead, and a corpse greeting a later run is wrong.
      const living = this.state.party.filter((c) => c.isAlive);
      addRetiredCharacter(this.ctx.rng.pick(living.length > 0 ? living : this.state.party).classId);
    } else if (choice === "letGo") {
      this.state.gameOver = "letGo";
    } else if (choice === "leave") {
      this.state.gameOver = hasWaystoneShardEquipped(this.state) ? "leaveEscaped" : "leaveAmbushed";
    } else {
      // Continue: floor generation resumes normally toward floor 120 (§F.5) — marked here so
      // advanceToNextFloor() knows to fire the founder encounter once that depth is reached.
      this.state.continuedPastCheckpoint = true;
      this.checkEntryRoomAmbush();
    }
  }

  /** Part F.5 — dismisses the founder's pre-fight dialogue and starts the fight itself: the
      current room becomes a boss room with exactly 1 monster, "the-founder", scaled the same way
      any other Boss-tier monster is (`spawnMonster`'s depth scaling already makes floor 120's
      instance the strongest fight in the game — no bespoke stat multiplier needed). */
  enterFounderFight(): void {
    if (!this.state.pendingFounderDialogue) return;
    this.state.pendingFounderDialogue = false;
    const room = getRoom(this.state.floor, this.state.currentRoomId);
    room.type = "boss";
    room.cleared = false;
    const founder = spawnMonster("the-founder", this.state.floor.depth, { tier: "boss" });
    this.ctx.monsters.push(founder);
    room.monsterIds = [founder.id];
    this.state.combat = startCombat(room.id, room.monsterIds, this.ctx, true);
    this.state.message = t("dungeon.ambush", { room: room.name });
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
