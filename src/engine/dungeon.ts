import type { EventDefinition, Floor, GameState, Room } from "../types";
import type { EngineContext } from "./combat";
import { startCombat } from "./combat";
import { drainSatiety, SATIETY_DRAIN_COMBAT, SATIETY_DRAIN_EVENT } from "./survival";
import { getEvent, rollEvent } from "../data/events";
import { rollArtifact, rollArtifactOrCursed } from "../data/artifacts";
import { recomputeAllPartyStats } from "./party";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";
import { campReflectionTier, highestAnsweredCampReflectionTier } from "../data/loreExposure";
import { getClass } from "../data/classes";
import { rollRestRunner } from "./events/runner";
import { applyPendingBarterBuffs } from "./events/barter";
import { applyBlessing, countBlessedRoom } from "./events/gatekeeper";

export function getRoom(floor: Floor, roomId: string): Room {
  const room = floor.rooms.find((r) => r.id === roomId);
  if (!room) throw new Error(`Unknown room: ${roomId}`);
  return room;
}

export function connectedRooms(floor: Floor, roomId: string): Room[] {
  const room = getRoom(floor, roomId);
  return room.connectedRoomIds.map((id) => getRoom(floor, id));
}

function roomHasLivingMonsters(room: Room, ctx: EngineContext): boolean {
  return room.monsterIds.some((id) => {
    const m = ctx.monsters.find((mo) => mo.id === id);
    return m && m.hp > 0;
  });
}

/** Also used by the dev save dump to jump to a room, so it gets the same side effects as a real arrival. */
export function enterRoom(state: GameState, room: Room, ctx: EngineContext): void {
  // A room that starts a fight drains satiety on victory, not on the ambush itself.
  if ((room.type === "combat" || room.type === "boss") && !room.cleared && roomHasLivingMonsters(room, ctx)) {
    state.combat = startCombat(room.id, room.monsterIds, ctx, room.type === "boss");
    if (room.type === "boss") applyPendingBarterBuffs(state, ctx, state.combat.log);
    applyBlessing(state, ctx, room.id);
    state.message = t("dungeon.ambush", { room: room.name });
    return;
  }

  if (room.type === "rest" && !room.cleared) {
    if (!state.pendingReflection && state.pendingCampReflectionTier === null) {
      const tier = campReflectionTier(state.loreExposureCount);
      if (tier !== null && tier > highestAnsweredCampReflectionTier(state.campReflectionChoices)) {
        state.pendingCampReflectionTier = tier;
      }
    }
    rollRestRunner(state, room, ctx);
    state.message = t("dungeon.restEnter", { room: room.name });
    return;
  }

  if (room.type === "event" && !room.cleared) {
    resolveEventEntry(state, room, ctx);
    if (!state.combat) {
      drainSatiety(state, SATIETY_DRAIN_EVENT, []);
      recomputeAllPartyStats(state);
    }
    return;
  }

  drainSatiety(state, SATIETY_DRAIN_COMBAT, []);
  recomputeAllPartyStats(state);
  state.message = t("dungeon.arrived", { room: room.name });
}

export function moveToRoom(state: GameState, targetRoomId: string, ctx: EngineContext): void {
  const current = getRoom(state.floor, state.currentRoomId);
  if (!current.connectedRoomIds.includes(targetRoomId)) {
    state.message = t("errors.roomNotConnected");
    return;
  }

  state.currentRoomId = targetRoomId;
  state.roomPath.push(targetRoomId);
  const room = getRoom(state.floor, targetRoomId);
  // Counted before the room's own effects, so a fight that starts on arrival is already blessed.
  const blessingNote = countBlessedRoom(state, room);
  enterRoom(state, room, ctx);
  if (blessingNote) state.message = `${blessingNote} ${state.message}`;
}

function isTier2Escalated(state: GameState, counter: number, threshold2: number): boolean {
  return counter >= threshold2 && state.floor.depth >= BALANCE.events.chainTier2MinFloorDepth;
}

