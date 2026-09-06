import type { EventDefinition, Floor, GameState, Id, Room } from "../types";
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

/** §8.15 Chain 4, "Taken, Never Given" — same 7 ids `closeEvent()` (events/shared.ts) counts;
    duplicated here rather than imported to avoid a circular import (shared.ts already imports
    `getRoom` from this file). */
const FREE_TAKE_EVENT_IDS: ReadonlySet<Id> = new Set([
  "open-chest",
  "old-count",
  "doubled-back",
  "waiting-supplies",
  "vigil-candle",
  "broken-seal",
  "half-a-warning",
]);

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
    // Camp Reflection (03-survival-stats.md) — narrow defensive checks only, not dependencies:
    // skip if an event reflection is already pending, or if a tier is already awaiting an answer.
    if (!state.pendingReflection && state.pendingCampReflectionTier === null) {
      const tier = campReflectionTier(state.loreExposureCount);
      if (tier !== null && tier > highestAnsweredCampReflectionTier(state.campReflectionChoices)) {
        state.pendingCampReflectionTier = tier;
      }
    }
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

/** 11-world-bible.md §11.13 tier 2 — a chain's deeper escalation requires both its own higher
    counter threshold AND enough floor depth, so an early, lucky/rich run can't reach it on the
    counter alone (docs/gameplay-decisions/10-event-narrative.md, "Proposal — pacing narrative
    delivery across a randomized run"). */
function isTier2Escalated(state: GameState, counter: number, threshold2: number): boolean {
  return counter >= threshold2 && state.floor.depth >= BALANCE.events.chainTier2MinFloorDepth;
}

/** 10-event-narrative.md Part C.3 — same shape as `isTier2Escalated`, one gate deeper. Checked
    before tier 2 wherever both apply, since it's a strictly higher bar (whenever it's met, tier 2's
    own lower bar is necessarily met too). */
function isTier3Escalated(state: GameState, counter: number, threshold3: number): boolean {
  return counter >= threshold3 && state.floor.depth >= BALANCE.events.chainTier3MinFloorDepth;
}

/** Part C.1 — first array entry whose condition matches wins; `undefined` if none do or the event
    has no `crossEventVariants`. */
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

/** 11-world-bible.md §11.13 — the party's most-picked reflection stance across the whole run so
    far, or `undefined` if none recorded yet or tied. Purely for `stanceEcho` flavor text; never
    read for anything mechanical. */
function dominantReflectionStance(state: GameState): "curious" | "wary" | "dismissive" | undefined {
  const counts = { curious: 0, wary: 0, dismissive: 0 };
  for (const stance of Object.values(state.eventReflectionStances)) {
    if (stance) counts[stance]++;
  }
  const [best, second] = (Object.entries(counts) as ["curious" | "wary" | "dismissive", number][]).sort((a, b) => b[1] - a[1]);
  if (!best || best[1] === 0 || best[1] === second?.[1]) return undefined;
  return best[0];
}

/** Part C.2 — lowest-priority fallback: `room.descriptionVariantIndex` (pinned at roll time by
    `resolveEventEntry`) selects among `[description, ...descriptionVariants]`. Falls back to
    `crossEventVariants` first, since that's a higher-priority layer in the same fallback chain. */
function pickFallbackText(state: GameState, room: Room, event: EventDefinition): string {
  const crossEventText = pickCrossEventVariant(state, event);
  if (crossEventText) return crossEventText;
  const variantIndex = room.descriptionVariantIndex;
  if (event.descriptionVariants && variantIndex !== undefined && variantIndex > 0) {
    return event.descriptionVariants[variantIndex - 1] ?? event.description;
  }
  return event.description;
}

/**
 * Picks the flavor text an event should show right now — pure, no side effects. Shared by
 * `resolveEventEntry` (sets `state.message` on room entry) and `currentEventDescription()`
 * (`src/ui/screens/events.ts`, re-derives the same text on every re-render within a visit) so the 2
 * never drift out of sync with each other.
 */
