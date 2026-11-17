import type { ChoiceNarrationResult, GameState, Id, PendingChoiceNarration } from "../types";
import { getArtifact } from "../data/artifacts";
import { BALANCE } from "../data/balanceConfig";
import { EVENTS } from "../data/events";
import { getItem } from "../data/items";
import { RELIGIONS, getReligion } from "../data/religions";
import { pickEventText } from "./dungeon";
import { escalationTier } from "./events/shared";
import { roundFaith } from "./survival";

type Selection = { characterId?: Id; donorIds?: readonly Id[] };

export interface ChoiceNarrationCapture {
  source: "event" | "temple";
  sourceId: Id;
  roomId: Id;
  floorDepth: number;
  title: string;
  cases: Record<string, string>;
  kind?: string;
  scene?: string;
  description?: string;
  descriptions?: string[];
  habit?: boolean;
  tier: number;
  chainVariant?: string;
  sacrifices?: number;
  coins: number;
  faith: number;
  party: { characterId: Id; name: string; hp: number; artifacts: Id[] }[];
  inventory: Record<Id, number>;
  pendingArtifactId?: Id;
  secondArtifactId?: Id;
  gamble?: { round: number; pot: number };
}

export function captureChoiceNarration(state: GameState): ChoiceNarrationCapture | null {
  const room = state.floor.rooms.find((r) => r.id === state.currentRoomId);
  if (!room || room.cleared) return null;
  const event = room.type === "event" ? EVENTS.find((e) => e.id === room.rolledEventId) : undefined;
  const religion = room.type === "temple" ? RELIGIONS.find((r) => r.id === room.templeReligionId) : undefined;
  if ((!event && !religion) || event?.kind === "scripted") return null;
  const scene = event ? pickEventText(state, room, event) : undefined;
  if (event?.narration?.["take.chest"] && scene !== event.description && !event.descriptionVariants?.includes(scene!) && scene !== event.chainEscalatedDescription) {
    throw new Error(`Unsupported choice narration scene: ${event.id}`);
  }
  return {
    source: event ? "event" : "temple", sourceId: (event ?? religion)!.id,
    roomId: room.id, floorDepth: state.floor.depth, title: (event ?? religion)!.name,
    cases: { ...((event ?? religion)!.narration ?? {}) }, kind: event?.kind,
    scene, description: event?.description, descriptions: event?.descriptionVariants,
    habit: !!event?.freeTake && !!event.chainEscalatedDescription && scene === event.chainEscalatedDescription,
    tier: event ? escalationTier(state, event) : 0, chainVariant: room.chainVariant,
    sacrifices: room.eventSacrificesThisVisit, coins: state.coins, faith: state.faith,
    party: state.party.map((c) => ({ characterId: c.id, name: c.name, hp: c.hp, artifacts: [...c.equippedArtifactIds] })),
    inventory: { ...state.inventory }, pendingArtifactId: state.pendingArtifactDecision?.artifactId,
    secondArtifactId: state.secondJackpotArtifactId ?? undefined,
    gamble: state.activeEvent?.gambleState ? { ...state.activeEvent.gambleState } : undefined,
  };
}

