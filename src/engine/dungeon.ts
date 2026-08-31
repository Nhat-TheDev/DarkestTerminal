import type { EventDefinition, Floor, GameState, Room } from "../types";
import type { EngineContext } from "./combat";
import { startCombat } from "./combat";
import { drainSatiety, SATIETY_DRAIN_COMBAT, SATIETY_DRAIN_EVENT } from "./survival";
import { getEvent, rollEvent } from "../data/events";
import { rollArtifact, rollArtifactOrCursed } from "../data/artifacts";
import { grantArtifact, recomputeAllPartyStats } from "./party";
import { t } from "../data/strings";
import { BALANCE } from "../data/balanceConfig";

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

export function moveToRoom(state: GameState, targetRoomId: string, ctx: EngineContext): void {
  const current = getRoom(state.floor, state.currentRoomId);
  if (!current.connectedRoomIds.includes(targetRoomId)) {
    state.message = t("errors.roomNotConnected");
    return;
  }

  state.currentRoomId = targetRoomId;
  const room = getRoom(state.floor, targetRoomId);

  // A room that starts a fight drains satiety on victory, not on the ambush itself.
  if ((room.type === "combat" || room.type === "boss") && !room.cleared && roomHasLivingMonsters(room, ctx)) {
    state.combat = startCombat(room.id, room.monsterIds, ctx, room.type === "boss");
    state.message = t("dungeon.ambush", { room: room.name });
    return;
  }

  if (room.type === "rest" && !room.cleared) {
    // Rest room: no satiety drain at all.
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

/**
 * Picks the flavor text an event should show right now — pure, no side effects. Shared by
 * `resolveEventEntry` (sets `state.message` on room entry) and `currentEventDescription()`
 * (`src/ui/screens/events.ts`, re-derives the same text on every re-render within a visit) so the 2
 * never drift out of sync with each other.
 */
export function pickEventText(state: GameState, room: Room, event: EventDefinition): string {
  if (event.kind === "combatReward") {
    if (room.chainVariant === "forced") return event.chainForcedDescription ?? event.description;
    if (room.chainVariant === "buildup") return event.chainBuildupDescription ?? event.description;
    return event.description;
  }

  const alreadyMet = state.metNarrativeNpcIds.includes(event.id);
  const returnText =
    typeof event.returnDescription === "string" ? event.returnDescription : event.returnDescription?.[state.lastGamblingDenOutcome ?? "declined"];
  return alreadyMet && returnText ? returnText : event.description;
}

function resolveEventEntry(state: GameState, room: Room, ctx: EngineContext): void {
  if (!room.rolledEventId) room.rolledEventId = rollEvent(ctx.rng);
  const event = getEvent(room.rolledEventId);

  if (event.kind === "combatReward") {
    // §10.3 Chain 1 — decided once, here, at room entry; consumed later by guardianFightSkip()
    // (rejects Skip when "forced") and by pickEventText() (both here and in events.ts).
    const forcedThreshold = BALANCE.events.guardianGrudgeForcedThreshold;
    const skips = state.narrativeCounters.guardianFightsSkipped;
    room.chainVariant = skips >= forcedThreshold ? "forced" : skips === forcedThreshold - 1 ? "buildup" : undefined;
  }

  state.message = pickEventText(state, room, event);
  // `metNarrativeNpcIds` (§10.2) is marked in `closeEvent()` (shared.ts) instead of here, once the
  // visit fully ends — not on room entry — so `alreadyMet` stays accurate across every re-render of
  // the player's 1st ever visit to a personified event, not just at the moment they walk in.

  if (event.kind === "instantReward") {
    const artifactId = rollArtifact("treasureOrEvent", ctx.rng);
    grantArtifact(state, artifactId, "event");
    room.cleared = true;
    return;
  }

  if (event.kind === "combatReward") {
    // Deferred: player confirms via Game.enterGuardianFight()/skipGuardianFight() from the
    // "eventGuardianFight" UI screen, instead of the fight starting immediately on room entry.
    return;
  }

  if (!state.activeEvent) {
    if (event.id === "merchant") {
      const offerCount = BALANCE.events.merchantOfferCount;
      state.activeEvent = { eventId: event.id, offerArtifactIds: Array.from({ length: offerCount }, () => rollArtifact("treasureOrEvent", ctx.rng)), refreshCount: 0 };
    } else if (event.id === "cursed-shrine") {
      state.activeEvent = { eventId: event.id, offerArtifactIds: [rollArtifactOrCursed(ctx.rng)] };
    } else if (event.id === "twin-altars") {
      state.activeEvent = { eventId: event.id, offerArtifactIds: [rollArtifact("treasureOrEvent", ctx.rng), rollArtifact("treasureOrEvent", ctx.rng)] };
    } else if (event.id === "gambling-den") {
      state.activeEvent = { eventId: event.id, offerArtifactIds: [] };
    }
  }
}

export function checkPartyWipe(state: GameState): boolean {
  return state.party.every((c) => !c.isAlive);
}
