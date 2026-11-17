import type { Character, GameState, Id, Room } from "../types";
import { BALANCE } from "../data/balanceConfig";
import { religionOf } from "../data/religions";
import { t } from "../data/strings";
import { getRoom } from "./dungeon";
import { recomputeAllPartyStats, type PartyActionError } from "./party";
import { adjustFaith, MAX_FAITH } from "./survival";

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

export interface BloodGift {
  hpAfter: number;
  faith: number;
}

export type GiveBloodState = "open" | "full" | "none";

/** What `character` would give at this temple, or `null` when the temple will not take their blood. */
export function bloodGift(state: GameState, character: Character): BloodGift | null {
  const room = getRoom(state.floor, state.currentRoomId);
  if (!character.isAlive || room.type !== "temple") return null;
  const { hpFloor, matching, other } = BALANCE.temple.giveBlood;
  const floor = Math.max(1, Math.round(character.maxHp * hpFloor));
  const share = character.hp / character.maxHp;
  if (religionOf(character).id === room.templeReligionId) {
    if (share >= matching.minHpFraction) {
      return { hpAfter: Math.max(floor, character.hp - Math.round(character.maxHp * matching.hpCost)), faith: matching.faithGain };
    }
    if (share >= matching.lowMinHpFraction && character.hp > floor) return { hpAfter: floor, faith: matching.lowFaithGain };
    return null;
  }
  if (share < other.minHpFraction) return null;
  return { hpAfter: Math.max(floor, character.hp - Math.round(character.maxHp * other.hpCost)), faith: other.faithGain };
}

export function templeActionsAvailable(state: GameState): { giveBlood: GiveBloodState; boon: boolean } {
  if (!currentTemple(state)) return { giveBlood: "none", boon: false };
  const giveBlood = state.faith >= MAX_FAITH ? "full" : state.party.some((c) => bloodGift(state, c)) ? "open" : "none";
  return { giveBlood, boon: state.faith >= BALANCE.temple.boon.faithCost };
}

function closeTemple(state: GameState, room: Room, lines: string[]): void {
  room.cleared = true;
  state.message = lines.join(" ");
}

export function templeGiveBlood(state: GameState, donorIds: readonly Id[]): PartyActionError | null {
  const checked = templeError(state);
  if ("error" in checked) return checked.error;
  if (state.faith >= MAX_FAITH) return { reason: t("errors.templeTorchFull") };
  const donors = state.party.filter((c) => donorIds.includes(c.id));
  if (donors.length === 0) return { reason: t("errors.templeNoDonor") };
  const gifts = donors.map((c) => ({ c, gift: bloodGift(state, c) }));
  const refused = gifts.find((g) => !g.gift);
  if (refused) return { reason: t("errors.templeCannotGive", { character: refused.c.name }) };
  let faith = 0;
  for (const { c, gift } of gifts) {
    c.hp = gift!.hpAfter;
    faith += gift!.faith;
  }
  adjustFaith(state, faith);
  closeTemple(state, checked.room, donors.map((c) => t("game.templeGaveBlood", { character: c.name })));
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
