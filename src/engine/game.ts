import { randomUUID } from "node:crypto";
import type { CombatantRef, CommandOrder, GameState, SkillTarget, Id, LogEntry, Monster, Summon, ArtifactRarity } from "../types";
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
import { createCharacter, applyPartyExp, resolveArtifactEquip, discardPendingArtifact, grantArtifact, recomputeAllPartyStats, type PartyActionError } from "./party";
import { restEatDrink, restEatDrinkSatiety, restChat, campAction, drainSatiety, SATIETY_DRAIN_COMBAT } from "./survival";
import { Rng } from "./rng";
import {
  type EngineContext,
  autoResolveTargets,
  queueAction,
  queueItemAction,
  queueCommand,
  allLivingCharactersHaveQueuedActions,
  holdChannel,
  breakChannel,
  resolveRound,
  startCombat,
  type QueueActionError,
  livingTargetableMonsterRefs,
  livingCharacterRefs,
  livingPlayerSideRefs,
  snapshotCombatants,
  tagLogRange,
  tagPartySnapshotRange,
  dismissSummonsAtCombatEnd,
  clearCombatResources,
} from "./combat";
import { getRoom, moveToRoom, connectedRooms } from "./dungeon";
import { getItem, rollItemDrop } from "../data/items";
import { rollArtifact } from "../data/artifacts";
import { ABILITIES, rollAbility, getAbility } from "../data/abilities";
import { rollCoinDrop } from "../data/currency";
import { totalExpBoostPercent } from "./artifacts";
import { loadProfile, saveProfile, unlockAbility, lockAbility, addRetiredCharacter, markRetiredCharacterEventShown } from "./profile";
import { resolveSkillEffect, expireStatusEffect, isHelpfulStatusEffect } from "./resolver";
import { getStatusEffect } from "../data/statusEffects";
import { getEvent } from "../data/events";
import { t } from "../data/strings";
import { FLOOR_MILESTONE_INTERVAL, pickFloorMilestoneOmen } from "../data/floorMilestones";
import { BALANCE } from "../data/balanceConfig";
import { openChest } from "./events/openChest";
import { runnerBuy, runnerRefresh, runnerSell } from "./events/runner";
import { runnerBarter } from "./events/barter";
import { answerGatekeeper, applyBlessing, countBlessedRoom } from "./events/gatekeeper";
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

  public currentSaveSlot: Id | null = null;
  public memoryUnlocked = false;
  public memoryIntroShown = false;
  private readonly playTimeBaseSec: number;
  private readonly sessionStart = Date.now();

  constructor(
    seed = Date.now(),
    classIds?: Id[],
    restore?: { state: GameState; monsters: Monster[]; summons: Summon[]; rngState: number; playTimeSec: number },
    abilityIds?: (Id | null)[],
    /** Holds floor 1's entry ambush until `enterDungeon()`. */
    withGatekeeper = false,
    /** Read before the run starts: the slot's profile decides the opening event pool. */
    saveSlot: Id | null = null
  ) {
    this.currentSaveSlot = saveSlot;
    const profile = loadProfile(saveSlot);
    this.memoryUnlocked = profile.memoryUnlocked;
    this.memoryIntroShown = profile.memoryIntroShown;
    this.playTimeBaseSec = restore?.playTimeSec ?? 0;
    const rng = new Rng(seed);
    if (restore) {
      rng.setState(restore.rngState);
      this.ctx = { party: restore.state.party, monsters: restore.monsters, summons: restore.summons, rng, inventory: restore.state.inventory };
      this.state = restore.state;
      return;
    }
    const { floor, monsters } = createFloor(rng);
    const classes = classIds ? classIds.map((id) => getClass(id)) : CLASSES;
    // No two characters may share an Ability: the death flow relies on each one losing a distinct id.
    // A later duplicate enters the run with nothing equipped.
    const takenAbilityIds = new Set<Id>();
    const party = classes.map((cls, i) => {
      const character = createCharacter(`p${i + 1}`, cls.name, cls);
      const requested = abilityIds?.[i] ?? null;
      character.equippedAbilityId = requested !== null && !takenAbilityIds.has(requested) ? requested : null;
      if (character.equippedAbilityId) takenAbilityIds.add(character.equippedAbilityId);
      return character;
    });
    const inventory: Record<Id, number> = { "exploration-kit": BALANCE.party.startingExplorationKits };
    this.ctx = { party, monsters, summons: [], rng, inventory };
    // Whether "the-one-who-stayed" can roll this run is encoded only by whether its id starts in firedOnceEventIds.
    const retiredCharacter = profile.retiredCharacters.at(-1);
    const retiredCharacterEventEligible = retiredCharacter !== undefined && !profile.shownRetiredCharacterEvent;
    this.state = {
      runId: randomUUID(),
      party,
      floor,
      currentRoomId: floor.entryRoomId,
      roomPath: [floor.entryRoomId],
      combat: null,
      message: withGatekeeper ? "" : t("game.enteredRoom", { room: getRoom(floor, floor.entryRoomId).name }),
      gameOver: null,
      partyExp: 0,
      inventory,
      coins: BALANCE.party.startingCoins,
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
      restRunner: null,
      pendingBarterBuffs: [],
      barterUsedDepth: null,
      pendingFloorMilestoneOmenId: null,
      shownFloorMilestoneIds: [],
      campReflectionChoices: {},
      pendingEndingCheckpoint: false,
      continuedPastCheckpoint: false,
      pendingFounderDialogue: false,
      pendingGatekeeper: withGatekeeper,
      gatekeeperAnswer: null,
      blessingRoomsLeft: 0,
      blessedRoomId: null,
      retiredCharacterClassId: retiredCharacterEventEligible ? retiredCharacter.classId : null,
      runStardust: 0,
      pendingAbilityBuyback: null,
      abilityDeathResults: null,
    };
    // Abilities were equipped after `createCharacter` filled hp/mp from base stats. Rebuild before the
    // entry ambush reads `speed`, and refill because recompute only clamps hp down to maxHp.
    recomputeAllPartyStats(this.state);
    for (const character of this.state.party) {
      character.hp = character.maxHp;
      character.mp = character.maxMp;
    }
    if (!withGatekeeper) this.checkEntryRoomAmbush();
  }

  playTimeSec(): number {
    return this.playTimeBaseSec + Math.floor((Date.now() - this.sessionStart) / 1000);
  }

  private checkEntryRoomAmbush(): void {
    const room = getRoom(this.state.floor, this.state.currentRoomId);
    const hasLiving = room.monsterIds.some((id) => (this.ctx.monsters.find((m) => m.id === id)?.hp ?? 0) > 0);
    if (hasLiving && !room.cleared) {
      this.state.combat = startCombat(room.id, room.monsterIds, this.ctx, room.type === "boss");
      applyBlessing(this.state, this.ctx, room.id);
      this.state.message = t("dungeon.ambush", { room: room.name });
    }
  }

  answerGatekeeper(answer: "paid" | "refused"): PartyActionError | null {
    if (!this.state.pendingGatekeeper || this.state.gatekeeperAnswer !== null) return null;
    return answerGatekeeper(this.state, answer);
  }

  enterDungeon(): void {
    if (!this.state.pendingGatekeeper || this.state.gatekeeperAnswer === null) return;
    this.state.pendingGatekeeper = false;
    const entry = getRoom(this.state.floor, this.state.currentRoomId);
    countBlessedRoom(this.state, entry);
    this.state.message = t("game.enteredRoom", { room: entry.name });
    this.checkEntryRoomAmbush();
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
      this.triggerDefeat();
    }
  }

  /** Defeat needs this too: the UI checks `gameOver` first, so `clearFinishedCombat` never runs on a wipe. */
  private endCombat(): void {
    if (!this.state.combat) return;
    dismissSummonsAtCombatEnd(this.ctx);
    clearCombatResources(this.ctx);
    this.state.combat = null;
  }

  private triggerDefeat(): void {
    if (this.state.gameOver !== null) return;
    this.endCombat();
    this.state.gameOver = "defeat";
    this.runAbilityDeathFlow();
  }

  /** With nothing lost, `abilityDeathResults` is `[]` rather than null so the results screen renders at once. */
  private runAbilityDeathFlow(): void {
    const profile = loadProfile(this.currentSaveSlot);
    const lostSet: { characterId: Id; lostAbilityId: Id; rarity: Exclude<ArtifactRarity, "common"> }[] = [];
    for (const character of this.state.party) {
      const abilityId = character.equippedAbilityId;
      if (!abilityId) continue;
      const ability = getAbility(abilityId);
      if (ability.rarity === "common") continue;
      lockAbility(profile, abilityId);
      lostSet.push({ characterId: character.id, lostAbilityId: abilityId, rarity: ability.rarity });
    }
    saveProfile(this.currentSaveSlot, profile);
    this.state.pendingAbilityBuyback = lostSet.length > 0 ? { entries: lostSet, resolvedIndex: 0 } : null;
    this.state.abilityDeathResults = lostSet.length > 0 ? null : [];
  }

  resolveAbilityBuyback(action: "reclaim" | "skip"): PartyActionError | null {
    const pending = this.state.pendingAbilityBuyback;
    const entry = pending?.entries[pending.resolvedIndex];
    if (!pending || !entry) return { reason: t("errors.noPendingAbilityBuyback") };

    if (action === "reclaim") {
      const cost = BALANCE.abilities.stardustCostByRarity[entry.rarity];
      if (this.state.runStardust < cost) return { reason: t("errors.notEnoughStardust") };
      this.state.runStardust -= cost;
      const profile = loadProfile(this.currentSaveSlot);
      unlockAbility(profile, entry.lostAbilityId);
      saveProfile(this.currentSaveSlot, profile);
      this.pushAbilityDeathResult(entry.characterId, entry.lostAbilityId, "reclaimed");
    } else {
      this.pushAbilityDeathResult(entry.characterId, entry.lostAbilityId, "lost");
    }

    pending.resolvedIndex += 1;
    if (pending.resolvedIndex >= pending.entries.length) this.state.pendingAbilityBuyback = null;
    return null;
  }

  private pushAbilityDeathResult(characterId: Id, lostAbilityId: Id, outcome: "reclaimed" | "lost"): void {
    if (!this.state.abilityDeathResults) this.state.abilityDeathResults = [];
    this.state.abilityDeathResults.push({ characterId, lostAbilityId, outcome });
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
    this.state.restRunner = null;
  }

  runnerBuy(offerIndex: number): PartyActionError | null {
    return runnerBuy(this.state, offerIndex);
  }

  runnerRefresh(): PartyActionError | null {
    return runnerRefresh(this.state, this.ctx);
  }

  runnerSell(itemId: Id): PartyActionError | null {
    return runnerSell(this.state, itemId);
  }

  runnerBarter(offerIndex: number): PartyActionError | null {
    return runnerBarter(this.state, offerIndex);
  }

  dismissRunnerNotice(): void {
    if (this.state.restRunner) this.state.restRunner.noticeShown = true;
  }

  /** Trading uses up the Rest room's rest action. */
  leaveRunner(): void {
    const room = getRoom(this.state.floor, this.state.currentRoomId);
    if (room.type !== "rest" || room.cleared || !this.state.restRunner) return;
    room.cleared = true;
    this.state.restRunner = null;
    this.state.message = t("game.leftRunner");
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
    return livingTargetableMonsterRefs(this.state.combat, this.ctx);
  }

  livingAllyRefs(): CombatantRef[] {
    if (!this.state.combat) return [];
    return livingPlayerSideRefs(this.state.combat, this.ctx);
  }

  /** Characters only: summons act via AI and never get a queued action. */
  livingCharactersNeedingAction(): CombatantRef[] {
    if (!this.state.combat) return [];
    return livingCharacterRefs(this.state.combat, this.ctx);
  }

  /** Keeps a channeling character channeling this round (`holdChannel`). */
  holdChannel(actorRef: CombatantRef): void {
    if (this.state.combat) holdChannel(this.state.combat, actorRef);
  }

  /** Ends a character's channel now, so it can act this round (`breakChannel`). */
  breakChannel(actorRef: CombatantRef): void {
    const character = this.state.party.find((c) => c.id === actorRef.id);
    if (this.state.combat && character) breakChannel(character, this.state.combat, this.ctx, this.state.combat.log);
  }

  queue(actorRef: CombatantRef, skillId: string, targets: CombatantRef[]): QueueActionError | null {
    if (!this.state.combat) return { reason: t("errors.notInCombat") };
    return queueAction(this.state.combat, actorRef, skillId, targets, this.ctx);
  }

  queueCommand(actorRef: CombatantRef, skillId: string, order: CommandOrder, targets: CombatantRef[]): QueueActionError | null {
    if (!this.state.combat) return { reason: t("errors.notInCombat") };
    return queueCommand(this.state.combat, actorRef, skillId, order, targets, this.ctx);
  }

  queueItem(actorRef: CombatantRef, itemId: Id, targets: CombatantRef[]): QueueActionError | null {
    if (!this.state.combat) return { reason: t("errors.notInCombat") };
    return queueItemAction(this.state.combat, actorRef, itemId, targets, this.ctx);
  }

  useItemOutOfCombat(itemId: Id, characterId?: Id): QueueActionError | null {
    const item = getItem(itemId);
    if ((this.state.inventory[itemId] ?? 0) <= 0) return { reason: t("errors.noItem") };
    // Enemy-targeted items and status effects that count down in combat turns exist only for a fight; used beforehand they would be a free pre-buff.
    if (item.target === "singleEnemy" || item.target === "allEnemies" || item.effects.some((e) => e.kind === "applyStatusEffect")) return { reason: t("errors.itemNotUsableOutOfCombat") };

    const log: LogEntry[] = [];
    // Satiety is party-wide, so apply it once rather than once per character.
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
    this.state.message = log.length > 0 ? log.map((entry) => entry.text).join(" ") : t(item.effects.length === 0 ? "game.itemNoEffect" : "game.usedItem", { item: item.name });
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
    const eventId = getRoom(this.state.floor, this.state.currentRoomId).rolledEventId;
    const err = openChest(this.state, this.ctx);
    if (!err && eventId === "the-one-who-stayed") markRetiredCharacterEventShown(this.currentSaveSlot);
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

  pickReflectionStance(stance: "curious" | "wary" | "dismissive"): void {
    const pending = this.state.pendingReflection;
    if (!pending) return;
    this.state.eventReflectionStances[pending.eventId] = stance;
    this.state.pendingReflection = null;
  }

  /** Tier 4 writes the synthetic tag the-wanderer/wandering-hermit's crossEventVariants read. */
  pickCampReflectionChoice(choice: 0 | 1 | 2): void {
    const tier = this.state.pendingCampReflectionTier;
    if (tier === null) return;
    this.state.campReflectionChoices[tier] = choice;
    this.state.pendingCampReflectionTier = null;
    if (tier === 4) this.state.eventOutcomes["camp-reflection"] = "unaware";
  }

  resolve(): void {
    if (!this.state.combat) return;
    // Coins/EXP/satiety only change in the reward block below, so this is the reveal's baseline for the whole round.
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
        const droppedAbilityIds: Id[] = [];
        let coinsGained = 0;
        for (const id of room.monsterIds) {
          const monster = this.ctx.monsters.find((m) => m.id === id);
          if (!monster) continue;
          coinsGained += rollCoinDrop(monster, this.ctx.rng);
          const itemId = rollItemDrop(monster.archetypeId, this.ctx.rng);
          if (itemId) {
            this.state.inventory[itemId] = (this.state.inventory[itemId] ?? 0) + 1;
            droppedItemIds.push(itemId);
          }
          if (monster.tier === "elite" || monster.tier === "boss") {
            // Only a real Boss kill may roll boss-restricted artifacts; Collapsed Floor rolls the same table without qualifying.
            const artifactId = rollArtifact(monster.tier, this.ctx.rng, this.state.floor.depth, monster.tier === "boss" ? "boss" : undefined);
            grantArtifact(this.state, artifactId);
            droppedArtifactIds.push(artifactId);

            const profile = loadProfile(this.currentSaveSlot);
            const abilityId = rollAbility(monster.tier, this.state.floor.depth, this.ctx.rng, profile.unlockedAbilityIds);
            if (abilityId) {
              unlockAbility(profile, abilityId);
              saveProfile(this.currentSaveSlot, profile);
              droppedAbilityIds.push(abilityId);
            }
            if (monster.tier === "boss") {
              this.state.runStardust += 1;
              this.state.combat.log.push({ text: t("game.stardustGained"), kind: "info" });
              this.unlockMemory();
            }
          }
        }
        if (coinsGained > 0) {
          this.state.coins += coinsGained;
          this.state.combat.log.push({ text: t("game.coinsEarned", { amount: coinsGained }), kind: "info" });
        }
        if (room.type === "event" && room.rolledEventId && getEvent(room.rolledEventId).kind === "combatReward") {
          const artifactId = rollArtifact("treasureOrEvent", this.ctx.rng, this.state.floor.depth);
          grantArtifact(this.state, artifactId);
          droppedArtifactIds.push(artifactId);
          // This win path never reaches closeEvent(), so its outcome tag and lore count are written here.
          this.state.eventOutcomes[room.rolledEventId] = "resolved";
          this.state.loreExposureCount += 1;
        }
        // Deduped: some of these ids are onceLifetime and may have fired already.
        if (room.monsterIds.some((id) => this.ctx.monsters.find((m) => m.id === id)?.archetypeId === "the-founder")) {
          for (const id of FOUNDER_VICTORY_REMOVED_EVENT_IDS) {
            if (!this.state.firedOnceEventIds.includes(id)) this.state.firedOnceEventIds.push(id);
          }
        }
        this.state.lastRoomDrops =
          droppedItemIds.length > 0 || droppedArtifactIds.length > 0 || droppedAbilityIds.length > 0
            ? { itemIds: droppedItemIds, artifactIds: droppedArtifactIds, abilityIds: droppedAbilityIds }
            : null;
        // Tag the reward block like resolveRound tags its actions, so the reveal shows these values when it reaches them.
        tagLogRange(this.state.combat, rewardBlockStart, snapshotCombatants(this.state.combat, this.ctx));
        tagPartySnapshotRange(this.state.combat, rewardBlockStart, { coins: this.state.coins, partyExp: this.state.partyExp, satiety: this.state.satiety });
        // A combat event's win path never calls closeEvent(), so this is its only reflection trigger.
        maybeTriggerReflection(this.state, this.ctx);
      } else if (this.state.combat.outcome === "defeat") {
        this.triggerDefeat();
      }
    }
    this.postMoveCheck();
  }

  advanceToNextFloor(): void {
    // Depth is still the cleared floor's here. `continuedPastCheckpoint` stops this refiring on the call pickEndingChoice("continue") makes.
    if (this.state.floor.depth === ENDING_CHECKPOINT_FLOOR_DEPTH && !this.state.continuedPastCheckpoint) {
      this.state.pendingEndingCheckpoint = true;
      return;
    }
    const nextDepth = this.state.floor.depth + 1;
    this.state.pendingBarterBuffs = []; // a buff bartered for this floor's elite/boss room is lost if the floor ends without it
    this.state.restRunner = null; // room ids repeat on every floor, so a leftover runner must not match a room on the next one
    const { floor, monsters } = createFloor(this.ctx.rng, nextDepth);
    this.ctx.monsters = monsters;
    this.state.floor = floor;
    this.state.currentRoomId = floor.entryRoomId;
    this.state.roomPath = [floor.entryRoomId];
    this.state.message = t("game.nextFloor", { depth: nextDepth });
    if (nextDepth === FOUNDER_FLOOR_DEPTH && this.state.continuedPastCheckpoint) {
      this.state.pendingFounderDialogue = true;
      return;
    }
    this.checkEntryRoomAmbush();
  }

  pickEndingChoice(choice: "stay" | "letGo" | "leave" | "continue"): void {
    if (!this.state.pendingEndingCheckpoint) return;
    const mode = endingCheckpointMode(this.state);
    if (choice === "leave" && mode !== "leaveOnly") return;
    if (choice === "continue" && mode !== "full") return;
    if ((choice === "stay" || choice === "letGo") && mode === "leaveOnly") return;

    this.state.pendingEndingCheckpoint = false;
    if (choice === "stay") {
      this.state.gameOver = "stay";
      // Persisted at once so a later run finds it even if this save is never reopened. Party members may already be dead here.
      const living = this.state.party.filter((c) => c.isAlive);
      addRetiredCharacter(this.currentSaveSlot, this.ctx.rng.pick(living.length > 0 ? living : this.state.party).classId);
    } else if (choice === "letGo") {
      this.state.gameOver = "letGo";
    } else if (choice === "leave") {
      this.state.gameOver = hasWaystoneShardEquipped(this.state) ? "leaveEscaped" : "leaveAmbushed";
    } else {
      // Set first so advanceToNextFloor's checkpoint gate doesn't refire.
      this.state.continuedPastCheckpoint = true;
      this.advanceToNextFloor();
    }
  }

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
    if (wasBossRoomVictory && this.state.floor.depth % FLOOR_MILESTONE_INTERVAL === 0) {
      const omen = pickFloorMilestoneOmen(this.state.floor.depth, this.state.shownFloorMilestoneIds, this.ctx.rng);
      this.state.shownFloorMilestoneIds.push(omen.id);
      this.state.pendingFloorMilestoneOmenId = omen.id;
    }
    this.endCombat();
    return wasBossRoomVictory;
  }

  dismissFloorMilestoneMessage(): void {
    this.state.pendingFloorMilestoneOmenId = null;
  }

  private unlockMemory(): void {
    if (this.memoryUnlocked) return;
    this.memoryUnlocked = true;
    const profile = loadProfile(this.currentSaveSlot);
    profile.memoryUnlocked = true;
    saveProfile(this.currentSaveSlot, profile);
  }

  /** Kept in the slot profile, not the run, so quitting before it is read cannot skip it. */
  get memoryIntroPending(): boolean {
    return this.memoryUnlocked && !this.memoryIntroShown;
  }

  dismissMemoryIntro(): void {
    if (!this.memoryIntroPending) return;
    this.memoryIntroShown = true;
    const profile = loadProfile(this.currentSaveSlot);
    profile.memoryIntroShown = true;
    saveProfile(this.currentSaveSlot, profile);
  }

  /** Non-common abilities the slot holds, in catalog order. */
  memoryAbilityIds(): Id[] {
    const held = loadProfile(this.currentSaveSlot).unlockedAbilityIds;
    return ABILITIES.filter((a) => a.rarity !== "common" && held.includes(a.id)).map((a) => a.id);
  }

  className(classId: string): string {
    return getClass(classId).name;
  }
}
