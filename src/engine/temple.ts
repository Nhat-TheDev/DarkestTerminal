import type { Character, GameState, LogEntry, Room } from "../types";
import { BALANCE } from "../data/balanceConfig";
import { religionOf } from "../data/religions";
import { t } from "../data/strings";
import { getRoom } from "./dungeon";
import { recomputeAllPartyStats, type PartyActionError } from "./party";
import { adjustFaith } from "./survival";

type BloodBand = "upper" | "lower" | "none";

function currentTemple(state: GameState): Room | null {
  const room = getRoom(state.floor, state.currentRoomId);
  return room.type === "temple" && !room.cleared ? room : null;
}

function templeError(state: GameState): { room: Room } | { error: PartyActionError } {
  const room = getRoom(state.floor, state.currentRoomId);
  if (room.type !== "temple") return { error: { reason: t("errors.notInTemple") } };
  if (room.cleared) return { error: { reason: t("errors.templeSpent") } };
  return { room };
}

function bloodBand(character: Character): BloodBand {
  const { upperHpFraction, lowerHpFraction } = BALANCE.temple.giveBlood;
  const share = character.hp / character.maxHp;
  if (share >= upperHpFraction) return "upper";
  return share >= lowerHpFraction ? "lower" : "none";
}

export function templeMatchingMembers(state: GameState): Character[] {
  const room = getRoom(state.floor, state.currentRoomId);
  return state.party.filter((c) => c.isAlive && religionOf(c).id === room.templeReligionId);
}

export function templeActionsAvailable(state: GameState): { giveBlood: "open" | "locked" | "hidden"; giveAll: boolean; boon: boolean } {
  if (!currentTemple(state)) return { giveBlood: "hidden", giveAll: false, boon: false };
  const matching = templeMatchingMembers(state);
  const giveBlood = matching.length === 0 ? "hidden" : matching.some((c) => bloodBand(c) !== "none") ? "open" : "locked";
  return { giveBlood, giveAll: matching.length === 0, boon: state.faith >= BALANCE.temple.boon.faithCost };
}

function closeTemple(state: GameState, room: Room, lines: string[]): void {
  room.cleared = true;
  state.message = lines.join(" ");
}

export function templeGiveBlood(state: GameState): PartyActionError | null {
  const checked = templeError(state);
  if ("error" in checked) return checked.error;
  const matching = templeMatchingMembers(state);
  if (matching.length === 0) return { reason: t("errors.templeNoBlood") };
  const { hpCost, hpFloor, faithGain, lowerFaithGain } = BALANCE.temple.giveBlood;
  const lines: string[] = [];
  let faith = 0;
  for (const c of matching) {
    const band = bloodBand(c);
    if (band === "none") {
      lines.push(t("game.templeTooWeak", { character: c.name }));
      continue;
    }
    const floor = Math.max(1, Math.round(c.maxHp * hpFloor));
    const cost = band === "upper" ? Math.round(c.maxHp * hpCost) : c.hp - floor;
    c.hp = Math.min(c.hp, Math.max(floor, c.hp - cost));
    faith += band === "upper" ? faithGain : lowerFaithGain;
    lines.push(t("game.templeGaveBlood", { character: c.name }));
  }
  if (faith === 0) return { reason: t("errors.templeNoBlood") };
  adjustFaith(state, faith);
  closeTemple(state, checked.room, lines);
  return null;
}

export function templeGiveAll(state: GameState): PartyActionError | null {
  const checked = templeError(state);
  if ("error" in checked) return checked.error;
  if (templeMatchingMembers(state).length > 0) return { reason: t("errors.templeHasFollower") };
  const { hpCost, faithGain } = BALANCE.temple.giveAll;
  const log: LogEntry[] = [];
  for (const c of state.party) {
    if (!c.isAlive) continue;
    c.hp -= Math.round(c.maxHp * hpCost);
    if (c.hp > 0) {
      log.push({ text: t("game.templeGaveBlood", { character: c.name }), kind: "debuff" });
      continue;
    }
    c.hp = 0;
    c.isAlive = false;
    log.push({ text: t("game.templeFell", { character: c.name }), kind: "death" });
  }
  adjustFaith(state, faithGain);
  closeTemple(state, checked.room, log.map((entry) => entry.text));
  return null;
}

export function templeAskBoon(state: GameState): PartyActionError | null {
  const checked = templeError(state);
  if ("error" in checked) return checked.error;
  if (state.faith < BALANCE.temple.boon.faithCost) return { reason: t("errors.templeNoFaith") };
  adjustFaith(state, -BALANCE.temple.boon.faithCost);
  state.boon = { religionId: checked.room.templeReligionId!, depth: state.floor.depth };
  recomputeAllPartyStats(state);
  closeTemple(state, checked.room, [t("game.templeBoon")]);
  return null;
}

export function templeLeave(state: GameState): void {
  const room = currentTemple(state);
  if (room) closeTemple(state, room, [t("game.templeLeft")]);
}