export function resolveChoiceNarration(before: ChoiceNarrationCapture, after: GameState, caseKey: string, selection: Selection = {}): PendingChoiceNarration {
  const result: ChoiceNarrationResult = {};
  const coinsDelta = after.coins - before.coins;
  const faithDelta = roundFaith(after.faith - before.faith);
  if (coinsDelta) result.coinsDelta = coinsDelta;
  if (faithDelta) result.faithDelta = faithDelta;
  const selected = selection.donorIds ?? (selection.characterId ? [selection.characterId] : []);
  const hpChanges = before.party.flatMap((c) => {
    const now = after.party.find((p) => p.id === c.characterId);
    return now && (now.hp !== c.hp || selected.includes(c.characterId))
      ? [{ characterId: c.characterId, name: c.name, before: c.hp, after: now.hp }] : [];
  });
  if (hpChanges.length) result.hpChanges = hpChanges;
  const remaining = after.party.flatMap((c) => c.equippedArtifactIds);
  const removed = before.party.flatMap((c) => c.artifacts).filter((id) => {
    const index = remaining.indexOf(id);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  }).map((artifactId) => ({ artifactId, name: getArtifact(artifactId).name }));
  if (removed.length) result.removedArtifacts = removed;
  const offered: Id[] = [];
  const first = after.pendingArtifactDecision?.artifactId;
  if (first && first !== before.pendingArtifactId) offered.push(first);
  const second = after.secondJackpotArtifactId;
  if (second && second !== before.secondArtifactId) offered.push(second);
  if (offered.length) result.offeredArtifacts = offered.map((artifactId) => ({ artifactId, name: getArtifact(artifactId).name }));
  const items = Object.entries(after.inventory).flatMap(([itemId, count]) => {
    const gained = count - (before.inventory[itemId] ?? 0);
    return gained > 0 ? [{ itemId, name: getItem(itemId).name, count: gained }] : [];
  });
  if (items.length) result.receivedItems = items;
  if (caseKey === "boon" && after.boon) result.boon = { ...after.boon, name: getReligion(after.boon.religionId).name };

  if (before.kind === "coinGamble" && ["enter", "continue", "stop"].includes(caseKey)) {
    const active = after.activeEvent?.gambleState;
    const outcome = caseKey === "stop" ? "banked" : active ? "win" : after.lastGamblingDenOutcome === "won" ? "jackpot" : "loss";
    result.gamble = { round: before.gamble ? before.gamble.round + (caseKey === "continue" ? 1 : 0) : 1,
      potBefore: before.gamble?.pot ?? BALANCE.events.gamblingDenRounds[0]!.stake,
      potAfter: active?.pot ?? 0, outcome };
    if (outcome === "jackpot") caseKey = "jackpot";
    else if (caseKey !== "stop") caseKey += `.${outcome}`;
  } else if (before.kind === "rescueGamble" && caseKey === "rescue") {
    caseKey += after.eventOutcomes[before.sourceId] === "rescued" ? ".success" : ".failure";
  } else if (before.kind === "artifactSacrifice" && caseKey === "leave") {
    caseKey += before.sacrifices === undefined ? ".legacy" : before.sacrifices > 0 ? ".afterOffering" : ".untouched";
  } else if ((caseKey === "pay" || caseKey === "sacrifice") && before.tier > 0) {
    for (let tier = before.tier; tier > 0; tier--) {
      if (before.cases[`${caseKey}.tier${tier}`]) { caseKey += `.tier${tier}`; break; }
    }
  } else if (caseKey === "fight" && before.chainVariant?.startsWith("forced")) {
    const maxTier = before.chainVariant === "forced3" ? 3 : before.chainVariant === "forced2" ? 2 : 1;
    for (let tier = maxTier; tier > 0; tier--) {
      if (before.cases[`${caseKey}.forced${tier}`]) { caseKey += `.forced${tier}`; break; }
    }
  } else if ((caseKey === "take" || caseKey === "moveOn") && before.habit && before.cases[`${caseKey}.habit`]) {
    caseKey += ".habit";
  } else if (caseKey === "take" && before.cases["take.chest"]) {
    const index = before.scene === before.description ? 0 : (before.descriptions ?? []).indexOf(before.scene ?? "") + 1;
    const suffix = [".chest", ".lockbox", ".gear"][index];
    if (!suffix || (index === 0 && before.scene !== before.description)) throw new Error(`Unsupported choice narration scene: ${before.sourceId}`);
    caseKey += suffix;
  }
  const values: Record<string, string> = {
    character: hpChanges[0]?.name ?? "", artifact: result.offeredArtifacts?.[0]?.name ?? "",
    oldArtifact: removed[0]?.name ?? "", newArtifact: result.offeredArtifacts?.[0]?.name ?? "",
  };
  const text = before.cases[caseKey];
  if (!text) throw new Error(`Missing choice narration case: ${before.sourceId}.${caseKey}`);
  return { source: before.source, sourceId: before.sourceId, roomId: before.roomId, floorDepth: before.floorDepth,
    caseKey, title: before.title, text: text.replace(/\{\{(character|artifact|oldArtifact|newArtifact)\}\}/g, (_, key: string) => values[key]!), result };
}
