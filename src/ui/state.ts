import type { Character, CombatantRef, SkillDefinition, ItemDefinition, Id } from "../types";
import { getSkill, getEffectiveSkill } from "../data/classes";
import { getItem } from "../data/items";
import { getArtifact } from "../data/artifacts";
import { getEvent } from "../data/events";

export type PickTargetSource = { kind: "skill"; skill: SkillDefinition } | { kind: "item"; item: ItemDefinition };

export type ItemDetailOrigin = { kind: "combat"; actorRef: CombatantRef } | { kind: "outOfCombat" };

export type ArtifactDetailOrigin = { kind: "unequipped" } | { kind: "equipped"; characterId: Id };

export type RewardEntry = { kind: "item"; id: Id; qty: number } | { kind: "artifact"; id: Id };

export type UiState =
  | { kind: "room" }
  | { kind: "rest" }
  | { kind: "pickAction"; actorRef: CombatantRef }
  | { kind: "pickSkill"; actorRef: CombatantRef }
  | { kind: "pickItemInCombat"; actorRef: CombatantRef }
  | { kind: "pickTarget"; actorRef: CombatantRef; source: PickTargetSource; candidates: CombatantRef[] }
  | { kind: "roundResolved" }
  | { kind: "combatOver" }
  | { kind: "pickItemOutOfCombat" }
  | { kind: "itemDetail"; item: ItemDefinition; origin: ItemDetailOrigin }
  | { kind: "artifactMenu" }
  | { kind: "artifactDetail"; artifactId: Id; origin: ArtifactDetailOrigin }
  | { kind: "pickCharacterForArtifact"; artifactId: Id }
  | { kind: "saveMenu"; previous: UiState }
  | { kind: "roomReward"; entries: RewardEntry[]; viewing: RewardEntry | null }
  | { kind: "eventMerchant" }
  | { kind: "eventMerchantPickPayer"; offerIndex: number }
  | { kind: "eventCursedShrine" }
  | { kind: "eventTwinAltars" }
  | { kind: "eventTwinAltarsPickCharacter"; offerIndex: 0 | 1 }
  | { kind: "eventTwinAltarsPickUnequip"; offerIndex: 0 | 1; characterId: Id }
  | { kind: "eventHpGamble"; eventId: "blood-altar" | "collapsed-floor" }
  | { kind: "eventHpGamblePickPayer"; eventId: "blood-altar" | "collapsed-floor" }
  | { kind: "eventArtifactPick"; eventId: "sacrificial-circle" | "gambling-den" }
  | { kind: "eventHermit" }
  | { kind: "eventHermitPickArtifact"; service: "removeCurse" | "reroll" }
  | { kind: "gameover" };

export function inventoryEntries(inventory: Record<Id, number>): { item: ItemDefinition; qty: number }[] {
  return Object.entries(inventory)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ item: getItem(id), qty }));
}

export function buildRewardEntries(drops: { itemIds: Id[]; artifactIds: Id[] }): RewardEntry[] {
  const itemQty = new Map<Id, number>();
  for (const id of drops.itemIds) itemQty.set(id, (itemQty.get(id) ?? 0) + 1);
  const entries: RewardEntry[] = [];
  for (const [id, qty] of itemQty) entries.push({ kind: "item", id, qty });
  for (const id of drops.artifactIds) entries.push({ kind: "artifact", id });
  return entries;
}

export function ownedArtifactIds(party: Character[], unequippedArtifactIds: Id[]): Id[] {
  return [...unequippedArtifactIds, ...party.flatMap((c) => c.equippedArtifactIds)];
}

export function cursedEquippedEntries(party: Character[]): { character: Character; artifactId: Id }[] {
  return party.flatMap((character) => character.equippedArtifactIds.filter((id) => getArtifact(id).isCursed).map((artifactId) => ({ character, artifactId })));
}

export function skillEntries(actor: Character): SkillDefinition[] {
  return actor.unlockedSkillIds.map((id) => getEffectiveSkill(getSkill(id), actor.level));
}

export function eventUiState(eventId: Id): UiState {
  const event = getEvent(eventId);
  switch (event.kind) {
    case "merchant":
      return { kind: "eventMerchant" };
    case "choiceReveal":
      return eventId === "twin-altars" ? { kind: "eventTwinAltars" } : { kind: "eventCursedShrine" };
    case "artifactExchange":
      return eventId === "wandering-hermit" ? { kind: "eventHermit" } : { kind: "eventArtifactPick", eventId: eventId as "sacrificial-circle" | "gambling-den" };
    case "hpGamble":
      return { kind: "eventHpGamble", eventId: "blood-altar" };
    case "rescueGamble":
      return { kind: "eventHpGamble", eventId: "collapsed-floor" };
    default:
      return { kind: "room" };
  }
}