export function pickEventText(state: GameState, room: Room, event: EventDefinition): string {
  // Part F.2 — the only event whose text depends on data outside this run's own GameState (the
  // cross-run profile, read once at construction into retiredCharacterClassId). Substituted here,
  // not authored with the placeholder pre-filled in data/events.json, since the retired class isn't
  // known until a save actually has one.
  if (event.id === "the-one-who-stayed") {
    // Belt-and-braces: the id is excluded from the roll pool whenever no class is recorded (fresh
    // runs at construction, migrated saves in migrateGameState), so this should be unreachable with
    // a null class — but a raw "{{class}}" reaching a player is bad enough to guard twice.
    const who = state.retiredCharacterClassId ? getClass(state.retiredCharacterClassId).name : "figure";
    return event.description.replace("{{class}}", who);
  }
  if (event.kind === "combatReward") {
    if (room.chainVariant === "forced3") return event.chainForced3Description ?? event.chainForced2Description ?? event.chainForcedDescription ?? event.description;
    if (room.chainVariant === "forced2") return event.chainForced2Description ?? event.chainForcedDescription ?? event.description;
    if (room.chainVariant === "forced") return event.chainForcedDescription ?? event.description;
    if (room.chainVariant === "buildup") return event.chainBuildupDescription ?? event.description;
    return pickFallbackText(state, room, event);
  }

  // §10.3 Chain 2/3 — permanent once crossed, no room-level flag needed (unlike Chain 1's
  // chainVariant), since the counter itself never resets for these 2. Tier 3 (Part C.3), then tier 2
  // (11-world-bible.md §11.13), are checked before tier 1 — each is a strictly higher bar (counter
  // threshold AND floor depth), so whenever a higher tier is met, every lower tier's own bar is
  // necessarily met too.
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
  // §8.15 Chain 4, "Taken, Never Given" — single tier, shared verbatim across all 7 ids, and unlike
  // Chain 2/3 it also requires the party to have never paid a cost anywhere else this run.
  if (
    FREE_TAKE_EVENT_IDS.has(event.id) &&
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
    // Camp Reflection's Unawareness bridge (03-survival-stats.md) — the counterpart to this event's
    // own crossEventVariant for the same tag, covering every visit after the 1st (see the field's
    // own doc comment, src/types.ts, for why both forms are needed).
    const unawareEcho = event.campReflectionUnawareEcho && state.eventOutcomes["camp-reflection"] === "unaware" ? event.campReflectionUnawareEcho : undefined;
    return [returnText, stanceEcho, unawareEcho].filter((s): s is string => !!s).join(" ");
  }
  return pickFallbackText(state, room, event);
}

function resolveEventEntry(state: GameState, room: Room, ctx: EngineContext): void {
  if (!room.rolledEventId) {
    room.rolledEventId = rollEvent(ctx.rng, state.floor.depth, state.firedOnceEventIds);
    // Part C.2 — picked once per room, at roll time, so re-renders within the same visit stay
    // consistent (see `pickEventText`'s `descriptionVariantIndex` read). 0 = base `description`.
    const rolledEvent = getEvent(room.rolledEventId);
    if (rolledEvent.descriptionVariants && rolledEvent.descriptionVariants.length > 0) {
      room.descriptionVariantIndex = ctx.rng.int(0, rolledEvent.descriptionVariants.length);
    }
  }
  const event = getEvent(room.rolledEventId);

  if (event.kind === "combatReward") {
    // §10.3 Chain 1 — decided once, here, at room entry; consumed later by guardianFightSkip()
    // (rejects Skip when "forced"/"forced2"/"forced3") and by pickEventText() (both here and in
    // events.ts).
    const forcedThreshold = BALANCE.events.guardianGrudgeForcedThreshold;
    const skips = state.narrativeCounters.guardianFightsSkipped;
    const pastForced = skips >= forcedThreshold;
    // 11-world-bible.md §11.13 tier 2 / Part C.3 tier 3 — the 2nd+/3rd+ time this chain has fired
    // this run, past enough floor depth. `guardianGrudgeFiredCount` (unlike `guardianFightsSkipped`)
    // never resets, so it can tell "has this already happened before" even right after a reset.
    const tier3 = state.narrativeCounters.guardianGrudgeFiredCount >= 2 && state.floor.depth >= BALANCE.events.chainTier3MinFloorDepth;
    const tier2 = state.narrativeCounters.guardianGrudgeFiredCount >= 1 && state.floor.depth >= BALANCE.events.chainTier2MinFloorDepth;
    room.chainVariant = pastForced ? (tier3 ? "forced3" : tier2 ? "forced2" : "forced") : skips === forcedThreshold - 1 ? "buildup" : undefined;
  }

  state.message = pickEventText(state, room, event);
  // `metNarrativeNpcIds` (§10.2) is marked in `closeEvent()` (shared.ts) instead of here, once the
  // visit fully ends — not on room entry — so `alreadyMet` stays accurate across every re-render of
  // the player's 1st ever visit to a personified event, not just at the moment they walk in.

  if (event.kind === "instantReward" || event.kind === "combatReward") {
    // Deferred: instantReward confirms via Game.openChest() from the "eventOpenChest" UI screen;
    // combatReward confirms via Game.enterGuardianFight()/skipGuardianFight() from
    // "eventGuardianFight". Neither triggers its outcome on room entry — only the flavor text above does.
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
