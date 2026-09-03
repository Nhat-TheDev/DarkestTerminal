import type { Character, CombatantRef, SkillDefinition, ItemDefinition, Id } from "../types";
import { getSkill, getEffectiveSkill } from "../data/classes";
import { getItem } from "../data/items";
import { getEvent } from "../data/events";

export type PickTargetSource = { kind: "skill"; skill: SkillDefinition } | { kind: "item"; item: ItemDefinition };

export type ItemDetailOrigin = { kind: "combat"; actorRef: CombatantRef } | { kind: "outOfCombat" };

export type ArtifactDetailOrigin = { kind: "owned"; characterId: Id };

export type RewardEntry = { kind: "item"; id: Id; qty: number } | { kind: "artifact"; id: Id };

export type UiState =
  | { kind: "room" }
  | { kind: "rest" }
  | { kind: "pickAction"; actorRef: CombatantRef }
  | { kind: "pickSkill"; actorRef: CombatantRef }
  | { kind: "pickItemInCombat"; actorRef: CombatantRef }
  | { kind: "pickTarget"; actorRef: CombatantRef; source: PickTargetSource; candidates: CombatantRef[] }
  | { kind: "skillDetail"; actorRef: CombatantRef; skill: SkillDefinition }
  | { kind: "roundResolved" }
  | { kind: "combatOver" }
  | { kind: "pickItemOutOfCombat" }
  | { kind: "itemDetail"; item: ItemDefinition; origin: ItemDetailOrigin }
  | { kind: "artifactMenu" }
  | { kind: "artifactDetail"; artifactId: Id; origin: ArtifactDetailOrigin }
  | { kind: "artifactDecision" }
  | { kind: "artifactDecisionPickCharacter" }
  | { kind: "artifactDecisionPickReplace"; characterId: Id }
  | { kind: "saveMenu"; previous: UiState }
  | { kind: "roomReward"; entries: RewardEntry[]; viewing: RewardEntry | null }
  | { kind: "campPrompt" }
  | { kind: "eventOpenChest" }
  | { kind: "eventMerchant"; viewingOfferIndex: number | null }
  | { kind: "eventCursedShrine" }
  | { kind: "eventTwinAltars" }
  | { kind: "eventHpGamble"; eventId: "blood-altar" | "collapsed-floor" }
  | { kind: "eventHpGamblePickPayer"; eventId: "blood-altar" | "collapsed-floor" }
  | { kind: "eventArtifactPick"; eventId: "sacrificial-circle" }
  | { kind: "eventGamblingDen" }
  | { kind: "eventHermit" }
  | { kind: "eventHermitPickArtifact" }
  | { kind: "eventGuardianFight" }
  | { kind: "eventReflection" }
  | { kind: "gameover" };

export const ARTIFACT_ICON = "✦";

/** "⚔" for items used against an opponent, "✚" for recovery (heal/MP), "↑" for buffs/utility. */
export function itemIcon(item: ItemDefinition): string {
  if (item.target === "singleEnemy" || item.target === "allEnemies") return "⚔";
  if (item.effects.some((e) => e.kind === "heal" || e.kind === "restoreMp")) return "✚";
  return "↑";
}

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

/** Every artifact the party owns is equipped on someone — there's no unequipped pool anymore. */
export function ownedArtifactEntries(party: Character[]): { character: Character; artifactId: Id }[] {
  return party.flatMap((character) => character.equippedArtifactIds.map((artifactId) => ({ character, artifactId })));
}

export function skillEntries(actor: Character): SkillDefinition[] {
  return actor.unlockedSkillIds.map((id) => getEffectiveSkill(getSkill(id), actor.level));
}

export function eventUiState(eventId: Id): UiState {
  const event = getEvent(eventId);
  switch (event.kind) {
    case "instantReward":
      return { kind: "eventOpenChest" };
    case "merchant":
      return { kind: "eventMerchant", viewingOfferIndex: null };
    case "choiceReveal":
      return eventId === "twin-altars" ? { kind: "eventTwinAltars" } : { kind: "eventCursedShrine" };
    case "artifactExchange":
      return eventId === "wandering-hermit" ? { kind: "eventHermit" } : { kind: "eventArtifactPick", eventId: "sacrificial-circle" };
    case "hpGamble":
      return { kind: "eventHpGamble", eventId: "blood-altar" };
    case "rescueGamble":
      return { kind: "eventHpGamble", eventId: "collapsed-floor" };
    case "coinGamble":
      return { kind: "eventGamblingDen" };
    case "combatReward":
      return { kind: "eventGuardianFight" };
    default:
      return { kind: "room" };
  }
}