function isTier3Escalated(state: GameState, counter: number, threshold3: number): boolean {
  return counter >= threshold3 && state.floor.depth >= BALANCE.events.chainTier3MinFloorDepth;
}

function pickCrossEventVariant(state: GameState, event: EventDefinition): string | undefined {
  if (!event.crossEventVariants) return undefined;
  for (const variant of event.crossEventVariants) {
    const matches =
      variant.match === "all"
        ? variant.when.every((c) => state.eventOutcomes[c.eventId] === c.outcome)
        : variant.when.some((c) => state.eventOutcomes[c.eventId] === c.outcome);
    if (matches) return variant.description;
  }
  return undefined;
}

function dominantReflectionStance(state: GameState): "curious" | "wary" | "dismissive" | undefined {
  const counts = { curious: 0, wary: 0, dismissive: 0 };
  for (const stance of Object.values(state.eventReflectionStances)) {
    if (stance) counts[stance]++;
  }
  const [best, second] = (Object.entries(counts) as ["curious" | "wary" | "dismissive", number][]).sort((a, b) => b[1] - a[1]);
  if (!best || best[1] === 0 || best[1] === second?.[1]) return undefined;
  return best[0];
}

function pickFallbackText(state: GameState, room: Room, event: EventDefinition): string {
  const crossEventText = pickCrossEventVariant(state, event);
  if (crossEventText) return crossEventText;
  const variantIndex = room.descriptionVariantIndex;
  if (event.descriptionVariants && variantIndex !== undefined && variantIndex > 0) {
    return event.descriptionVariants[variantIndex - 1] ?? event.description;
  }
  return event.description;
}

/** Pure: the events screen re-derives the same text on every re-render. */
export function pickEventText(state: GameState, room: Room, event: EventDefinition): string {
  if (event.id === "the-one-who-stayed") {
    // The event can't roll without a recorded class; the fallback guards a raw "{{class}}" anyway.
    const who = state.retiredCharacterClassId ? getClass(state.retiredCharacterClassId).name : t("dungeon.retiredClassFallback");
    return event.description.replace("{{class}}", who);
  }
  if (event.kind === "combatReward") {
    if (room.chainVariant === "forced3") return event.chainForced3Description ?? event.chainForced2Description ?? event.chainForcedDescription ?? event.description;
    if (room.chainVariant === "forced2") return event.chainForced2Description ?? event.chainForcedDescription ?? event.description;
    if (room.chainVariant === "forced") return event.chainForcedDescription ?? event.description;
    if (room.chainVariant === "buildup") return event.chainBuildupDescription ?? event.description;
    return pickFallbackText(state, room, event);
  }

  // These counters never reset, so no room-level flag is needed. Highest tier first: each implies the ones below.
  if (event.id === "sacrificial-circle") {
    const counter = state.narrativeCounters.artifactsSacrificed;
    if (isTier3Escalated(state, counter, BALANCE.events.circleRemembersThreshold3)) {
      return event.chainEscalated3Description ?? event.chainEscalated2Description ?? event.chainEscalatedDescription ?? event.description;
    }
    if (isTier2Escalated(state, counter, BALANCE.events.circleRemembersThreshold2)) {
      return event.chainEscalated2Description ?? event.chainEscalatedDescription ?? event.description;
    }
    if (counter >= BALANCE.events.circleRemembersThreshold) return event.chainEscalatedDescription ?? event.description;
  }
  if (event.id === "blood-altar") {
    const counter = state.narrativeCounters.altarPaymentsCount;
    if (isTier3Escalated(state, counter, BALANCE.events.bloodDebtThreshold3)) {
      return event.chainEscalated3Description ?? event.chainEscalated2Description ?? event.chainEscalatedDescription ?? event.description;
    }
    if (isTier2Escalated(state, counter, BALANCE.events.bloodDebtThreshold2)) {
      return event.chainEscalated2Description ?? event.chainEscalatedDescription ?? event.description;
    }
    if (counter >= BALANCE.events.bloodDebtThreshold) return event.chainEscalatedDescription ?? event.description;
  }
  if (
    event.freeTake &&
    state.narrativeCounters.freeRewardsTakenCount >= BALANCE.events.freeTakenThreshold &&
    state.narrativeCounters.altarPaymentsCount === 0 &&
    state.narrativeCounters.artifactsSacrificed === 0
  ) {
    return event.chainEscalatedDescription ?? event.description;
  }

  const alreadyMet = state.metNarrativeNpcIds.includes(event.id);
  const returnText =
    typeof event.returnDescription === "string" ? event.returnDescription : event.returnDescription?.[state.lastGamblingDenOutcome ?? "declined"];
  if (alreadyMet && returnText) {
    const stance = event.stanceEcho && dominantReflectionStance(state);
    const stanceEcho = stance ? event.stanceEcho![stance] : undefined;
    // Covers return visits; the event's crossEventVariant for the same tag covers the first.
    const unawareEcho = event.campReflectionUnawareEcho && state.eventOutcomes["camp-reflection"] === "unaware" ? event.campReflectionUnawareEcho : undefined;
    return [returnText, stanceEcho, unawareEcho].filter((s): s is string => !!s).join(" ");
  }
  return pickFallbackText(state, room, event);
}

