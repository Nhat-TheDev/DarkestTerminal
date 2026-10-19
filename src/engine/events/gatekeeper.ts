import type { GameState, Id, LogEntry, Room } from "../../types";
import type { EngineContext } from "../combat";
import type { PartyActionError } from "../party";
import { resolveSkillEffect } from "../resolver";
import { BALANCE } from "../../data/balanceConfig";
import { getStatusEffect } from "../../data/statusEffects";
import { t } from "../../data/strings";

export const GATEKEEPER_EVENT_ID = "the-gatekeeper";

// The blessing's text is built from these effects as "+N% stat", so each must be a pure percent stat raise.
for (const effect of getStatusEffect(BALANCE.gatekeeper.blessingStatusId).perTurnEffects) {
  if (effect.kind !== "modifyCombatStat" || !effect.combatStat || (effect.amount ?? 0) !== 0 || !((effect.minPercent ?? 0) > 0)) {
    throw new Error(`balance-config gatekeeper.blessingStatusId: "${BALANCE.gatekeeper.blessingStatusId}" must only raise stats by a positive minPercent with amount 0`);
  }
}

/** Records the answer given at the gate. Leaving the coins takes the toll and arms the blessing for floor 1's first rooms; a party short of the toll can only keep them. */
export function answerGatekeeper(state: GameState, answer: "paid" | "refused"): PartyActionError | null {
  if (answer === "paid" && state.coins < BALANCE.gatekeeper.tollCoins) return { reason: t("errors.notEnoughCoins") };
  state.gatekeeperAnswer = answer;
  if (answer !== "paid") return null;
  state.coins -= BALANCE.gatekeeper.tollCoins;
  state.blessingRoomsLeft = BALANCE.gatekeeper.blessingRooms;
  return null;
}

/**
 * Counts `room` against the blessing as the party enters it, before anything in the room happens.
 * Rest rooms don't count. The guard (boss) room ends the blessing outright and is never blessed.
 * Returns the line to show when the blessing ends here, or null.
 */
export function countBlessedRoom(state: GameState, room: Room): string | null {
  if (room.type === "rest") return null;
  const hadRoomsLeft = state.blessingRoomsLeft > 0;
  if (!hadRoomsLeft && state.blessedRoomId === null) return null;
  if (room.type === "boss") {
    state.blessingRoomsLeft = 0;
    state.blessedRoomId = null;
    return hadRoomsLeft ? t("game.blessingCutByGuard") : t("game.blessingFaded");
  }
  if (!hadRoomsLeft) {
    state.blessedRoomId = null;
    return t("game.blessingFaded");
  }
  state.blessedRoomId = room.id;
  state.blessingRoomsLeft -= 1;
  return null;
}

/** A fight starting in the blessed room starts with the blessing on every living party member; it ends with the fight, like the barter buffs. */
export function applyBlessing(state: GameState, ctx: EngineContext, roomId: Id): void {
  if (state.blessedRoomId !== roomId) return;
  const quiet: LogEntry[] = [];
  for (const character of ctx.party) {
    if (!character.isAlive) continue;
    resolveSkillEffect(
      { kind: "applyStatusEffect", statusEffectId: BALANCE.gatekeeper.blessingStatusId, durationTurns: BALANCE.gatekeeper.blessingDurationTurns },
      character,
      character,
      { log: quiet }
    );
  }
}