export function resolveEventEntry(state: GameState, room: Room, ctx: EngineContext): void {
  if (!room.rolledEventId) {
    room.rolledEventId = rollEvent(ctx.rng, state.floor.depth, state.firedOnceEventIds);
    // Pinned at roll time so re-renders within a visit stay consistent. 0 = base `description`.
    const rolledEvent = getEvent(room.rolledEventId);
    if (rolledEvent.descriptionVariants && rolledEvent.descriptionVariants.length > 0) {
      room.descriptionVariantIndex = ctx.rng.int(0, rolledEvent.descriptionVariants.length);
    }
  }
  const event = getEvent(room.rolledEventId);

  if (event.kind === "combatReward") {
    // Decided once at entry; guardianFightSkip() rejects Skip on any "forced" variant.
    const forcedThreshold = BALANCE.events.guardianGrudgeForcedThreshold;
    const skips = state.narrativeCounters.guardianFightsSkipped;
    const pastForced = skips >= forcedThreshold;
    // `guardianGrudgeFiredCount` never resets, unlike `guardianFightsSkipped`.
    const tier3 = state.narrativeCounters.guardianGrudgeFiredCount >= 2 && state.floor.depth >= BALANCE.events.chainTier3MinFloorDepth;
    const tier2 = state.narrativeCounters.guardianGrudgeFiredCount >= 1 && state.floor.depth >= BALANCE.events.chainTier2MinFloorDepth;
    room.chainVariant = pastForced ? (tier3 ? "forced3" : tier2 ? "forced2" : "forced") : skips === forcedThreshold - 1 ? "buildup" : undefined;
  }

  state.message = pickEventText(state, room, event);
  // `metNarrativeNpcIds` is marked in `closeEvent()`, not here, so `alreadyMet` stays false across re-renders of the first visit.

  if (event.kind === "instantReward" || event.kind === "combatReward") {
    // Their outcome waits for the player's choice on the event screen.
    return;
  }

  if (!state.activeEvent) {
    if (event.id === "merchant") {
      const offerCount = BALANCE.events.merchantOfferCount;
      state.activeEvent = { eventId: event.id, offerArtifactIds: Array.from({ length: offerCount }, () => rollArtifact("treasureOrEvent", ctx.rng, state.floor.depth)), refreshCount: 0 };
    } else if (event.id === "cursed-shrine") {
      state.activeEvent = { eventId: event.id, offerArtifactIds: [rollArtifactOrCursed(ctx.rng, state.floor.depth)] };
    } else if (event.id === "twin-altars") {
      state.activeEvent = { eventId: event.id, offerArtifactIds: [rollArtifact("treasureOrEvent", ctx.rng, state.floor.depth), rollArtifact("treasureOrEvent", ctx.rng, state.floor.depth)] };
    } else if (event.id === "gambling-den") {
      state.activeEvent = { eventId: event.id, offerArtifactIds: [] };
    }
  }
}
